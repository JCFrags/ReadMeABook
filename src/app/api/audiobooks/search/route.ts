/**
 * Component: Audiobook Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService, type AudibleAudiobook } from '@/lib/integrations/audible.service';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import { persistDedupGroups, collapseByExistingWorks } from '@/lib/services/works.service';
import { getCurrentUserAsync } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { annotateWithIgnoreStatus } from '@/lib/utils/ignored-audiobooks';

const logger = RMABLogger.create('API.Audiobooks.Search');

/**
 * GET /api/audiobooks/search?q=query&page=1
 * Search for audiobooks on Audible
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || searchParams.get('query');
    const page = parseInt(searchParams.get('page') || '1', 10);

    if (!query) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Search query is required',
        },
        { status: 400 }
      );
    }

    const audibleService = getAudibleService();
    const results = await audibleService.search(query, page);

    // Get current user (optional — JWT or API token — for request-status enrichment)
    const currentUser = await getCurrentUserAsync(request);
    const userId = currentUser?.sub || undefined;

    // Search must retain each exact series identity, even when title/narrator
    // matching or an existing work links books from different series. Keep
    // books without series IDs separate. Shared acquisition matching is unchanged.
    const seriesBuckets = new Map<string, AudibleAudiobook[]>();
    for (const book of results.results) {
      const key = book.seriesAsin || '';
      const bucket = seriesBuckets.get(key) || [];
      bucket.push(book);
      seriesBuckets.set(key, bucket);
    }
    const collapsedBuckets = await Promise.all([...seriesBuckets.values()].map(async books => {
      const { books: deduped, groups } = deduplicateAndCollectGroups(books);
      if (groups.length > 0) persistDedupGroups(groups).catch(() => {});
      return collapseByExistingWorks(deduped);
    }));
    const resultOrder = new Map(results.results.map((book, index) => [book.asin, index]));
    const collapsedResults = collapsedBuckets.flat().sort((a, b) =>
      (resultOrder.get(a.asin) ?? 0) - (resultOrder.get(b.asin) ?? 0)
    );

    // Enrich search results with availability and request status information
    const enrichedResults = await enrichAudiobooksWithMatches(collapsedResults, userId);

    // Annotate with per-user ignore status
    const annotatedResults = await annotateWithIgnoreStatus(enrichedResults, userId);

    return NextResponse.json({
      success: true,
      query: results.query,
      results: annotatedResults,
      totalResults: results.totalResults,
      page: results.page,
      hasMore: results.hasMore,
    });
  } catch (error) {
    logger.error('Failed to search audiobooks', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'SearchError',
        message: 'Failed to search audiobooks',
      },
      { status: 500 }
    );
  }
}
