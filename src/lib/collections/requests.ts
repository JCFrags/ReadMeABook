/**
 * Component: Collection Request Eligibility
 * Documentation: documentation/features/collection-workflow.md
 */

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { getSiblingAsins } from '@/lib/services/works.service';
import { CollectionError, ELIGIBLE_COLLECTION_STATUSES } from './validation';
import type { CollectionBook } from './types';

export async function listCollectionBooks(anchorRequestId: string): Promise<CollectionBook[]> {
  const anchor = await prisma.request.findFirst({ where: { id: anchorRequestId, deletedAt: null, type: 'audiobook' }, include: { audiobook: true } });
  if (!anchor) throw new CollectionError('Audiobook request not found', 404);
  if (!ELIGIBLE_COLLECTION_STATUSES.includes(anchor.status)) throw new CollectionError('This request is not eligible for collection selection in its current state', 409);
  const requests = await prisma.request.findMany({
    where: { id: { not: anchorRequestId }, deletedAt: null, type: 'audiobook', status: { in: ELIGIBLE_COLLECTION_STATUSES } },
    include: { audiobook: true }, orderBy: { createdAt: 'asc' }, take: 199,
  });
  requests.unshift(anchor);
  return requests.map(({ id, audiobook: a }) => ({
    requestId: id, title: a.title, author: a.author, narrator: a.narrator,
    series: a.series, seriesPart: a.seriesPart, asin: a.audibleAsin,
  })).sort((a, b) => Number(b.requestId === anchorRequestId) - Number(a.requestId === anchorRequestId));
}

export async function validateCollectionRequests(tx: Prisma.TransactionClient, requestIds: string[]) {
  const requests = await tx.request.findMany({ where: { id: { in: requestIds }, deletedAt: null }, include: { audiobook: true } });
  if (requests.length !== requestIds.length) throw new CollectionError('One or more selected requests no longer exist', 409);
  const asins = requests.map(r => r.audiobook.audibleAsin).filter((asin): asin is string => !!asin);
  const siblings = asins.length ? await getSiblingAsins(asins) : new Map<string, string[]>();
  const seen = new Set<string>();
  for (const request of requests) {
    const book = request.audiobook;
    if (request.type !== 'audiobook' || !ELIGIBLE_COLLECTION_STATUSES.includes(request.status)) {
      throw new CollectionError(`Request for "${book.title}" is not eligible. Wait for active work or resolve its current state`, 409);
    }
    const identities = [book.id, `${book.title.toLowerCase()}|${book.author.toLowerCase()}`,
      ...(book.audibleAsin ? [book.audibleAsin, ...(siblings.get(book.audibleAsin) || [])] : [])];
    if (identities.some(id => seen.has(id))) throw new CollectionError('The selection contains duplicate book identities', 409);
    identities.forEach(id => seen.add(id));
    if (book.filePath || book.absItemId || book.plexGuid || book.status === 'completed') throw new CollectionError(`"${book.title}" already has library or imported files`, 409);
    if (book.audibleAsin && await findPlexMatch({ asin: book.audibleAsin, title: book.title, author: book.author, narrator: book.narrator || undefined })) {
      throw new CollectionError(`"${book.title}" is already in the library`, 409);
    }
    const duplicate = await tx.request.findFirst({
      where: {
        id: { notIn: requestIds }, deletedAt: null, type: 'audiobook',
        status: { in: ['searching', 'downloading', 'processing', 'awaiting_import', 'downloaded', 'available'] },
        OR: [
          { audiobookId: book.id },
          { audiobook: { title: { equals: book.title, mode: 'insensitive' }, author: { equals: book.author, mode: 'insensitive' } } },
          ...(book.audibleAsin ? [{ audiobook: { audibleAsin: { in: [book.audibleAsin, ...(siblings.get(book.audibleAsin) || [])] } } }] : []),
        ],
      },
    });
    if (duplicate) throw new CollectionError(`Another active or completed request already covers "${book.title}"`, 409);
  }
  return requests;
}
