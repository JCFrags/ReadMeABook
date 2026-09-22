/**
 * Component: Search Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { SearchResultsGrid } from '@/components/series/SearchResultsGrid';
import { groupSearchResults } from '@/lib/utils/group-search-results';
import { LoadMoreBar } from '@/components/ui/LoadMoreBar';
import { useSearch, Audiobook } from '@/lib/hooks/useAudiobooks';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { SectionToolbar } from '@/components/ui/SectionToolbar';
import { usePreferences } from '@/contexts/PreferencesContext';

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(urlQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery);
  const { cardSize, setCardSize, squareCovers, setSquareCovers, hideAvailable, setHideAvailable } = usePreferences();

  // Restore the query on direct links and browser back/forward navigation.
  useEffect(() => {
    setQuery(urlQuery);
    setDebouncedQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = query.trim();
      setDebouncedQuery(trimmed);
      if (trimmed !== urlQuery) {
        router.replace(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search', { scroll: false });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, urlQuery, router]);

  const { results, totalResults, hasMore, isLoading, isLoadingMore, loadMore, error } = useSearch(debouncedQuery);

  // Filter out available titles when hideAvailable is enabled
  const filteredResults = useMemo(
    () => hideAvailable ? results.filter((b: Audiobook) => !b.isAvailable && b.requestStatus !== 'completed') : results,
    [results, hideAvailable]
  );

  const groupedResults = useMemo(() => groupSearchResults(filteredResults, debouncedQuery), [filteredResults, debouncedQuery]);
  const seriesCount = groupedResults.filter(result => result.kind === 'series').length;
  const bookCount = groupedResults.length - seriesCount;
  const countText = `${seriesCount} series, ${bookCount} individual book${bookCount === 1 ? '' : 's'}`;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedQuery(query.trim());
    router.replace(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : '/search', { scroll: false });
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen">
        <Header />

      <main className="container mx-auto px-4 py-8 max-w-7xl space-y-8">
        {/* Search Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">
            Search Audiobooks and Series
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Find audiobooks and series from Audible
          </p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="max-w-3xl mx-auto">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by book, series, author, or narrator..."
              aria-label="Search audiobooks and series"
              className="w-full pl-12 pr-12 py-4 text-lg border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </form>

        {/* Results */}
        {debouncedQuery ? (
          <div className="space-y-6">
            {/* Sticky Results Header with Card Size Controls */}
            <div className="sticky top-14 sm:top-16 z-30 mb-4 sm:mb-6">
              <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                    Search Results
                  </h2>
                  {!isLoading && countText && (
                    <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:inline whitespace-nowrap">
                      ({countText})
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
              Series group the loaded book matches. Load more to find additional matches.
              {hideAvailable && ' Hide available applies only to loaded matches, not every book in a series.'}
            </p>
            {error && (
              <p role="alert" className="text-red-600 dark:text-red-400">
                Search could not load. Try again or change your search.
              </p>
            )}
            <SearchResultsGrid
              results={groupedResults}
              query={debouncedQuery}
              isLoading={isLoading}
              emptyMessage={hideAvailable && results.length > 0
                ? 'No visible matches in the loaded books. Show available books or load more.'
                : `No results found for "${debouncedQuery}"`}
              cardSize={cardSize}
              squareCovers={squareCovers}
            />

            {(results.length > 0 || hasMore) && (
              <LoadMoreBar
                loadedCount={results.length}
                totalCount={totalResults}
                hasMore={hasMore}
                isLoading={isLoadingMore}
                onLoadMore={loadMore}
                itemLabel="book matches"
              />
            )}
          </div>
        ) : (
          /* Empty State */
          <div className="text-center py-16 space-y-4">
            <svg
              className="mx-auto h-16 w-16 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              Start typing to search for audiobooks and series
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Search by book, series, author, or narrator name
            </p>
          </div>
        )}
      </main>
      </div>
    </ProtectedRoute>
  );
}

export default function SearchPage() {
  return <Suspense><SearchPageContent /></Suspense>;
}
