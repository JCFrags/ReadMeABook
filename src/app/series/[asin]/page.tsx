/**
 * Component: Series Detail Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { use, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { AudiobookGrid } from '@/components/audiobooks/AudiobookGrid';
import { LoadMoreBar } from '@/components/ui/LoadMoreBar';
import { SeriesDetailCard, SeriesDetailSkeleton } from '@/components/series/SeriesDetailCard';
import { SimilarSeriesRow, SimilarSeriesSkeleton } from '@/components/series/SimilarSeriesRow';
import { useSeriesDetail } from '@/lib/hooks/useSeries';
import { Audiobook, useAudiobookDetails } from '@/lib/hooks/useAudiobooks';
import { sortBySeriesPosition } from '@/lib/utils/group-search-results';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { SectionToolbar } from '@/components/ui/SectionToolbar';
import { usePreferences } from '@/contexts/PreferencesContext';

export default function SeriesDetailPage({
  params,
}: {
  params: Promise<{ asin: string }>;
}) {
  const { asin } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromSeriesTitle = searchParams.get('from');
  const searchQuery = searchParams.get('q');
  const matchParam = searchParams.get('match');
  const matchingAsin = matchParam && /^[A-Z0-9]{10}$/.test(matchParam) ? matchParam : undefined;
  const { series, hasMore, isLoading: seriesLoading, isLoadingMore, loadMore, error } = useSeriesDetail(asin);
  const listedMatch = series?.books.find(book => book.asin === matchingAsin);
  // One bounded lookup can show a match beyond the first series page. Verify exact membership.
  const { audiobook: matchDetails, isLoading: matchLoading } = useAudiobookDetails(
    matchingAsin && !listedMatch ? matchingAsin : null
  );
  const matchingBook: Audiobook | undefined = listedMatch ||
    (matchDetails?.seriesAsin === asin && matchDetails?.asin === matchingAsin ? matchDetails : undefined);
  const { cardSize, setCardSize, squareCovers, setSquareCovers, hideAvailable, setHideAvailable } = usePreferences();

  const handleBack = useCallback(() => {
    if (searchQuery !== null) {
      router.push(searchQuery ? `/search?q=${encodeURIComponent(searchQuery)}` : '/search');
    } else if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/search');
    }
  }, [router, searchQuery]);

  const filteredBooks = useMemo(() => {
    const books = [...(series?.books ?? [])];
    if (matchingBook && !books.some(book => book.asin === matchingBook.asin)) books.push(matchingBook);
    return sortBySeriesPosition(books.filter(book =>
      book.asin === matchingAsin || !hideAvailable || (!book.isAvailable && book.requestStatus !== 'completed')
    ));
  }, [series, matchingBook, matchingAsin, hideAvailable]);

  // Header count text: reflects filtered counts
  const visibleCount = filteredBooks.length;
  const booksCountText = series
    ? hasMore && series.bookCount > series.books.length
      ? `${visibleCount.toLocaleString()} of ${series.bookCount.toLocaleString()} title${series.bookCount !== 1 ? 's' : ''}`
      : visibleCount > 0
        ? `${visibleCount.toLocaleString()} title${visibleCount !== 1 ? 's' : ''}`
        : ''
    : '';

  return (
    <ProtectedRoute>
      <div className="min-h-screen">
        <Header />

        <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl space-y-8">
          {/* Back navigation */}
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {searchQuery !== null ? 'Back to Search' : fromSeriesTitle ? `Back to ${fromSeriesTitle}` : 'Back to Search'}
          </button>

          {/* Series Detail Card */}
          {seriesLoading ? (
            <SeriesDetailSkeleton squareCovers={squareCovers} />
          ) : series ? (
            <SeriesDetailCard series={series} squareCovers={squareCovers} />
          ) : (
            <div className="text-center py-16 space-y-4">
              <svg className="mx-auto h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-xl text-gray-600 dark:text-gray-400">{error ? 'Series could not load. Try again.' : 'Series not found'}</p>
            </div>
          )}

          {/* Similar Series */}
          {seriesLoading ? (
            <SimilarSeriesSkeleton squareCovers={squareCovers} />
          ) : series && series.similarSeries.length > 0 ? (
            <SimilarSeriesRow series={series.similarSeries} currentSeriesTitle={series.title} squareCovers={squareCovers} />
          ) : null}

          {/* Books Section */}
          {series && (
            <div className="space-y-6">
              {/* Sticky Books Header */}
              <div className="sticky top-14 sm:top-16 z-30">
                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                      Books in Series
                    </h2>
                    {booksCountText && (
                      <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:inline whitespace-nowrap">
                        ({booksCountText})
                      </span>
                    )}
                    <SectionToolbar
                      hideAvailable={hideAvailable}
                      onToggleHideAvailable={setHideAvailable}
                      squareCovers={squareCovers}
                      onToggleSquareCovers={setSquareCovers}
                      cardSize={cardSize}
                      onCardSizeChange={setCardSize}
                    />
                  </div>
                </div>
              </div>

              <p className="text-sm text-gray-500 dark:text-gray-400">
                Books are ordered by known volume number. Entries with no volume number stay visible at the end.
              </p>
              {matchingBook ? (
                <a href={`#book-${matchingBook.asin}`} className="block rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-emerald-800 dark:text-emerald-200">
                  Matching book: {matchingBook.title}{matchingBook.seriesPart ? `, Book ${matchingBook.seriesPart}` : ', volume unknown'}.
                  {' Jump to book.'}{hideAvailable && ' The matching book stays visible when Hide available is on.'}
                </a>
              ) : matchingAsin && (
                <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
                  {matchLoading ? 'Loading matching book...' : 'The matching book is not in the loaded series entries.'}
                  {!matchLoading && hasMore && ' Load more to locate it.'}
                </p>
              )}
              {error && <p role="alert" className="text-red-600 dark:text-red-400">More series entries could not load. Try again.</p>}
              <AudiobookGrid
                audiobooks={filteredBooks}
                isLoading={seriesLoading}
                emptyMessage={`No books found for ${series.title}`}
                cardSize={cardSize}
                squareCovers={squareCovers}
                highlightedAsin={matchingAsin}
                showSeriesPosition
              />

              {/* Keep paging available even when every loaded book is hidden. */}
              {(series.books.length > 0 || hasMore) && (
                <LoadMoreBar
                  loadedCount={series.books.length}
                  totalCount={series.bookCount > 0 ? series.bookCount : undefined}
                  hasMore={hasMore}
                  isLoading={isLoadingMore}
                  onLoadMore={loadMore}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}
