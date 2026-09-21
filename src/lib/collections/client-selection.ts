/**
 * Component: Stopped Collection File Selection
 * Documentation: documentation/features/collection-workflow.md
 */

import type { QBittorrentService, TorrentInfo } from '@/lib/integrations/qbittorrent.service';
import type { CollectionMetadata } from './metadata';
import { fromClientFiles } from './metadata';
import type { CollectionFile, CollectionLimits } from './types';
import { CollectionError, fileFingerprint, validateFileList } from './validation';

const STOPPED = new Set(['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP']);

async function waitStopped(client: QBittorrentService, hash: string): Promise<TorrentInfo> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const torrent = await client.findTorrent(hash);
    if (torrent && STOPPED.has(torrent.state)) return torrent;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new CollectionError('Torrent did not reach a verified stopped state. It was not started', 409);
}

function sameFiles(expected: CollectionFile[], actual: CollectionFile[]): boolean {
  const byIndex = new Map(actual.map(f => [f.index, f]));
  return expected.length === actual.length && expected.every(f => {
    const match = byIndex.get(f.index);
    return match?.path === f.path && match.size === f.size;
  });
}

/** Caller must serialize operations for this hash. Success leaves the torrent STOPPED. */
export async function prepareCollectionSelection(
  client: QBittorrentService,
  metadata: CollectionMetadata,
  selectedIndexes: Set<number>,
  limits: CollectionLimits,
  batchId: string,
  onMutation: () => void = () => {},
): Promise<void> {
  const hash = metadata.infoHash;
  let current = await client.findTorrent(hash);
  if (!!current !== metadata.existing) throw new CollectionError('Torrent state changed. Preview the collection again', 409);
  if (metadata.existing) {
    const files = fromClientFiles(await client.getFiles(hash));
    if (fileFingerprint(hash, files) !== fileFingerprint(hash, metadata.files)) throw new CollectionError('Torrent files or priorities changed. Preview again', 409);
    if (files.some(f => f.priority > 0 && f.progress < 1 && !selectedIndexes.has(f.index))) {
      throw new CollectionError('Existing torrent has unrelated incomplete selected files. Resolve that selection in qBittorrent before expanding this collection', 409);
    }
    onMutation();
    await client.stopCollectionTorrent(hash);
  } else {
    if (!metadata.torrentBuffer) throw new CollectionError('Resolved .torrent metadata is required');
    const result = await client.addCollectionTorrent(metadata.torrentBuffer, hash, `rmab-collection-${batchId}`);
    if (!result.created) throw new CollectionError('Torrent was added by another operation. Preview again', 409);
    onMutation();
  }
  current = await waitStopped(client, hash);
  if (!metadata.existing && (!current.tags.split(',').map(t => t.trim()).includes(`rmab-collection-${batchId}`) || current.downloaded > 0)) {
    throw new CollectionError('New torrent ownership or stopped-add verification failed. Torrent remains stopped', 409);
  }
  let actual = fromClientFiles(await client.getFiles(hash));
  validateFileList(actual, limits);
  if (!sameFiles(metadata.files, actual)) throw new CollectionError('qBittorrent file identities differ from the preview. Torrent remains stopped', 409);
  if (metadata.existing && fileFingerprint(hash, actual) !== fileFingerprint(hash, metadata.files)) {
    throw new CollectionError('Existing file priorities changed during selection. Torrent remains stopped', 409);
  }
  if (!metadata.existing) {
    await client.setFilePriority(hash, actual.map(f => f.index), 0);
    actual = fromClientFiles(await client.getFiles(hash));
    if (!sameFiles(metadata.files, actual) || actual.some(f => f.priority !== 0)) {
      throw new CollectionError('Could not clear all new torrent file priorities. Torrent remains stopped', 409);
    }
  }
  const retained = new Map(actual.map(f => [f.index, f.priority]));
  const additions = actual.filter(f => selectedIndexes.has(f.index) && f.priority === 0).map(f => f.index);
  if (additions.length) await client.setFilePriority(hash, additions, 1);
  const verified = fromClientFiles(await client.getFiles(hash));
  if (!sameFiles(metadata.files, verified) || verified.some(f => f.priority !== (selectedIndexes.has(f.index) ? retained.get(f.index) || 1 : retained.get(f.index)))) {
    throw new CollectionError('Selected file priorities could not be verified. Torrent remains stopped', 409);
  }
  const stopped = await client.getTorrent(hash);
  if (!STOPPED.has(stopped.state)) {
    await client.stopCollectionTorrent(hash);
    throw new CollectionError('Torrent state changed during validation. It was stopped again', 409);
  }
}
