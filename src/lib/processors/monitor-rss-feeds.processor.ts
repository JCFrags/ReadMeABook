/**
 * Component: Monitor RSS Feeds Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Monitors RSS feeds for new releases and matches against missing requests (audiobooks and ebooks)
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { shouldSkipAutoSearch } from '../utils/release-date';
import { getBlocklistForRequest } from '../services/blocklist.service';
import { normalizeReleaseKey } from '../utils/release-key';
import { getCategoriesForType } from '../utils/indexer-grouping';
import { rssReleaseKey } from '../utils/rss-freshness';
import { assessAudioIdentity } from '../utils/audio-identity';

export interface MonitorRssFeedsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

const REQUEST_PAGE_SIZE = 100;

export async function processMonitorRssFeeds(payload: MonitorRssFeedsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'MonitorRssFeeds');

  logger.info(`Starting RSS feed monitoring...`);

  // Get indexer configuration
  const { getConfigService } = await import('../services/config.service');
  const configService = getConfigService();
  const indexersConfigStr = await configService.get('prowlarr_indexers');

  // Read skip-unreleased setting once at start (default ON when absent)
  const skipUnreleasedSetting = (await configService.get('indexer.skip_unreleased')) !== 'false';

  if (!indexersConfigStr) {
    logger.warn(`No indexers configured, skipping`);
    return { success: false, message: 'No indexers configured', skipped: true };
  }

  const indexersConfig = JSON.parse(indexersConfigStr);

  // Filter indexers that have RSS enabled
  const rssEnabledIndexers = indexersConfig.filter(
    (indexer: any) => indexer.rssEnabled === true
  );

  if (rssEnabledIndexers.length === 0) {
    logger.warn(`No indexers with RSS enabled, skipping`);
    return { success: false, message: 'No RSS-enabled indexers', skipped: true };
  }

  logger.info(`Monitoring ${rssEnabledIndexers.length} RSS-enabled indexers`);

  // Get RSS feeds from all enabled indexers
  const { getProwlarrService } = await import('../integrations/prowlarr.service');
  const prowlarrService = await getProwlarrService();

  const ebookEnabled = (await configService.get('ebook_indexer_search_enabled')) === 'true';
  const feeds = rssEnabledIndexers.map((indexer: any) => ({
    indexerId: indexer.id,
    categories: [...new Set([
      ...getCategoriesForType(indexer, 'audiobook'),
      ...(ebookEnabled ? getCategoriesForType(indexer, 'ebook') : []),
    ])],
  })).filter((feed: { categories: number[] }) => feed.categories.length > 0);
  const allRssResults = await prowlarrService.getAllRssFeeds(feeds);
  const jobQueue = getJobQueueService();
  const rssResults = await jobQueue.observeRssReleases(allRssResults);

  logger.info(`Retrieved ${allRssResults.length} RSS items, ${rssResults.length} newly published identities`);

  if (rssResults.length === 0) {
    return { success: true, message: 'No RSS results', matched: 0 };
  }

  // Get every active request awaiting search (audiobooks and ebooks) in
  // deterministic pages. A single unordered take(100) repeatedly inspected
  // the same rows and made requests beyond that batch invisible to RSS.
  const firstPage = await prisma.request.findMany({
    where: {
      status: 'awaiting_search',
      deletedAt: null,
    },
    include: { audiobook: true },
    orderBy: { id: 'asc' },
    take: REQUEST_PAGE_SIZE,
  });
  const missingRequests = [...firstPage];
  let page = firstPage;

  while (page.length === REQUEST_PAGE_SIZE) {
    page = await prisma.request.findMany({
      where: {
        status: 'awaiting_search',
        deletedAt: null,
      },
      include: { audiobook: true },
      orderBy: { id: 'asc' },
      cursor: { id: page[page.length - 1].id },
      skip: 1,
      take: REQUEST_PAGE_SIZE,
    });
    missingRequests.push(...page);
  }

  logger.info(`Found ${missingRequests.length} requests awaiting search`);

  if (missingRequests.length === 0) {
    return { success: true, message: 'No missing requests', matched: 0 };
  }

  // Match RSS results against missing requests
  let matched = 0;

  for (const request of missingRequests) {
    const audiobook = request.audiobook;

    // Simple fuzzy matching: check if torrent title contains author and partial title
    const authorWords = audiobook.author.toLowerCase().split(' ');
    const titleWords = audiobook.title.toLowerCase().split(' ').slice(0, 3);

    // Hoist blocklist lookup outside the per-torrent loop: one query per request.
    const blocklist = await getBlocklistForRequest(request.id);
    const blockedKeys = new Set(blocklist.map(b => b.releaseKey));
    const blockedHashes = new Set(
      blocklist.filter(b => b.releaseHash).map(b => b.releaseHash as string)
    );

    for (const torrent of rssResults) {
      const indexer = rssEnabledIndexers.find((entry: any) => entry.id === torrent.indexerId);
      if (!indexer || !getCategoriesForType(indexer, request.type === 'ebook' ? 'ebook' : 'audiobook').length) continue;
      if (request.type === 'ebook' && !ebookEnabled) continue;
      if (request.type !== 'ebook' && assessAudioIdentity(torrent, audiobook).status !== 'compatible') continue;
      const torrentTitle = torrent.title.toLowerCase();

      // Check if torrent contains author name and at least 2 title words
      const hasAuthor = authorWords.some(word => word.length > 2 && torrentTitle.includes(word));
      const titleMatchCount = titleWords.filter(word => word.length > 2 && torrentTitle.includes(word)).length;

      if (hasAuthor && titleMatchCount >= 2) {
        // Blocklist guard: skip RSS-driven auto-grab of a release that was already
        // blocked for this request. Otherwise a previously bad release re-enters
        // the pipeline via RSS and defeats the blocklist's purpose.
        const torrentInfoHash = (torrent as { infoHash?: string }).infoHash;
        if (
          blockedKeys.has(normalizeReleaseKey(torrent.title)) ||
          (torrentInfoHash && blockedHashes.has(torrentInfoHash))
        ) {
          logger.debug(`Skipped blocklisted RSS match for request ${request.id}: ${torrent.title}`);
          continue;
        }

        logger.info(`Match found! "${audiobook.title}" by ${audiobook.author} matches torrent: ${torrent.title}`);

        // Release-date gate: skip RSS-driven auto-search for unreleased books.
        // Does NOT mutate request.status — retry job is the sole owner of
        // awaiting_search ↔ awaiting_release transitions.
        const gate = shouldSkipAutoSearch({ releaseDate: request.releaseDate }, skipUnreleasedSetting);
        if (gate.skip) {
          logger.info(`Skipped RSS auto-search for unreleased book`, {
            gateSource: 'MonitorRssFeeds',
            requestId: request.id,
            audiobookTitle: audiobook.title,
            releaseDate: request.releaseDate?.toISOString() ?? null,
          });
          // Match exists but is gated — preserve "only trigger once per request" semantics.
          break;
        }

        // Trigger appropriate search job based on request type
        try {
          if (request.type === 'ebook') {
            const queued = await jobQueue.addSearchEbookJob(request.id, {
              id: audiobook.id,
              title: audiobook.title,
              author: audiobook.author,
              asin: audiobook.audibleAsin || undefined,
            }, undefined, { trigger: 'rss', evidenceKey: rssReleaseKey(torrent) });
            if (queued) matched++;
            logger.info(`RSS ebook search ${queued ? 'queued' : 'not eligible'} for request ${request.id}`);
          } else {
            const queued = await jobQueue.addSearchJob(request.id, {
              id: audiobook.id,
              title: audiobook.title,
              author: audiobook.author,
              asin: audiobook.audibleAsin || undefined,
            }, { trigger: 'rss', evidenceKey: rssReleaseKey(torrent) });
            if (queued) matched++;
            logger.info(`RSS audiobook search ${queued ? 'queued' : 'not eligible'} for request ${request.id}`);
          }
        } catch (error) {
          logger.error(`Failed to trigger search for request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Only trigger once per request
        break;
      }
    }

    // Spread DB operations over time to avoid connection pool exhaustion
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info(`RSS monitoring complete: ${matched} matches found and queued for processing`);

  return {
    success: true,
    message: 'RSS monitoring completed',
    matched,
    totalFeeds: allRssResults.length,
    newReleases: rssResults.length,
    totalMissing: missingRequests.length,
  };
}
