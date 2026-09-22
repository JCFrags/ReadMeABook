/**
 * Component: Reported Issue Target Resolution
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { prisma } from '@/lib/db';
import { getConfigService } from './config.service';
import { getSiblingAsins } from './works.service';
import { reportTarget, type ReportTarget } from '@/lib/types/reported-issues';

export class ReportedIssueError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ReportedIssueError';
  }
}

const librarySelect = {
  plexGuid: true, plexRatingKey: true, plexLibraryId: true,
  asin: true, title: true, author: true, narrator: true,
} as const;
type LibraryMatch = {
  plexGuid: string; plexRatingKey: string | null; plexLibraryId: string;
  asin: string | null; title: string; author: string; narrator: string | null;
};

function matchesAsin(library: LibraryMatch, asin: string): boolean {
  // A dedicated ASIN takes precedence over a conflicting legacy GUID.
  if (library.asin) return library.asin.toUpperCase() === asin.toUpperCase();
  return new RegExp(`(?:^|[^a-z0-9])${asin}(?:$|[^a-z0-9])`, 'i').test(library.plexGuid);
}

function unambiguous(matches: LibraryMatch[]): LibraryMatch | null {
  if (matches.length > 1) {
    throw new ReportedIssueError('Multiple library items match this audiobook. An administrator must check the target.', 409);
  }
  return matches[0] ?? null;
}

/** Reporting alone expands known works. Strict acquisition matchers stay unchanged. */
export async function resolveReportedAudiobook(asin: string) {
  const siblings = await getSiblingAsins([asin]);
  const relatedAsins = [...new Set([asin, ...(siblings.get(asin) ?? [])])];
  const exact = await prisma.plexLibrary.findMany({
    where: { OR: [{ asin: { equals: asin, mode: 'insensitive' } }, { plexGuid: { contains: asin, mode: 'insensitive' } }] },
    select: librarySelect,
  });
  let library = unambiguous(exact.filter(item => matchesAsin(item, asin)));
  let match: ReportTarget['match'] = 'exact';
  if (!library && relatedAsins.length > 1) {
    library = unambiguous(await prisma.plexLibrary.findMany({
      where: { asin: { in: relatedAsins.slice(1), mode: 'insensitive' } }, select: librarySelect,
    }));
    match = 'sibling';
  }
  if (!library) throw new ReportedIssueError('This audiobook is not currently in your library', 404);
  const backend = await getConfigService().getBackendMode();
  if (backend !== 'plex' && backend !== 'audiobookshelf') {
    throw new ReportedIssueError('Library backend is not configured', 409);
  }
  const target: ReportTarget = {
    type: 'audiobook', backend, libraryItemId: library.plexGuid,
    asin: library.asin?.toUpperCase() || asin, match,
  };
  return { library, target, relatedAsins };
}

type ReplacementSource = {
  kind: string; status: string; target: unknown;
  audiobook: { audibleAsin: string | null; plexGuid: string | null; absItemId: string | null } | null;
};

/** Recheck the stored identity, never silently redirect a report to a new library item. */
export async function getReplacementTarget(issue: ReplacementSource): Promise<ReportTarget | null> {
  if (issue.kind !== 'audiobook' || issue.status !== 'open' || !issue.audiobook) return null;
  const book = issue.audiobook;
  let target = reportTarget(issue.target);
  if (!target) {
    // Legacy reports have no target snapshot. Resolve their exact ASIN only.
    if (issue.target !== null || !book.audibleAsin) return null;
    try {
      const resolved = await resolveReportedAudiobook(book.audibleAsin);
      if (resolved.target.match !== 'exact') return null;
      target = resolved.target;
    } catch (error) {
      if (error instanceof ReportedIssueError) return null;
      throw error;
    }
  }
  if (target.backend !== await getConfigService().getBackendMode()) return null;
  const library = await prisma.plexLibrary.findUnique({ where: { plexGuid: target.libraryItemId }, select: librarySelect });
  if (!library || !target.asin || !matchesAsin(library, target.asin)) return null;
  const linkedId = target.backend === 'audiobookshelf' ? book.absItemId : book.plexGuid;
  if (linkedId && linkedId !== target.libraryItemId) return null;
  if (!linkedId && book.audibleAsin?.toUpperCase() !== target.asin.toUpperCase()) return null;
  return target;
}
