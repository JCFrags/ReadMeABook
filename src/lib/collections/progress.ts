/**
 * Component: Per-Book Collection Progress
 * Documentation: documentation/features/collection-workflow.md
 */

import type { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import type { CollectionSelection } from './types';
import { CollectionError, collectionHash } from './validation';

export async function collectionProgress(client: QBittorrentService, hash: string, selection: CollectionSelection) {
  if (collectionHash(hash) !== selection.infoHash) throw new CollectionError('Download identity does not match the saved collection selection');
  const torrent = await client.getTorrent(hash);
  const files = new Map((await client.getFiles(hash)).map(file => [file.index, file]));
  let total = 0;
  let completed = 0;
  let allComplete = true;
  for (const expected of selection.files) {
    const file = files.get(expected.index);
    if (!file || file.name !== expected.path || file.size !== expected.size || file.priority <= 0
      || !Number.isFinite(file.progress) || file.progress < 0 || file.progress > 1) {
      throw new CollectionError('Saved collection files changed or were deselected. Review the torrent before retrying');
    }
    total += expected.size;
    completed += file.progress * expected.size;
    allComplete = allComplete && file.progress === 1;
  }
  return {
    progress: total ? completed / total : 0,
    complete: allComplete && !/^(checking|moving|allocating|metaDL|forcedMetaDL)/.test(torrent.state),
  };
}
