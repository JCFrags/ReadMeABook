/**
 * Component: Conditional Search State Changes
 * Documentation: documentation/phase3/search-policy.md
 */

import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import { shouldSkipAutoSearch } from './release-date';
import { SEARCHABLE_STATES } from './search-policy';
import { Prisma } from '@/generated/prisma/client';

export async function hasSelectedCollection(requestId: string): Promise<boolean> {
  return !!await prisma.downloadHistory.findFirst({
    where: { requestId, selected: true, collectionSelection: { not: Prisma.AnyNull } },
    select: { id: true },
  });
}

export async function claimSearchRequest(requestId: string, trigger?: string, jobId?: string) {
  if (!jobId) return null; // Unowned legacy work cannot claim a request.
  const request = await prisma.request.findUnique({ where: { id: requestId }, include: { audiobook: true } });
  const resuming = request?.status === 'searching' && !!jobId && request.activeSearchJobId === jobId;
  if (!request || request.deletedAt || (!SEARCHABLE_STATES.includes(request.status) && !resuming)) return null;
  if (await hasSelectedCollection(requestId)) return null;
  if (!resuming && request.nextSearchAt && request.nextSearchAt > new Date() && trigger !== 'manual' && trigger !== 'initial') {
    if (trigger !== 'rss' || request.lastSearchOutcome === 'provider_error') return null;
  }
  if (trigger !== 'manual') {
    const setting = (await getConfigService().get('indexer.skip_unreleased')) !== 'false';
    if (shouldSkipAutoSearch({ releaseDate: request.releaseDate }, setting).skip) return null;
  }
  const claimed = await prisma.request.updateMany({
    where: { id: requestId, status: request.status, deletedAt: null, activeSearchJobId: request.activeSearchJobId },
    data: { status: 'searching', activeSearchJobId: jobId || null, searchAttempts: { increment: resuming ? 0 : 1 }, lastSearchAt: new Date() },
  });
  return claimed.count === 1 ? request : null;
}

/** A collection/manual claim or cancellation wins over an already running search. */
export async function finishSearchRequest(requestId: string, data: Record<string, unknown>, jobId?: string): Promise<boolean> {
  const updated = await prisma.request.updateMany({
    where: { id: requestId, status: 'searching', deletedAt: null, activeSearchJobId: jobId || null },
    data: { ...data, activeSearchJobId: null },
  });
  return updated.count === 1;
}
