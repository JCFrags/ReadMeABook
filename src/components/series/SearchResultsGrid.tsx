/**
 * Component: Grouped Search Results Grid
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { AudiobookCard } from '@/components/audiobooks/AudiobookCard';
import { AudiobookGrid, getAudiobookGridClasses } from '@/components/audiobooks/AudiobookGrid';
import { SeriesCard } from './SeriesCard';
import type { SearchResult } from '@/lib/utils/group-search-results';

interface SearchResultsGridProps {
  results: SearchResult[];
  query: string;
  isLoading: boolean;
  emptyMessage: string;
  cardSize: number;
  squareCovers: boolean;
}

export function SearchResultsGrid({ results, query, isLoading, emptyMessage, cardSize, squareCovers }: SearchResultsGridProps) {
  if (isLoading || results.length === 0) {
    return <AudiobookGrid audiobooks={[]} isLoading={isLoading} emptyMessage={emptyMessage} cardSize={cardSize} squareCovers={squareCovers} />;
  }

  return (
    <div className={`grid ${getAudiobookGridClasses(cardSize)} gap-5 sm:gap-6 lg:gap-8`}>
      {results.map(result => {
        if (result.kind === 'book') {
          return <AudiobookCard key={`book-${result.book.asin}`} audiobook={result.book} squareCovers={squareCovers} />;
        }

        const params = new URLSearchParams({ q: query });
        if (result.matchingBook) params.set('match', result.matchingBook.asin);
        return (
          <SeriesCard
            key={`series-${result.series.asin}`}
            series={result.series}
            squareCovers={squareCovers}
            href={`/series/${result.series.asin}?${params}`}
            matchingBook={result.matchingBook}
            matchingBookCount={result.books.length}
          />
        );
      })}
    </div>
  );
}
