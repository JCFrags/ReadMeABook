/**
 * Component: Bounded Collection Workflow
 * Documentation: documentation/features/collection-workflow.md
 */

import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager } from '@/lib/services/download-client-manager.service';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { loadCollectionMetadata } from './metadata';
import { getCollectionLimits } from './limits';
import { listCollectionBooks, validateCollectionRequests } from './requests';
import { prepareCollectionSelection } from './client-selection';
import { CollectionError, collectionHash, fileFingerprint, readCollectionSelection, validateMappings } from './validation';
import type { CollectionMapping, CollectionPreview, CollectionSelection, CollectionSource } from './types';

async function collectionClient(): Promise<QBittorrentService> {
  const client = await getDownloadClientManager(getConfigService()).getClientServiceForProtocol('torrent');
  if (!client || client.clientType !== 'qbittorrent') throw new CollectionError('Collection selection requires a configured qBittorrent client');
  return client as QBittorrentService;
}

export async function previewCollection(source: CollectionSource, anchorRequestId: string): Promise<CollectionPreview> {
  const books = await listCollectionBooks(anchorRequestId);
  const limits = await getCollectionLimits();
  const metadata = await loadCollectionMetadata(source, await collectionClient(), getConfigService(), limits);
  return {
    infoHash: metadata.infoHash, name: metadata.name, files: metadata.files, totalBytes: metadata.totalBytes,
    existing: metadata.existing, fingerprint: fileFingerprint(metadata.infoHash, metadata.files), limits, books,
  };
}

export interface SelectCollectionInput {
  source: CollectionSource;
  expectedHash: string;
  expectedFingerprint: string;
  mappings: CollectionMapping[];
  identityConfirmed: boolean;
}

export async function selectCollection(input: SelectCollectionInput) {
  if (input.identityConfirmed !== true) throw new CollectionError('Confirm the identity, edition, narrator, language, and completeness for every selected book');
  const hash = collectionHash(input.expectedHash);
  const client = await collectionClient();
  const limits = await getCollectionLimits();
  const metadata = await loadCollectionMetadata(input.source, client, getConfigService(), limits);
  if (metadata.infoHash !== hash || fileFingerprint(hash, metadata.files) !== input.expectedFingerprint) {
    throw new CollectionError('Torrent metadata or priorities changed. Preview and select again', 409);
  }
  const mapped = validateMappings(metadata.files, input.mappings, limits);
  const requestIds = [...mapped.keys()];
  const selectedIndexes = new Set([...mapped.values()].flat().map(f => f.index));
  const batchId = randomUUID();

  const histories = await prisma.$transaction(async tx => {
    // Serialize priority updates for one hash across application processes. Do not wait on another selection.
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext('rmab-collection'), hashtext(${hash})) AS locked`;
    if (!lock?.locked) throw new CollectionError('Another collection operation is active for this torrent. Retry after it completes', 409);
    const requests = await validateCollectionRequests(tx, requestIds);
    const existing = await tx.downloadHistory.findMany({
      where: { torrentHash: hash, selected: true, downloadStatus: { not: 'failed' } },
    });
    for (const history of existing) {
      const saved = readCollectionSelection((history as typeof history & { collectionSelection?: unknown }).collectionSelection);
      if (saved && saved.files.some(f => selectedIndexes.has(f.index))) {
        throw new CollectionError('One or more files already belong to another collection import. Keep its original per-book request', 409);
      }
      if (!saved) throw new CollectionError('This torrent already has an ordinary whole-release request. Resolve it before collection selection', 409);
    }
    for (const request of requests) {
      const claimData = { status: 'downloading', progress: 0, errorMessage: null, activeDownloadJobId: null, activeSearchJobId: null };
      const claim = await tx.request.updateMany({
        where: { id: request.id, status: request.status, deletedAt: null }, data: claimData,
      });
      if (claim.count !== 1) throw new CollectionError('A selected request changed state. Preview again', 409);
    }
    const records = [];
    for (const request of requests) {
      const files = mapped.get(request.id)!;
      const collectionSelection: CollectionSelection = {
        version: 1, batchId, infoHash: hash,
        files: files.map(({ index, path, size, kind }) => ({ index, path, size, kind })),
      };
      const data = {
        requestId: request.id, indexerName: 'Collection selection',
        indexerId: input.source.kind === 'prowlarr' ? input.source.indexerId : null,
        torrentName: metadata.name, torrentHash: hash,
        torrentSizeBytes: BigInt(files.reduce((sum, f) => sum + f.size, 0)),
        downloadClient: 'qbittorrent', downloadClientId: hash,
        downloadStatus: 'queued', selected: true, startedAt: new Date(),
        collectionSelection: JSON.parse(JSON.stringify(collectionSelection)),
      };
      await tx.downloadHistory.updateMany({ where: { requestId: request.id, selected: true }, data: { selected: false } });
      records.push(await tx.downloadHistory.create({ data }));
    }
    return records;
  }, { timeout: 120000 });

  let clientTouched = false;
  try {
    // Manifests are committed before client mutation so cleanup can see every protected source.
    await prisma.$transaction(async tx => {
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('rmab-collection'), hashtext(${hash})) AS locked`;
      if (!lock?.locked) throw new CollectionError('Another collection operation is active. Preview again after it completes', 409);
      const activeCount = await tx.request.count({ where: { id: { in: requestIds }, status: 'downloading', deletedAt: null } });
      if (activeCount !== requestIds.length) throw new CollectionError('A mapped request was deleted or changed before selection', 409);
      await prepareCollectionSelection(client, metadata, selectedIndexes, limits, batchId, () => { clientTouched = true; });
      const queue = getJobQueueService();
      for (const history of histories) await queue.addMonitorJob(history.requestId, history.id, hash, 'qbittorrent', 3);
      await client.startCollectionTorrent(hash);
      await tx.downloadHistory.updateMany({ where: { id: { in: histories.map(h => h.id) } }, data: { downloadStatus: 'downloading' } });
    }, { timeout: 120000 });
  } catch (error) {
    let stopped = !clientTouched;
    if (clientTouched) {
      try { await client.stopCollectionTorrent(hash); stopped = true; } catch { /* Preserve the original failure and require inspection. */ }
    }
    const detail = error instanceof CollectionError ? error.message : 'Collection handoff failed';
    const state = !clientTouched ? 'No client selection was changed.' : stopped ? 'Torrent was stopped.' : 'Could not confirm torrent stop. Inspect qBittorrent now.';
    await prisma.request.updateMany({
      where: { id: { in: requestIds }, status: 'downloading' },
      data: { status: 'failed', errorMessage: `${detail} ${state} Saved manifests were retained` },
    });
    await prisma.downloadHistory.updateMany({
      where: { id: { in: histories.map(h => h.id) } }, data: { downloadStatus: 'failed', downloadError: `${detail} ${state}` },
    });
    throw new CollectionError(`${detail} ${state} Preview again before retrying`, error instanceof CollectionError ? error.status : 502);
  }
  return { success: true, batchId, infoHash: hash, requestIds, selectedFiles: selectedIndexes.size,
    selectedBytes: [...mapped.values()].flat().reduce((sum, file) => sum + file.size, 0) };
}
