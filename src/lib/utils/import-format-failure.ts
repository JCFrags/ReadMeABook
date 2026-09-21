/**
 * Component: Permanent Import Format Failure
 * Documentation: documentation/phase3/file-organization.md
 */

import { prisma } from '../db';
import { addAutoBlock } from '../services/blocklist.service';
import { noMatchPolicy } from './search-policy';
import type { BundledEbookResult } from './bundled-ebooks';
import type { RMABLogger } from './logger';

/** A format mismatch is a new-search outcome, not a filesystem retry. */
export async function recordWrongFormatImport(
  requestId: string,
  previousNoMatch: number,
  bundledEbooks: BundledEbookResult | undefined,
  jobId: string | undefined,
  logger: RMABLogger,
) {
  const reason = 'Wrong format: download contains EPUB/PDF but no audio. Original files retained. Select an audio release with Interactive Search or wait for the next eligible search.';
  const selected = await prisma.downloadHistory.findFirst({
    where: { requestId, selected: true }, orderBy: { createdAt: 'desc' },
  });
  const block = selected?.torrentName ? await addAutoBlock({
    requestId,
    releaseName: selected.torrentName,
    releaseHash: selected.torrentHash ?? selected.nzbId ?? null,
    indexerName: selected.indexerName ?? null,
    indexerId: selected.indexerId ?? null,
    source: 'organize_fail', reason: 'Wrong format: ebook-only audiobook download',
    reasonDetail: reason, downloadHistoryId: selected.id, jobId,
  }) : null;
  const canSearch = Boolean(block?.blocked);
  const message = canSearch ? reason : `${reason} Automatic search paused because the release block could not be saved. Use Retry Download after resolving the blocklist error.`;
  const updated = await prisma.request.updateMany({
    where: { id: requestId, status: 'processing', deletedAt: null },
    data: {
      status: canSearch ? 'awaiting_search' : 'failed', progress: 0,
      errorMessage: message, lastImportAt: new Date(), updatedAt: new Date(),
      ...noMatchPolicy(previousNoMatch, 'wrong_format'),
    },
  });
  logger.warn(message, { transitioned: updated.count > 0, bundledEbooks });
  return { success: false, failureKind: 'wrong_format', requestId, message, bundledEbooks, automaticSearchEligible: canSearch && updated.count > 0 };
}
