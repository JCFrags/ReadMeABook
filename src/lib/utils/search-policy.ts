/**
 * Component: Persisted Search Eligibility
 * Documentation: documentation/phase3/search-policy.md
 */

const DAY = 24 * 60 * 60 * 1000;
const NO_MATCH_DAYS = [1, 3, 7, 14];
export const DEFAULT_PROVIDER_DELAY_MS = 60 * 60 * 1000;
export const SEARCHABLE_STATES = ['pending', 'failed', 'awaiting_search', 'awaiting_release'];

export function resetSearchPolicy() {
  return { nextSearchAt: null, consecutiveNoMatch: 0, lastSearchOutcome: null, activeSearchJobId: null };
}

export function dueSearchFilter(now = new Date()) {
  return { OR: [{ nextSearchAt: null }, { nextSearchAt: { lte: now } }] };
}

export function noMatchPolicy(
  previousCount: number,
  outcome: 'no_results' | 'all_rejected' | 'wrong_format',
  now = new Date()
) {
  const consecutiveNoMatch = Math.max(0, previousCount || 0) + 1;
  const days = NO_MATCH_DAYS[Math.min(consecutiveNoMatch - 1, NO_MATCH_DAYS.length - 1)];
  return {
    consecutiveNoMatch,
    nextSearchAt: new Date(now.getTime() + days * DAY),
    lastSearchAt: now,
    lastSearchOutcome: outcome,
  };
}

/** Accept only an explicit HTTP Retry-After, never an untrusted error message. */
export function retryAfterMs(value: unknown, now = new Date()): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const delay = /^\d+(\.\d+)?$/.test(text)
    ? Number(text) * 1000
    : Date.parse(text) - now.getTime();
  if (!Number.isFinite(delay)) return undefined;
  return Math.min(DAY, Math.max(60 * 1000, delay));
}

/** Safe error metadata: no provider URL, response body, or credentials. */
export class SearchProviderError extends Error {
  constructor(public readonly retryDelayMs = DEFAULT_PROVIDER_DELAY_MS, public readonly status?: number) {
    super(status ? `Search provider returned HTTP ${status}` : 'Search provider unavailable');
    this.name = 'SearchProviderError';
  }
}

export function asSearchProviderError(error: unknown): SearchProviderError {
  if (error instanceof SearchProviderError) return error;
  const response = (error as { response?: { status?: number; headers?: Record<string, unknown> } })?.response;
  return new SearchProviderError(retryAfterMs(response?.headers?.['retry-after']), response?.status);
}

export function providerFailurePolicy(error: unknown, now = new Date()) {
  const providerError = asSearchProviderError(error);
  return {
    nextSearchAt: new Date(now.getTime() + Math.min(DAY, Math.max(60 * 1000, providerError.retryDelayMs))),
    lastSearchAt: now,
    lastSearchOutcome: 'provider_error',
  };
}
