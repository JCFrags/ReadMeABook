/**
 * Component: Grouped Catalog Search Identity Test
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';

const searchMock = vi.hoisted(() => vi.fn());
const collapseMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ search: searchMock }) }));
vi.mock('@/lib/services/works.service', () => ({ persistDedupGroups: vi.fn().mockResolvedValue(undefined), collapseByExistingWorks: collapseMock }));
vi.mock('@/lib/middleware/auth', () => ({ getCurrentUserAsync: vi.fn().mockResolvedValue({ sub: 'user-1' }) }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ enrichAudiobooksWithMatches: vi.fn(async books => books) }));
vi.mock('@/lib/utils/ignored-audiobooks', () => ({ annotateWithIgnoreStatus: vi.fn(async books => books) }));

// These listings collide in the existing title/narrator pass and could also share a Work.
// Only search presentation changes. Acquisition and saved watches keep their existing policy.
describe('Grouped catalog search', () => {
  it('retains distinct exact series IDs and unknown identity through both dedup passes', async () => {
    const books = [
      { asin: 'BOOK000001', title: 'Frost Gate', author: 'Author', seriesAsin: 'SERIES0001' },
      { asin: 'BOOK000002', title: 'Frost Gate', author: 'Author', seriesAsin: 'SERIES0002' },
      { asin: 'BOOK000003', title: 'Frost Gate', author: 'Author' },
    ];
    expect(deduplicateAndCollectGroups(books).books).toHaveLength(1);
    searchMock.mockResolvedValue({ query: 'Frost Gate', results: books, totalResults: 150, page: 1, hasMore: true });
    collapseMock.mockImplementation(async entries => entries.slice(0, 1));

    const { GET } = await import('@/app/api/audiobooks/search/route');
    const response = await GET(new NextRequest('http://localhost/api/audiobooks/search?q=Frost+Gate'));
    const data = await response.json();
    expect(data.results.map((book: { asin: string }) => book.asin)).toEqual(books.map(book => book.asin));
    expect(collapseMock).toHaveBeenCalledTimes(3);
    expect(data.totalResults).toBe(150);
    expect(data.hasMore).toBe(true);
  });
});
