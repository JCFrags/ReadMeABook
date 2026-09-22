/**
 * Component: Search Page Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockAuthState } from '../helpers/mock-auth';
import { resetMockRouter, setMockSearchParams } from '../helpers/mock-next-navigation';

const loadMoreMock = vi.hoisted(() => vi.fn());
const useSearchMock = vi.hoisted(() => vi.fn());
const usePreferencesMock = vi.hoisted(() => ({
  cardSize: 5,
  setCardSize: vi.fn(),
  squareCovers: false,
  setSquareCovers: vi.fn(),
  hideAvailable: false,
  setHideAvailable: vi.fn(),
}));

vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useSearch: useSearchMock,
  Audiobook: {},
}));

vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => usePreferencesMock,
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('@/components/audiobooks/AudiobookCard', () => ({
  AudiobookCard: ({ audiobook }: { audiobook: { title: string } }) => <div data-testid="book-card">{audiobook.title}</div>,
}));

const addSeriesMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/hooks/useWatchedSeries', () => ({
  useWatchedSeries: () => ({ series: [{ id: 'watch-1', seriesAsin: 'SERIES0002' }] }),
  useAddWatchedSeries: () => ({ addSeries: addSeriesMock, isLoading: false }),
  useDeleteWatchedSeries: () => ({ deleteSeries: vi.fn(), isLoading: false }),
}));

vi.mock('@/components/ui/SectionToolbar', () => ({
  SectionToolbar: () => <div data-testid="section-toolbar" />,
}));

vi.mock('@/components/ui/LoadMoreBar', () => ({
  LoadMoreBar: ({
    hasMore,
    isLoading,
    onLoadMore,
  }: {
    loadedCount: number;
    totalCount?: number;
    hasMore: boolean;
    isLoading: boolean;
    onLoadMore: () => void;
    itemLabel?: string;
  }) =>
    hasMore ? (
      <button onClick={onLoadMore} disabled={isLoading}>
        Load more
      </button>
    ) : (
      <div data-testid="all-loaded">All loaded</div>
    ),
}));

describe('SearchPage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    useSearchMock.mockReset();
    loadMoreMock.mockReset();
    usePreferencesMock.cardSize = 5;
    usePreferencesMock.hideAvailable = false;
    usePreferencesMock.setCardSize.mockReset();
    addSeriesMock.mockReset();
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the empty state before a search query is entered', async () => {
    useSearchMock.mockReturnValue({
      results: [],
      totalResults: 0,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      loadMore: loadMoreMock,
    });

    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);

    expect(screen.getByText('Start typing to search for audiobooks and series')).toBeInTheDocument();
    expect(useSearchMock).toHaveBeenCalledWith('');
  });

  it('debounces search input and loads more results', async () => {
    useSearchMock.mockReturnValue({
      results: [{ asin: 'a1', title: 'Book One', author: 'Author' }],
      totalResults: 2,
      hasMore: true,
      isLoading: false,
      isLoadingMore: false,
      loadMore: loadMoreMock,
    });

    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);

    const input = screen.getByPlaceholderText('Search by book, series, author, or narrator...');
    fireEvent.change(input, { target: { value: 'Dune' } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText('Search Results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(screen.getAllByTestId('book-card')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(loadMoreMock).toHaveBeenCalled();
  });

  it('groups exact series IDs, keeps incomplete identity, and reuses watch confirmation', async () => {
    setMockSearchParams('q=Frost+Gate');
    useSearchMock.mockReturnValue({
      results: [
        { asin: 'BOOK000004', title: 'Frost Gate', author: 'Author', series: 'Atlas', seriesAsin: 'SERIES0001', seriesPart: '4' },
        { asin: 'BOOK000001', title: 'Dawn', author: 'Author', series: 'Atlas', seriesAsin: 'SERIES0001', seriesPart: '1' },
        { asin: 'ALT0000004', title: 'Frost Gate', author: 'Author', series: 'Atlas', seriesAsin: 'SERIES0002', seriesPart: '4' },
        { asin: 'SOLO000001', title: 'Standalone', author: 'Author' },
        { asin: 'UNKNOWN001', title: 'Unknown identity', author: 'Author', series: 'Atlas' },
      ],
      totalResults: 5, hasMore: false, isLoading: false, isLoadingMore: false, loadMore: loadMoreMock,
    });
    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);

    expect(screen.getAllByRole('link', { name: 'View Atlas series' })).toHaveLength(2);
    expect(screen.getAllByTestId('book-card').map(card => card.textContent)).toEqual(['Standalone', 'Unknown identity']);
    expect(screen.getAllByText('Matching book: Frost Gate, Book 4')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'View Atlas series' })[0]).toHaveAttribute('href', '/series/SERIES0001?q=Frost+Gate&match=BOOK000004');
    expect(screen.getByRole('button', { name: 'Watching' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(screen.getByText('Watch "Atlas"?')).toBeInTheDocument();
    expect(addSeriesMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(addSeriesMock).not.toHaveBeenCalled();
  });

  it('keeps load more available when all loaded matches are hidden', async () => {
    setMockSearchParams('q=Atlas');
    usePreferencesMock.hideAvailable = true;
    useSearchMock.mockReturnValue({
      results: [{ asin: 'BOOK000001', title: 'Dawn', author: 'Author', isAvailable: true }],
      totalResults: 50, hasMore: true, isLoading: false, isLoadingMore: false, loadMore: loadMoreMock,
    });
    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);
    expect(screen.queryAllByTestId('book-card')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(loadMoreMock).toHaveBeenCalled();
  });
});
