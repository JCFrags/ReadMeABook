/**
 * Component: Search Policy Safety Tests
 * Documentation: documentation/phase3/search-policy.md
 */

import { describe, expect, it } from 'vitest';
import { noMatchPolicy, providerFailurePolicy, retryAfterMs, SearchProviderError } from '@/lib/utils/search-policy';
import { assessAudioIdentity } from '@/lib/utils/audio-identity';
import { buildDiscoveryQueries } from '@/lib/utils/search-discovery';

const DAY = 86400000;
const now = new Date('2026-01-01T00:00:00Z');

describe('search policy safety', () => {
  it('uses current no-match count for the 1, 3, 7, 14 day ladder, including wrong format', () => {
    [1, 3, 7, 14, 14].forEach((days, count) => {
      expect(noMatchPolicy(count, 'no_results', now)).toMatchObject({
        consecutiveNoMatch: count + 1,
        nextSearchAt: new Date(now.getTime() + days * DAY),
      });
    });
    expect(noMatchPolicy(0, 'wrong_format', now).lastSearchOutcome).toBe('wrong_format');
  });

  it('bounds Retry-After and does not count a provider failure as a miss', () => {
    expect(retryAfterMs('120', now)).toBe(120000);
    expect(retryAfterMs('Thu, 01 Jan 2026 02:00:00 GMT', now)).toBe(7200000);
    expect(retryAfterMs('9999999', now)).toBe(DAY);
    expect(retryAfterMs('0', now)).toBe(60000);
    expect(providerFailurePolicy(new SearchProviderError(120000, 429), now)).toEqual({
      nextSearchAt: new Date(now.getTime() + 120000), lastSearchAt: now, lastSearchOutcome: 'provider_error',
    });
  });

  it('bounds discovery and preserves canonical query variants with custom terms', () => {
    const queries = buildDiscoveryQueries('Example.Title: Volume 2', 'Example Author', {
      customSearchTerms: 'Short query', series: 'Example Series', seriesPart: '2',
    });
    expect(queries).toEqual(['Short query Example Author', 'Short query', 'Example Title Volume 2', 'Example Series 2 Example Author']);
  });

  it('rejects explicit ebook/video-only releases even above the old size threshold', () => {
    for (const title of ['Example Book EPUB PDF', 'Example Book 1080p MKV']) {
      expect(assessAudioIdentity({ title }, { title: 'Example Book' }).status).toBe('conflict');
    }
  });

  it('rejects wrong edition/volume and withholds missing requested edition/volume', () => {
    const canonical = { title: 'Example Book (2nd Edition)', seriesPart: '2' };
    expect(assessAudioIdentity({ title: 'Example Book 1st Edition Volume 3 M4B' }, canonical).status).toBe('conflict');
    expect(assessAudioIdentity({ title: 'Example Book M4B' }, canonical).status).toBe('unknown');
  });

  it('rejects explicit language and narrator conflicts without requiring an unstated narrator', () => {
    const canonical = { title: 'Example Book', narrator: 'Example Reader', preferredLanguage: 'en' };
    expect(assessAudioIdentity({ title: 'Example Book [German] M4B' }, canonical).status).toBe('conflict');
    expect(assessAudioIdentity({ title: 'Example Book - Read by Different Reader - M4B' }, canonical).status).toBe('conflict');
    const missing = assessAudioIdentity({ title: 'Example Book M4B' }, canonical);
    expect(missing.status).toBe('compatible');
    expect(missing.unverified).toContain('Catalog narrator is not confirmed by release metadata');
  });

  it('keeps unknown audio format and collection files for a manual decision', () => {
    expect(assessAudioIdentity({ title: 'Example Book' }, { title: 'Example Book' }).status).toBe('unknown');
    expect(assessAudioIdentity({ title: 'Example Book Collection M4B' }, { title: 'Example Book' }).status).toBe('unknown');
  });
});
