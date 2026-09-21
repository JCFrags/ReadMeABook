/**
 * Component: Collection Source Guard
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { Prisma } from '../../generated/prisma';
import { prisma } from '../db';

interface DownloadReference {
  collectionSelection?: unknown;
  torrentHash?: string | null;
}

/** Keep collection sources for later volumes, including soft-deleted mappings. */
export async function isProtectedCollectionSource(
  download: DownloadReference,
  db: Pick<Prisma.TransactionClient, 'downloadHistory'> = prisma
): Promise<boolean> {
  if (download.collectionSelection != null) return true;
  if (!download.torrentHash) return false;

  // A legacy single-book request can share a torrent later used as a collection.
  // Do not filter selected/deleted requests: their manifests still protect it.
  const collection = await db.downloadHistory.findFirst({
    where: {
      torrentHash: { equals: download.torrentHash, mode: 'insensitive' },
      collectionSelection: { not: Prisma.AnyNull },
    },
    select: { id: true },
  });
  return Boolean(collection);
}

/** Serialize destructive client operations with collection claims and setup. */
export async function removeUnprotectedSource(
  download: DownloadReference,
  remove: () => Promise<void>
): Promise<boolean> {
  if (download.collectionSelection != null) return false;
  if (!download.torrentHash) {
    await remove();
    return true;
  }

  const hash = download.torrentHash.toLowerCase();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext('rmab-collection'), hashtext(${hash})) AS locked
    `;
    if (!rows[0]?.locked || await isProtectedCollectionSource(download, tx)) return false;
    await remove();
    return true;
  }, { timeout: 120000 });
}
