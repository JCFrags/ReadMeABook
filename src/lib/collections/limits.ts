/**
 * Component: Collection Limits
 * Documentation: documentation/features/collection-workflow.md
 */

import { getConfigService } from '@/lib/services/config.service';
import type { CollectionLimits } from './types';
import { CollectionError, DEFAULT_COLLECTION_LIMITS } from './validation';

export const COLLECTION_LIMIT_KEYS: Record<keyof CollectionLimits, string> = {
  maxSelectedBytes: 'collection_max_selected_bytes',
  maxSelectedFiles: 'collection_max_selected_files',
  maxTotalBytes: 'collection_max_total_bytes',
  maxTorrentFiles: 'collection_max_torrent_files',
};

export function validateCollectionLimits(input: CollectionLimits): CollectionLimits {
  for (const key of Object.keys(COLLECTION_LIMIT_KEYS) as Array<keyof CollectionLimits>) {
    if (!Number.isSafeInteger(input[key]) || input[key] <= 0) throw new CollectionError('Collection limits must be positive safe integers');
  }
  if (input.maxSelectedBytes > input.maxTotalBytes || input.maxSelectedFiles > input.maxTorrentFiles
    || input.maxTorrentFiles > 50000 || input.maxSelectedFiles > 2000 || input.maxSelectedBytes > 100 * 1024 ** 3) {
    throw new CollectionError('Collection limits are inconsistent or exceed 100 GiB, 2000 selected files, or 50000 metadata files');
  }
  return input;
}

export async function getCollectionLimits(): Promise<CollectionLimits> {
  const values = await getConfigService().getMany(Object.values(COLLECTION_LIMIT_KEYS));
  const limits = { ...DEFAULT_COLLECTION_LIMITS };
  for (const key of Object.keys(COLLECTION_LIMIT_KEYS) as Array<keyof CollectionLimits>) {
    const value = values[COLLECTION_LIMIT_KEYS[key]];
    if (value != null) limits[key] = Number(value);
  }
  return validateCollectionLimits(limits);
}
