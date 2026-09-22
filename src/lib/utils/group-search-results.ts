/**
 * Component: Grouped Search Results
 * Documentation: documentation/frontend/components.md
 */

import type { Audiobook } from '@/lib/hooks/useAudiobooks';
import type { SeriesSummary } from '@/lib/hooks/useSeries';

export type SearchResult =
  | { kind: 'book'; book: Audiobook }
  | { kind: 'series'; series: SeriesSummary; books: Audiobook[]; matchingBook?: Audiobook };

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Title matching selects a highlight only. Series identity always comes from the exact ASIN. */
function titleMatchScore(book: Audiobook, query: string): number {
  if (book.asin.toLowerCase() === query.toLowerCase()) return 3;
  const title = normalize(book.title);
  const search = normalize(query);
  if (!search || search === normalize(book.series || '')) return 0;
  if (title === search) return 2;
  return ` ${title} `.includes(` ${search} `) ? 1 : 0;
}

/** Group only loaded results. Missing or invalid series identity remains a normal book card. */
export function groupSearchResults(books: Audiobook[], query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const groups = new Map<string, Extract<SearchResult, { kind: 'series' }>>();

  for (const book of books) {
    if (!book.seriesAsin || !/^[A-Z0-9]{10}$/.test(book.seriesAsin) || !book.series?.trim()) {
      results.push({ kind: 'book', book });
      continue;
    }

    let group = groups.get(book.seriesAsin);
    if (!group) {
      group = {
        kind: 'series',
        series: {
          asin: book.seriesAsin,
          title: book.series,
          coverArtUrl: book.coverArtUrl,
          // Search results do not include the total series size or series rating.
          bookCount: 0,
          tags: [],
          audibleUrl: '',
        },
        books: [],
      };
      groups.set(book.seriesAsin, group);
      results.push(group);
    }

    group.books.push(book);
    if (!group.series.coverArtUrl && book.coverArtUrl) group.series.coverArtUrl = book.coverArtUrl;
    const score = titleMatchScore(book, query);
    if (score > 0 && (!group.matchingBook || score > titleMatchScore(group.matchingBook, query))) {
      group.matchingBook = book;
    }
  }

  return results;
}

/** Sort known volume numbers, including decimals and ranges, without inventing missing positions. */
export function sortBySeriesPosition(books: Audiobook[]): Audiobook[] {
  const position = (book: Audiobook) => {
    const match = book.seriesPart?.trim().match(/^\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
  };
  return [...books].sort((a, b) => {
    const aPosition = position(a);
    const bPosition = position(b);
    return aPosition === bPosition ? 0 : aPosition - bPosition;
  });
}
