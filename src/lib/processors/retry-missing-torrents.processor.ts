/**
 * Component: Retry Missing Torrents Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Retries search for requests that are awaiting torrent search.
 * Also drives bidirectional transitions between `awaiting_search` and
 * `awaiting_release` based on the per-book release date and the
 * `indexer.skip_unreleased` setting.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { getConfigService } from '../services/config.service';
import { shouldSkipAutoSearch } from '../utils/release-date';
import { dueSearchFilter } from '../utils/search-policy';

export interface RetryMissingTorrentsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processRetryMissingTorrents(payload: RetryMissingTorrentsPayload): Promise<any> {
  const { jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'RetryMissingTorrents');

  logger.info('Starting retry job for requests awaiting search/release...');

  try {
    // Read skip-unreleased setting once at start (default ON when absent)
    const configService = getConfigService();
    const skipUnreleasedSetting = (await configService.get('indexer.skip_unreleased')) !== 'false';

    // Release dates are stored as date-only values. When the release gate is
    // enabled, do not let still-future awaiting_release rows consume one of
    // the limited retry slots; they become eligible automatically on release day.
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);

    // Process never-searched requests first, then rotate through the least
    // recently searched. Without an explicit order, PostgreSQL repeatedly
    // returned the same physical first 50 rows and starved the rest forever.
    const requests = await prisma.request.findMany({
      where: {
        deletedAt: null,
        AND: [dueSearchFilter()],
        ...(skipUnreleasedSetting
          ? {
              OR: [
                { status: 'awaiting_search' },
                { status: 'awaiting_release', releaseDate: null },
                { status: 'awaiting_release', releaseDate: { lte: todayUtc } },
              ],
            }
          : { status: { in: ['awaiting_search', 'awaiting_release'] } }),
      },
      include: {
        audiobook: true,
      },
      orderBy: [
        { lastSearchAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 50,
    });

    logger.info(`Found ${requests.length} requests awaiting search/release`);

    if (requests.length === 0) {
      return {
        success: true,
        message: 'No requests awaiting search/release',
        triggered: 0,
        transitioned: 0,
        skipped: 0,
      };
    }

    const jobQueue = getJobQueueService();
    let triggered = 0;
    let transitioned = 0;
    let skipped = 0;

    for (const request of requests) {
      try {
        const gate = shouldSkipAutoSearch({ releaseDate: request.releaseDate }, skipUnreleasedSetting);

        if (gate.skip) {
          if (request.status === 'awaiting_search') {
            const moved = await prisma.request.updateMany({
              where: { id: request.id, status: 'awaiting_search', deletedAt: null },
              data: { status: 'awaiting_release' },
            });
            transitioned += moved.count;
          }
          skipped++;
          continue;
        }
        if (request.status === 'awaiting_release') {
          const moved = await prisma.request.updateMany({
            where: { id: request.id, status: 'awaiting_release', deletedAt: null },
            data: { status: 'awaiting_search' },
          });
          if (!moved.count) { skipped++; continue; }
          transitioned++;
        }
        const audiobook = {
          id: request.audiobook.id,
          title: request.audiobook.title,
          author: request.audiobook.author,
          asin: request.audiobook.audibleAsin || undefined,
        };
        const queued = request.type === 'ebook'
          ? await jobQueue.addSearchEbookJob(request.id, audiobook, undefined, { trigger: 'retry' })
          : await jobQueue.addSearchJob(request.id, audiobook, { trigger: 'retry' });
        if (queued) triggered++;
        else skipped++;
      } catch (error) {
        logger.error(`Failed to process request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Spread DB operations over time to avoid connection pool exhaustion
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`Retry pass complete: triggered=${triggered}, transitioned=${transitioned}, skipped=${skipped} of ${requests.length}`);

    return {
      success: true,
      message: 'Retry missing torrents completed',
      totalRequests: requests.length,
      triggered,
      transitioned,
      skipped,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
