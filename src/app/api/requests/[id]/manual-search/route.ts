/**
 * Component: Manual Search API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resetSearchPolicy } from '@/lib/utils/search-policy';
import { hasSelectedCollection } from '@/lib/utils/search-state';

const logger = RMABLogger.create('API.ManualSearch');

/**
 * POST /api/requests/[id]/manual-search
 * Manually trigger a search for torrents
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { id } = await params;

      const requestRecord = await prisma.request.findUnique({
        where: { id },
        include: {
          audiobook: true,
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      // Only allow manual search for pending, failed, awaiting_search, awaiting_release statuses
      const searchableStatuses = ['pending', 'failed', 'awaiting_search', 'awaiting_release'];
      if (!searchableStatuses.includes(requestRecord.status)) {
        return NextResponse.json(
          {
            error: 'ValidationError',
            message: `Cannot manually search for request with status: ${requestRecord.status}`,
          },
          { status: 400 }
        );
      }

      if (await hasSelectedCollection(id)) {
        return NextResponse.json({ error: 'CollectionRecoveryRequired', message: 'Use collection selection or import recovery for this request.' }, { status: 409 });
      }

      // Trigger appropriate search job based on request type
      const jobQueue = getJobQueueService();
      const audiobookData = {
        id: requestRecord.audiobook.id,
        title: requestRecord.audiobook.title,
        author: requestRecord.audiobook.author,
        asin: requestRecord.audiobook.audibleAsin || undefined,
      };

      // Reset before enqueue. Do not overwrite a concurrent download/collection claim.
      const reset = await prisma.request.updateMany({
        where: { id, status: { in: searchableStatuses }, deletedAt: null },
        data: {
          status: 'pending',
          ...resetSearchPolicy(),
          progress: 0,
          errorMessage: null,
          updatedAt: new Date(),
        },
      });
      if (!reset.count) return NextResponse.json({ error: 'Conflict', message: 'Request state changed' }, { status: 409 });
      if (requestRecord.type === 'ebook') {
        await jobQueue.addSearchEbookJob(id, audiobookData, undefined, { trigger: 'manual' });
      } else {
        await jobQueue.addSearchJob(id, audiobookData, { trigger: 'manual' });
      }
      const updated = await prisma.request.findUnique({ where: { id }, include: { audiobook: true } });

      return NextResponse.json({
        success: true,
        request: updated,
        message: 'Manual search initiated',
      });
    } catch (error) {
      logger.error('Failed to trigger manual search', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'SearchError',
          message: 'Failed to initiate manual search',
        },
        { status: 500 }
      );
    }
  });
}
