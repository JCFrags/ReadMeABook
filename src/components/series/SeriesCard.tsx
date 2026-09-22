/**
 * Component: Series Card
 * Documentation: documentation/frontend/components.md
 *
 * Series summary with an independent watch action and optional search match.
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SeriesSummary } from '@/lib/hooks/useSeries';
import type { Audiobook } from '@/lib/hooks/useAudiobooks';
import { WatchSeriesButton } from '@/components/ui/WatchButton';

interface SeriesCardProps {
  series: SeriesSummary;
  squareCovers?: boolean;
  href?: string;
  matchingBook?: Pick<Audiobook, 'asin' | 'title' | 'seriesPart'>;
  matchingBookCount?: number;
}

export function SeriesCard({ series, squareCovers = false, href, matchingBook, matchingBookCount }: SeriesCardProps) {
  const [coverError, setCoverError] = useState(false);
  const visibleTags = series.tags.slice(0, 2);
  const hasTags = visibleTags.length > 0;
  const hasRating = series.rating != null && series.rating > 0;

  return (
    <article className="min-w-0 space-y-3" data-series-asin={series.asin}>
    <Link
      href={href || `/series/${series.asin}`}
      className="group outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-2xl block"
      aria-label={`View ${series.title} series`}
    >
      {/* Cover Container — The Hero */}
      <div
        className={`
          relative overflow-hidden rounded-xl
          w-full ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'}
          shadow-lg shadow-black/20 dark:shadow-black/40
          group-hover:shadow-xl group-hover:shadow-black/30 dark:group-hover:shadow-black/55
          transform group-hover:scale-[1.02] group-hover:-translate-y-0.5
          transition-all duration-300 ease-out
        `}
      >
        {/* Cover Art or Fallback */}
        {series.coverArtUrl && !coverError ? (
          <Image
            src={series.coverArtUrl}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            onError={() => setCoverError(true)}
          />
        ) : (
          <Image
            src="/placeholder_cover.svg"
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          />
        )}

        {/* Top-row badges — Rating (left) + Book count (right) */}
        {/* Rating Badge — top-left, matches AudiobookCard pattern exactly */}
        {hasRating && (
          <div className="
            absolute top-2.5 left-2.5
            flex items-center gap-1 px-2 py-1
            rounded-lg bg-black/50 backdrop-blur-md
            text-white text-xs font-medium
            transition-opacity duration-300 group-hover:opacity-0
          ">
            <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span>{series.rating!.toFixed(1)}</span>
          </div>
        )}

        {/* Book count badge — top-right */}
        {series.bookCount > 0 && (
          <div className="
            absolute top-2.5 right-2.5
            px-2 py-1
            text-[11px] font-bold rounded-lg
            bg-black/50 backdrop-blur-md
            text-white
            transition-opacity duration-300 group-hover:opacity-0
          ">
            {series.bookCount} {series.bookCount === 1 ? 'Book' : 'Books'}
          </div>
        )}

        {/* Bottom gradient overlay — always present, deepens on hover */}
        <div className={`
          absolute inset-x-0 bottom-0
          transition-all duration-300
          ${hasTags
            ? 'h-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent group-hover:h-24 group-hover:from-black/85'
            : 'h-10 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100'
          }
        `} />

        {/* Tag pills — pinned to bottom of cover, inside gradient */}
        {hasTags && (
          <div className="
            absolute inset-x-0 bottom-0
            flex items-end gap-1.5 p-2.5
            pointer-events-none
          ">
            {visibleTags.map(tag => (
              <span
                key={tag}
                className="
                  inline-block px-2.5 py-0.5
                  text-[10px] font-medium
                  rounded-full
                  bg-black/30 backdrop-blur-md
                  text-white/90
                  ring-1 ring-white/15
                  transition-opacity duration-300
                "
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2.5 px-0.5 space-y-1">
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Series</p>
        <h3 className="
          font-semibold text-[14px] leading-snug
          text-gray-900 dark:text-gray-100
          line-clamp-2
          group-hover:text-emerald-600 dark:group-hover:text-emerald-400
          transition-colors duration-200
        ">
          {series.title}
        </h3>
        {matchingBookCount !== undefined && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {matchingBookCount} matching book{matchingBookCount === 1 ? '' : 's'} loaded
          </p>
        )}
        {matchingBook && (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            Matching book: {matchingBook.title}{matchingBook.seriesPart ? `, Book ${matchingBook.seriesPart}` : ', volume unknown'}
          </p>
        )}
      </div>
    </Link>
    <WatchSeriesButton
      seriesAsin={series.asin}
      seriesTitle={series.title}
      coverArtUrl={series.coverArtUrl}
      compact
    />
    </article>
  );
}
