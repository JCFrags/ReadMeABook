/**
 * Component: Format-aware Reporting Regression Checks
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = {
  ...createPrismaMock(),
  reportedIssue: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
};
const queue = vi.hoisted(() => ({ addNotificationJob: vi.fn(), addDownloadJob: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getBackendMode: async () => 'audiobookshelf' }) }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => queue }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (request: any, handler: any) => handler({ ...request, user: { id: 'user-1' } }),
  requireAdmin: (_request: any, handler: any) => handler(),
}));

const submitted = '1473231191';
const owned = '1250807832';
const library = {
  plexGuid: 'owned-library-item', plexRatingKey: null, plexLibraryId: 'audio-library',
  asin: owned, title: 'Owned title', author: 'Owned author', narrator: 'Owned narrator',
};
const book = {
  id: 'book-1', audibleAsin: owned, title: library.title, author: library.author,
  coverArtUrl: null, plexGuid: null, absItemId: library.plexGuid,
};
const target = { type: 'audiobook', backend: 'audiobookshelf', libraryItemId: library.plexGuid, asin: owned, match: 'sibling' };
const reporter = { id: 'user-1', plexUsername: 'Example User', avatarUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workAsin.findMany.mockImplementation(async ({ where }: any) => where.asin
    ? [{ asin: where.asin.in[0], workId: 'work-1' }]
    : [submitted, owned].map(asin => ({ asin, workId: 'work-1' })));
  prismaMock.plexLibrary.findMany.mockImplementation(async ({ where }: any) =>
    where.OR ? (where.OR[0].asin.equals === owned ? [library] : []) : [library]);
  prismaMock.plexLibrary.findUnique.mockResolvedValue(library);
  prismaMock.audiobook.findFirst.mockResolvedValue(null);
  prismaMock.audibleCache.findUnique.mockResolvedValue(null);
  prismaMock.audiobook.create.mockImplementation(async ({ data }: any) => ({ ...book, ...data }));
  prismaMock.audiobook.update.mockImplementation(async ({ data }: any) => ({ ...book, ...data }));
  prismaMock.reportedIssue.findFirst.mockResolvedValue(null);
  prismaMock.reportedIssue.create.mockImplementation(async ({ data }: any) => ({
    id: 'issue-1', status: 'open', target: null, bookContext: null, ...data,
    audiobook: data.audiobookId ? book : null, reporter, createdAt: new Date(),
  }));
  queue.addNotificationJob.mockResolvedValue(undefined);
});

async function post(body: unknown) {
  const { POST } = await import('@/app/api/reported-issues/route');
  return POST({ json: async () => body } as any);
}

describe('Format-aware reports', () => {
  it('accepts the known sibling ASIN through the shared API and links the actual owned audio item', async () => {
    const response = await post({
      kind: 'audiobook', asin: submitted, reason: ' Wrong recording ', title: 'Untrusted title',
      target: { libraryItemId: 'different-item' }, filePath: '/untrusted/path',
    });
    expect(response.status).toBe(201);
    const { issue } = await response.json();
    expect(issue).toMatchObject({ submittedAsin: submitted, target, canReplace: true, reason: 'Wrong recording', book: { asin: owned, title: library.title } });
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ audibleAsin: owned, absItemId: library.plexGuid, title: library.title }) });
    expect(prismaMock.reportedIssue.create.mock.calls[0][0].data).not.toHaveProperty('filePath');
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(queue.addDownloadJob).not.toHaveBeenCalled();

    prismaMock.audiobook.findFirst.mockResolvedValue({ ...book, title: 'Existing request title' });
    const existing = await post({ kind: 'audiobook', asin: submitted, reason: 'Report with existing relation' });
    expect((await existing.json()).issue.book.title).toBe(library.title);
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  });

  it('deduplicates audio by known linked ASINs while accepting a separate uncached ebook', async () => {
    prismaMock.reportedIssue.findFirst.mockImplementation(async ({ where }: any) => where.kind === 'audiobook' ? { id: 'open-audio' } : null);
    expect((await post({ kind: 'audiobook', asin: submitted, reason: 'Audio issue' })).status).toBe(409);
    expect(prismaMock.reportedIssue.findFirst.mock.calls[0][0].where).toMatchObject({
      kind: 'audiobook', OR: expect.arrayContaining([{ audiobook: { audibleAsin: { in: [submitted, owned] } } }]),
    });
    const response = await post({ kind: 'ebook', asin: submitted, ebookFormat: 'epub', reason: 'Ebook issue' });
    expect(response.status).toBe(201);
    expect((await response.json()).issue).toMatchObject({ kind: 'ebook', ebookFormat: 'epub', target: null, canReplace: false, book: { asin: submitted } });
    expect(prismaMock.reportedIssue.findFirst.mock.lastCall?.[0].where).toEqual({ kind: 'ebook', status: 'open', submittedAsin: submitted, ebookFormat: 'epub' });
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledTimes(2); // Only the preceding audio attempt.
  });

  it('accepts distinct bookless general reports with a bounded reason and rejects blank/oversized reasons', async () => {
    for (const reason of ['Login is broken', 'x'.repeat(2000)]) {
      const response = await post({ kind: 'general', reason });
      expect(response.status).toBe(201);
      expect((await response.json()).issue).toMatchObject({ kind: 'general', book: null, audiobook: null, target: null, canReplace: false });
    }
    expect(prismaMock.reportedIssue.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
    expect((await post({ kind: 'general', reason: '  ' })).status).toBe(400);
    expect((await post({ kind: 'general', reason: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post({ kind: 'audiobook', reason: 'No ASIN' })).status).toBe(400);
  });

  it('does not invent an audio match from a title and rejects ambiguous owned siblings', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    expect((await post({ kind: 'audiobook', asin: submitted, title: library.title, reason: 'Missing' })).status).toBe(404);
    prismaMock.plexLibrary.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([library, { ...library, plexGuid: 'second-item' }]);
    expect((await post({ kind: 'audiobook', asin: submitted, reason: 'Ambiguous' })).status).toBe(409);
    expect(prismaMock.reportedIssue.create).not.toHaveBeenCalled();
  });

  it('keeps the legacy book endpoint audio-only and supports the owned sibling', async () => {
    const { POST } = await import('@/app/api/audiobooks/[asin]/report-issue/route');
    const params = { params: Promise.resolve({ asin: submitted }) };
    expect((await POST({ json: async () => ({ reason: 'Audio issue' }) } as any, params)).status).toBe(201);
    expect((await POST({ json: async () => ({ kind: 'ebook', reason: 'Ebook issue' }) } as any, params)).status).toBe(400);
  });

  it('blocks ebook, general, unknown, and stale targets before any replacement side effects', async () => {
    const { replaceAudiobook } = await import('@/lib/services/reported-issue.service');
    for (const kind of ['ebook', 'general', 'unknown', 'audiobook']) {
      prismaMock.reportedIssue.findUnique.mockResolvedValue({ id: 'issue-1', status: 'open', kind, audiobook: book, target });
      prismaMock.plexLibrary.findUnique.mockResolvedValue(null);
      await expect(replaceAudiobook('issue-1', 'admin-1', {})).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.plexLibrary.deleteMany).not.toHaveBeenCalled();
    expect(queue.addDownloadJob).not.toHaveBeenCalled();
  });

  it('lists bookless reports and reports current replacement eligibility without changing old rows', async () => {
    const { getOpenIssues } = await import('@/lib/services/reported-issue.service');
    prismaMock.reportedIssue.findMany.mockResolvedValue([
      { id: 'general', kind: 'general', status: 'open', audiobook: null, target: null },
      { id: 'audio', kind: 'audiobook', status: 'open', audiobook: book, target },
      { id: 'legacy', kind: 'audiobook', status: 'open', audiobook: { ...book, absItemId: null }, target: null },
    ]);
    const issues = await getOpenIssues();
    expect(issues[0]).toMatchObject({ book: null, target: null, canReplace: false });
    expect(issues[1]).toMatchObject({ target, canReplace: true });
    expect(issues[2]).toMatchObject({ target: { ...target, match: 'exact' }, canReplace: true });
    expect(prismaMock.reportedIssue.update).not.toHaveBeenCalled();
  });

  it('formats long bookless reports within existing generic provider limits', async () => {
    const { DiscordProvider } = await import('@/lib/services/notification/providers/discord.provider');
    const { PushoverProvider } = await import('@/lib/services/notification/providers/pushover.provider');
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 1 }) } as Response);
    try {
      const payload = { event: 'issue_reported' as const, issueId: 'issue-1', title: 'General report', author: 'Not specified', userName: 'Example User', message: 'x'.repeat(2000), timestamp: new Date() };
      await new DiscordProvider().send({ webhookUrl: 'https://example.org/hook' }, payload);
      const embed = JSON.parse(transport.mock.calls[0][1]!.body as string).embeds[0];
      expect(embed.fields.every((field: { value: string }) => field.value.length <= 1024)).toBe(true);
      expect(embed.fields.filter((field: { name: string }) => field.name.startsWith('Reason')).map((field: { value: string }) => field.value).join('')).toBe(payload.message);
      await new PushoverProvider().send({ userKey: 'test-user', appToken: 'test-app' }, payload);
      const message = new URLSearchParams(transport.mock.calls[1][1]!.body as string).get('message')!;
      expect(message.length).toBeLessThanOrEqual(1024);
      expect(message).toContain('Read the full report in RMAB.');
    } finally {
      transport.mockRestore();
    }
  });

  it('keeps report badges audio-only and expands them to the linked displayed ASIN', async () => {
    const { getOpenIssuesByAsins } = await import('@/lib/services/reported-issue.service');
    prismaMock.reportedIssue.findMany.mockResolvedValue([{ submittedAsin: owned, audiobook: { audibleAsin: owned } }]);
    expect(await getOpenIssuesByAsins([submitted])).toEqual(new Set([submitted]));
    expect(prismaMock.reportedIssue.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: 'audiobook' }) }));
  });
});
