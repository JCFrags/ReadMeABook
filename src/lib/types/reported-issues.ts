/**
 * Component: Reported Issue Contract
 * Documentation: documentation/backend/services/reported-issues.md
 */

export type ReportKind = 'audiobook' | 'ebook' | 'general';
export type EbookFormat = 'epub' | 'pdf' | 'unknown';
export const REPORT_REASON_MAX_LENGTH = 2000;

export interface ReportIssueInput {
  kind: ReportKind;
  reason: string;
  asin?: string;
  title?: string;
  author?: string;
  coverArtUrl?: string;
  ebookFormat?: EbookFormat;
}

export interface ReportBookContext {
  id: string | null;
  asin: string | null;
  title: string;
  author: string;
  coverArtUrl: string | null;
}

export interface ReportTarget {
  type: 'audiobook';
  backend: 'plex' | 'audiobookshelf';
  libraryItemId: string;
  asin: string | null;
  match: 'exact' | 'sibling';
}

export interface ReportedIssue {
  id: string;
  kind: ReportKind | 'unknown';
  reason: string;
  status: string;
  ebookFormat: EbookFormat | null;
  submittedAsin: string | null;
  book: ReportBookContext | null;
  target: ReportTarget | null;
  canReplace: boolean;
  audiobook: {
    id: string;
    title: string;
    author: string;
    coverArtUrl: string | null;
    audibleAsin: string | null;
  } | null;
  reporter: { id: string; plexUsername: string; avatarUrl: string | null };
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedById: string | null;
}

export function reportKind(value: unknown): ReportKind | 'unknown' {
  return value === 'audiobook' || value === 'ebook' || value === 'general' ? value : 'unknown';
}

export function ebookFormat(value: unknown): EbookFormat {
  return value === 'epub' || value === 'pdf' ? value : 'unknown';
}

export function reportTarget(value: unknown): ReportTarget | null {
  if (!value || typeof value !== 'object') return null;
  const target = value as ReportTarget;
  return target.type === 'audiobook' && ['plex', 'audiobookshelf'].includes(target.backend) &&
    typeof target.libraryItemId === 'string' && !!target.libraryItemId &&
    (target.asin === null || typeof target.asin === 'string') && ['exact', 'sibling'].includes(target.match)
    ? target : null;
}

/** Context is display data, never a file or replacement instruction. */
export function reportBook(source: {
  bookContext?: unknown;
  audiobook?: { id: string; audibleAsin: string | null; title: string; author: string; coverArtUrl?: string | null } | null;
}): ReportBookContext | null {
  if (source.bookContext && typeof source.bookContext === 'object') {
    const book = source.bookContext as ReportBookContext;
    if (typeof book.title === 'string' && typeof book.author === 'string') {
      return { id: book.id ?? null, asin: book.asin ?? null, title: book.title, author: book.author, coverArtUrl: book.coverArtUrl ?? null };
    }
  }
  const book = source.audiobook;
  return book ? { id: book.id, asin: book.audibleAsin, title: book.title, author: book.author, coverArtUrl: book.coverArtUrl ?? null } : null;
}
