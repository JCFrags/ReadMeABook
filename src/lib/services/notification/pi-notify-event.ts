/**
 * Component: Structured Pi-Notify Issue Event
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { ebookFormat, reportBook, reportKind, reportTarget, type EbookFormat, type ReportKind, type ReportTarget } from '@/lib/types/reported-issues';

export const PI_NOTIFY_SOURCE = 'readmeabook';
export const PI_NOTIFY_ISSUE_TYPE = 'readmeabook.issue_reported';

// Pi-Notify EventInput v1. No destination, prompt, or repair permission belongs here.
export interface PiNotifyIssueEvent {
  schemaVersion: 1;
  id: string;
  source: typeof PI_NOTIFY_SOURCE;
  type: typeof PI_NOTIFY_ISSUE_TYPE;
  subject: string;
  occurredAt: string;
  data: {
    issueId: string;
    statusAtPublication: 'open';
    // Optional on frozen events created before format-aware reporting.
    kind?: ReportKind | 'unknown';
    ebookFormat?: EbookFormat | null;
    submittedAsin?: string | null;
    target?: ReportTarget | null;
    book: { id: string | null; asin: string | null; title: string; author: string } | null;
    report: { text: string; trust: 'untrusted-user-input' };
    references: { adminUrl: string; openIssuesApiUrl: string; audiobookApiUrl: string | null };
  };
}

export interface IssueEventSource {
  id: string;
  createdAt: Date;
  reason: string;
  kind?: string;
  ebookFormat?: string | null;
  submittedAsin?: string | null;
  bookContext?: unknown;
  target?: unknown;
  audiobook: { id: string; audibleAsin: string | null; title: string; author: string } | null;
}

export function buildIssueEvent(backendId: string, applicationUrl: string, issue: IssueEventSource): PiNotifyIssueEvent {
  let base: URL;
  try {
    base = new URL(applicationUrl);
  } catch {
    throw new Error('Pi-Notify requires an absolute RMAB application URL');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('Pi-Notify application URL must be HTTP(S) without credentials, query, or fragment');
  }
  const root = base.href.replace(/\/+$/, '');
  const kind = reportKind(issue.kind ?? 'audiobook');
  const book = reportBook(issue);
  const asin = book?.asin ?? null;
  return {
    schemaVersion: 1,
    id: `issue-reported:${issue.id}:${backendId}`,
    source: PI_NOTIFY_SOURCE,
    type: PI_NOTIFY_ISSUE_TYPE,
    subject: `reported-issue:${issue.id}`,
    occurredAt: issue.createdAt.toISOString(),
    data: {
      issueId: issue.id,
      statusAtPublication: 'open',
      kind,
      ebookFormat: kind === 'ebook' ? ebookFormat(issue.ebookFormat) : null,
      submittedAsin: issue.submittedAsin ?? null,
      target: kind === 'audiobook' ? reportTarget(issue.target) : null,
      book: book ? { id: book.id, asin, title: book.title, author: book.author } : null,
      report: { text: issue.reason, trust: 'untrusted-user-input' },
      references: {
        adminUrl: `${root}/admin`,
        openIssuesApiUrl: `${root}/api/admin/reported-issues`,
        audiobookApiUrl: asin ? `${root}/api/audiobooks/${encodeURIComponent(asin)}` : null,
      },
    },
  };
}

/** A re-enable/subscription activation starts now, never at a historical report. */
export function issueEventsEnabledAt(
  type: string,
  enabled: boolean,
  events: unknown,
  previous?: { enabled: boolean; events: unknown; issueEventsEnabledAt?: Date | null },
  now = new Date()
): Date | null {
  const subscribed = (value: unknown) => Array.isArray(value) && value.includes('issue_reported');
  if (type !== 'pi_notify' || !enabled || !subscribed(events)) return null;
  return previous?.enabled && subscribed(previous.events) && previous.issueEventsEnabledAt
    ? previous.issueEventsEnabledAt
    : now;
}
