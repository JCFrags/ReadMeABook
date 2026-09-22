/**
 * Component: Reported Issue Service
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { z } from 'zod';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import {
  REPORT_REASON_MAX_LENGTH, ebookFormat, reportBook, reportKind, reportTarget,
  type ReportBookContext, type ReportIssueInput,
} from '@/lib/types/reported-issues';
import { getSiblingAsins } from './works.service';
import { getReplacementTarget, resolveReportedAudiobook, ReportedIssueError } from './reported-issue-target.service';

export { ReportedIssueError } from './reported-issue-target.service';
export { replaceAudiobook } from './reported-issue-replacement.service';
const logger = RMABLogger.create('ReportedIssue');

export const ReportIssueSchema = z.object({
  kind: z.enum(['audiobook', 'ebook', 'general']),
  reason: z.string().trim().min(1, 'Reason is required').max(REPORT_REASON_MAX_LENGTH),
  asin: z.string().trim().regex(/^[a-z0-9]{10}$/i, 'ASIN must contain 10 letters or numbers').transform(value => value.toUpperCase()).optional(),
  title: z.string().trim().max(500).optional(),
  author: z.string().trim().max(500).optional(),
  coverArtUrl: z.string().trim().max(2000).url().refine(value => /^https?:\/\//i.test(value), 'Cover URL must use HTTP(S)').optional(),
  ebookFormat: z.enum(['epub', 'pdf', 'unknown']).optional(),
}).superRefine((input, context) => {
  if (input.kind === 'audiobook' && !input.asin) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['asin'], message: 'Audiobook reports require an ASIN' });
  }
});

const include = {
  audiobook: { select: { id: true, title: true, author: true, audibleAsin: true, coverArtUrl: true, plexGuid: true, absItemId: true } },
  reporter: { select: { id: true, plexUsername: true, avatarUrl: true } },
} as const;

type IssueWithBook = Prisma.ReportedIssueGetPayload<{ include: typeof include }>;
function presentIssue(issue: IssueWithBook, target = reportTarget(issue.target), canReplace = false) {
  return {
    ...issue, kind: reportKind(issue.kind), ebookFormat: issue.kind === 'ebook' ? ebookFormat(issue.ebookFormat) : null,
    book: reportBook(issue), target, canReplace,
  };
}

/** Backward-compatible entry point, always an audiobook report. */
export async function reportIssue(asin: string, reporterId: string, reason: string, metadata?: Omit<ReportIssueInput, 'kind' | 'reason' | 'asin'>) {
  return createReportedIssue({ ...metadata, kind: 'audiobook', asin, reason }, reporterId);
}

export async function createReportedIssue(rawInput: ReportIssueInput, reporterId: string) {
  const input = ReportIssueSchema.parse(rawInput);
  let audiobookId: string | null = null;
  let book: ReportBookContext | null = null;
  let target = null as ReturnType<typeof reportTarget>;

  if (input.kind === 'audiobook') {
    const resolved = await resolveReportedAudiobook(input.asin!);
    target = resolved.target;
    const existingIssue = await prisma.reportedIssue.findFirst({
      where: {
        kind: 'audiobook', status: 'open',
        OR: [
          { audiobook: { audibleAsin: { in: resolved.relatedAsins } } },
          { submittedAsin: { in: resolved.relatedAsins } },
          { AND: [
            { target: { path: ['libraryItemId'], equals: target.libraryItemId } },
            { target: { path: ['backend'], equals: target.backend } },
          ] },
        ],
      },
    });
    if (existingIssue) throw new ReportedIssueError('An issue has already been reported for this audiobook', 409);
    const link = target.backend === 'audiobookshelf' ? { absItemId: target.libraryItemId } : { plexGuid: target.libraryItemId };
    let audiobook = await prisma.audiobook.findFirst({ where: link });
    if (!audiobook) audiobook = await prisma.audiobook.findFirst({ where: { audibleAsin: target.asin } });
    const linkedId = target.backend === 'audiobookshelf' ? audiobook?.absItemId : audiobook?.plexGuid;
    if (linkedId && linkedId !== target.libraryItemId) {
      throw new ReportedIssueError('The audiobook points to a different library item. An administrator must check the target.', 409);
    }
    const cached = target.asin ? await prisma.audibleCache.findUnique({ where: { asin: target.asin } }) : null;
    const canonical = {
      title: resolved.library.title, author: resolved.library.author,
      narrator: resolved.library.narrator, ...link, plexLibraryId: resolved.library.plexLibraryId,
    };
    // A report snapshots canonical context. It must not rewrite an existing request/catalog row.
    if (!audiobook) {
      audiobook = await prisma.audiobook.create({
        data: { ...canonical, audibleAsin: target.asin, coverArtUrl: cached?.coverArtUrl, status: 'completed' },
      });
    }
    audiobookId = audiobook.id;
    book = {
      id: audiobook.id, asin: target.asin, title: canonical.title, author: canonical.author,
      coverArtUrl: cached?.coverArtUrl ?? audiobook.coverArtUrl ?? null,
    };
  } else {
    // A catalog/book record is context only. It does not prove that an ebook file exists.
    const existing = input.asin ? await prisma.audiobook.findFirst({ where: { audibleAsin: input.asin } }) : null;
    const cached = input.asin ? await prisma.audibleCache.findUnique({ where: { asin: input.asin } }) : null;
    const metadata = cached ?? existing;
    audiobookId = existing?.id ?? null;
    if (input.asin || input.title || input.author || metadata) {
      book = {
        id: audiobookId, asin: input.asin ?? null,
        title: metadata?.title || input.title || 'Unspecified book',
        author: metadata?.author || input.author || 'Unknown author',
        coverArtUrl: metadata?.coverArtUrl ?? input.coverArtUrl ?? null,
      };
    }
    if (input.kind === 'ebook' && input.asin) {
      const duplicate = await prisma.reportedIssue.findFirst({
        where: { kind: 'ebook', status: 'open', submittedAsin: input.asin, ebookFormat: input.ebookFormat ?? 'unknown' },
      });
      if (duplicate) throw new ReportedIssueError('An issue has already been reported for this ebook format', 409);
    }
  }

  const issue = await prisma.reportedIssue.create({
    data: {
      audiobookId, reporterId, reason: input.reason, kind: input.kind,
      ebookFormat: input.kind === 'ebook' ? input.ebookFormat ?? 'unknown' : null,
      submittedAsin: input.asin ?? null,
      ...(book ? { bookContext: book as unknown as Prisma.InputJsonValue } : {}),
      ...(target ? { target: target as unknown as Prisma.InputJsonValue } : {}),
    }, include,
  });
  logger.info('Issue reported', { issueId: issue.id, kind: input.kind });
  try {
    const { getJobQueueService } = await import('./job-queue.service');
    const title = input.kind === 'audiobook' ? book!.title
      : input.kind === 'ebook' ? `Ebook (${input.ebookFormat ?? 'unknown'}): ${book?.title ?? 'Unspecified book'}`
      : `General report${book ? `: ${book.title}` : ''}`;
    await getJobQueueService().addNotificationJob(
      'issue_reported', issue.id, title, book?.author ?? 'Not specified', issue.reporter.plexUsername, input.reason, input.kind,
    );
  } catch (error) {
    logger.error('Failed to queue issue_reported notification', { error: error instanceof Error ? error.message : String(error) });
  }
  return presentIssue(issue, target, target !== null);
}

export async function dismissIssue(issueId: string, adminUserId: string) {
  const issue = await prisma.reportedIssue.findUnique({ where: { id: issueId } });
  if (!issue) throw new ReportedIssueError('Issue not found', 404);
  if (issue.status !== 'open') throw new ReportedIssueError('Issue is already resolved', 409);
  return prisma.reportedIssue.update({
    where: { id: issueId }, data: { status: 'dismissed', resolvedAt: new Date(), resolvedById: adminUserId },
  });
}

export async function getOpenIssues() {
  const issues = await prisma.reportedIssue.findMany({ where: { status: 'open' }, include, orderBy: { createdAt: 'desc' } });
  return Promise.all(issues.map(async issue => {
    const replacementTarget = await getReplacementTarget(issue);
    return presentIssue(issue, reportTarget(issue.target) ?? replacementTarget, replacementTarget !== null);
  }));
}

/** The existing badge means an audiobook issue, including its known sibling ASINs. */
export async function getOpenIssuesByAsins(asins: string[]): Promise<Set<string>> {
  if (!asins.length) return new Set();
  const siblingMap = await getSiblingAsins(asins);
  const expanded = [...new Set([...asins, ...[...siblingMap.values()].flat()])];
  const issues = await prisma.reportedIssue.findMany({
    where: { kind: 'audiobook', status: 'open', OR: [
      { audiobook: { audibleAsin: { in: expanded } } }, { submittedAsin: { in: expanded } },
    ] },
    select: { submittedAsin: true, audiobook: { select: { audibleAsin: true } } },
  });
  const reported = new Set(issues.flatMap(issue => [issue.audiobook?.audibleAsin, issue.submittedAsin].filter((asin): asin is string => !!asin)));
  return new Set(asins.filter(asin => [asin, ...(siblingMap.get(asin) ?? [])].some(candidate => reported.has(candidate))));
}
