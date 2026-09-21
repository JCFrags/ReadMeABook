/**
 * Component: Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { DownloadTorrentPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { ProwlarrService } from '../integrations/prowlarr.service';
import { RMABLogger } from '../utils/logger';
import { isTransientConnectionError } from '../utils/connection-errors';
import {
  DownloadSourceError,
  isRetryableDownloadSourceError,
} from '../interfaces/download-client.interface';

/**
 * Process download job
 * Routes to appropriate download client based on protocol detection
 * Adds selected result to download client and starts monitoring
 */
export async function processDownloadTorrent(payload: DownloadTorrentPayload): Promise<any> {
  const { requestId, audiobook, torrent, alternateTorrents = [], jobId } = payload;
  const candidates = [torrent, ...alternateTorrents];

  const logger = RMABLogger.forJob(jobId, 'DownloadTorrent');

  logger.info(`Processing request ${requestId} for "${audiobook.title}"`);
  logger.info(`Selected result: ${torrent.title}`, {
    size: torrent.size,
    seeders: torrent.seeders,
    format: torrent.format,
    indexer: torrent.indexer,
    alternateCount: alternateTorrents.length,
  });

  try {
    // A queued automatic job must not override a later collection claim or a terminal request.
    const request = await prisma.request.findFirst({
      where: { id: requestId, deletedAt: null },
      include: { user: { select: { plexUsername: true } } },
    });
    if (!request || !['pending', 'searching', 'awaiting_search', 'awaiting_release', 'downloading'].includes(request.status)) {
      return { success: true, skipped: true, message: 'Request state no longer permits this download' };
    }
    const previousDownload = await prisma.downloadHistory.findFirst({
      where: { requestId, selected: true }, orderBy: { createdAt: 'desc' },
    });
    if ((previousDownload as typeof previousDownload & { collectionSelection?: unknown })?.collectionSelection) {
      return { success: true, skipped: true, message: 'Request has an explicit collection selection; use its collection recovery flow' };
    }
    const owner = (request as typeof request & { activeDownloadJobId?: string | null }).activeDownloadJobId;
    if (!jobId || (owner && owner !== jobId) || (!owner && request.status === 'downloading' && previousDownload && previousDownload.downloadStatus !== 'failed')) {
      return { success: true, skipped: true, message: 'Another job or monitor owns this download' };
    }
    const claimWhere = { id: requestId, status: request.status, deletedAt: null,
      OR: [{ activeDownloadJobId: null }, { activeDownloadJobId: jobId }] };
    const claimData = { status: 'downloading', progress: 0, activeDownloadJobId: jobId, activeSearchJobId: null };
    const claim = await prisma.request.updateMany({ where: claimWhere, data: claimData });
    if (claim.count !== 1) {
      return { success: true, skipped: true, message: 'Request changed before the download claim' };
    }

    const config = await getConfigService();
    const manager = getDownloadClientManager(config);

    // Include Prowlarr API key as source header so NZB/torrent downloads from
    // Prowlarr proxy URLs are authenticated (fixes 403 for indexers like NZBFinder)
    const prowlarrApiKey = (await config.getMany(['prowlarr_api_key'])).prowlarr_api_key || process.env.PROWLARR_API_KEY;
    const sourceHeaders: Record<string, string> = {};
    if (prowlarrApiKey) {
      sourceHeaders['X-Api-Key'] = prowlarrApiKey;
    }

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const candidate = candidates[candidateIndex];
      const isUsenet = ProwlarrService.isNZBResult(candidate);
      const protocol = isUsenet ? 'usenet' : 'torrent';
      const client = await manager.getClientServiceForProtocol(protocol);

      if (!client) {
        throw new Error(`No ${protocol} download client configured. Please add a ${protocol} client in Settings > Download Clients.`);
      }

      const clientConfig = await manager.getClientForProtocol(protocol);
      const category = clientConfig?.category || 'readmeabook';

      logger.info(
        `Trying release ${candidateIndex + 1}/${candidates.length}: ${candidate.title}`,
        { indexer: candidate.indexer, protocol, downloadClient: client.clientType }
      );

      let downloadClientId: string;
      try {
        downloadClientId = await client.addDownload(candidate.downloadUrl, {
          category,
          priority: 'normal',
          sourceHeaders,
        });
      } catch (error) {
        if (!(error instanceof DownloadSourceError)) {
          throw error;
        }

        const contextualError = new DownloadSourceError(
          `Grab failed: ${candidate.indexer} returned HTTP ${error.status} while fetching "${candidate.title}" through Prowlarr`,
          error.status,
          error.sourceUrl,
          error
        );

        if (!isRetryableDownloadSourceError(error)) {
          throw contextualError;
        }

        const hasNextCandidate = candidateIndex < candidates.length - 1;

        logger.warn(
          `${contextualError.message}${hasNextCandidate ? '; trying next ranked release' : ''}`,
          {
            indexer: candidate.indexer,
            upstreamStatus: error.status,
            candidate: candidateIndex + 1,
            candidateCount: candidates.length,
          }
        );

        if (hasNextCandidate) {
          continue;
        }

        throw contextualError;
      }

      logger.info(`Download added with ID: ${downloadClientId}`);

      // Create DownloadHistory record. Exclude magnet links from the indexer-page fallback.
      const indexerPageUrl = candidate.infoUrl || (candidate.guid?.startsWith('magnet:') ? null : candidate.guid);

      await prisma.downloadHistory.updateMany({ where: { requestId, selected: true }, data: { selected: false } });
      const downloadHistory = await prisma.downloadHistory.create({
        data: {
          requestId,
          indexerName: candidate.indexer,
          indexerId: candidate.indexerId,
          downloadClient: client.clientType,
          downloadClientId,
          torrentName: candidate.title,
          // Set protocol-specific ID fields for backward compatibility
          torrentHash: client.protocol === 'torrent' ? (candidate.infoHash || downloadClientId) : undefined,
          nzbId: client.protocol === 'usenet' ? downloadClientId : undefined,
          torrentSizeBytes: candidate.size,
          torrentUrl: indexerPageUrl,
          magnetLink: candidate.downloadUrl,
          seeders: candidate.seeders || 0,
          leechers: candidate.leechers || 0,
          downloadStatus: 'downloading',
          selected: true,
          startedAt: new Date(),
        },
      });

      logger.info(`Created download history record: ${downloadHistory.id}`);

      // Send grab notification (non-blocking — failures here don't fail the download)
      const jobQueue = getJobQueueService();
      const grabMessage = `${candidate.title} via ${candidate.indexer} (${client.clientType})`;
      await jobQueue.addNotificationJob(
        'request_grabbed',
        requestId,
        audiobook.title,
        audiobook.author,
        request.user.plexUsername || 'Unknown User',
        grabMessage,
        request.type
      ).catch((error) => {
        logger.error('Failed to queue grab notification', { error: error instanceof Error ? error.message : String(error) });
      });

      // Trigger monitor download job with initial delay
      await jobQueue.addMonitorJob(
        requestId,
        downloadHistory.id,
        downloadClientId,
        client.clientType,
        3 // Wait 3 seconds before first check
      );

      const handoffWhere = { id: requestId, status: 'downloading', activeDownloadJobId: jobId, deletedAt: null };
      const handoffData = { activeDownloadJobId: null };
      await prisma.request.updateMany({ where: handoffWhere, data: handoffData });
      logger.info(`Started monitoring job for request ${requestId} (${client.clientType}, 3s initial delay)`);

      return {
        success: true,
        message: `Download added to ${client.clientType} and monitoring started`,
        requestId,
        downloadHistoryId: downloadHistory.id,
        downloadClientId,
        torrent: {
          title: candidate.title,
          size: candidate.size,
          seeders: candidate.seeders || 0,
          format: candidate.format,
        },
      };
    }

    throw new Error('No release candidates were available to download');
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    if (isTransientConnectionError(error) || isRetryableDownloadSourceError(error)) {
      // Connection error — don't mark request as failed yet.
      // Bull will retry this job (3 attempts with exponential backoff).
      // If all retries are exhausted, the global failed handler marks it failed.
      logger.warn(
        isRetryableDownloadSourceError(error)
          ? `All ranked release grabs were temporarily unavailable for request ${requestId}, allowing Bull to retry`
          : `Download client unreachable for request ${requestId}, allowing Bull to retry`
      );
    } else {
      // Permanent error — mark request as failed immediately
      const failureWhere = { id: requestId, status: 'downloading', activeDownloadJobId: jobId, deletedAt: null };
      const failureData = { status: 'failed', activeDownloadJobId: null,
        errorMessage: error instanceof Error ? error.message : 'Failed to add download to client', updatedAt: new Date() };
      if (jobId) await prisma.request.updateMany({ where: failureWhere, data: failureData });
    }

    throw error;
  }
}
