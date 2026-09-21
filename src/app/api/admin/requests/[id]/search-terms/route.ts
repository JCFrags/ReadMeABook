/**
 * Component: Admin Custom Search Terms API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { resetSearchPolicy } from '@/lib/utils/search-policy';
import { hasSelectedCollection } from '@/lib/utils/search-state';

const logger = RMABLogger.create('API.Admin.SearchTerms');

/**
 * PATCH /api/admin/requests/[id]/search-terms
 * Update custom search terms for a request (admin only)
 * Body: { searchTerms: string | null, triggerSearch?: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        if (!req.user) {
          return NextResponse.json(
            { error: 'Unauthorized', message: 'User not authenticated' },
            { status: 401 }
          );
        }

        const { id } = await params;

        // Parse body
        let body;
        try {
          body = await req.json();
        } catch {
          return NextResponse.json(
            { error: 'BadRequest', message: 'Invalid JSON body' },
            { status: 400 }
          );
        }

        const { searchTerms, triggerSearch } = body;

        // Validate searchTerms is string or null
        if (searchTerms !== null && searchTerms !== undefined && typeof searchTerms !== 'string') {
          return NextResponse.json(
            { error: 'BadRequest', message: 'searchTerms must be a string or null' },
            { status: 400 }
          );
        }

        // Trim and normalize
        const normalizedTerms = typeof searchTerms === 'string' ? searchTerms.trim() || null : null;

        // Find the request
        const existingRequest = await prisma.request.findUnique({
          where: { id },
          include: {
            audiobook: {
              select: { id: true, title: true, author: true, audibleAsin: true },
            },
          },
        });

        if (!existingRequest || existingRequest.deletedAt) {
          return NextResponse.json(
            { error: 'NotFound', message: 'Request not found' },
            { status: 404 }
          );
        }

        if (await hasSelectedCollection(id)) {
          return NextResponse.json({ error: 'CollectionRecoveryRequired', message: 'Use collection selection or import recovery for this request.' }, { status: 409 });
        }

        // Update custom search terms
        await prisma.request.update({
          where: { id },
          data: {
            customSearchTerms: normalizedTerms,
            updatedAt: new Date(),
          },
        });

        const searchableStatuses = ['pending', 'failed', 'awaiting_search', 'awaiting_release'];
        await prisma.request.updateMany({
          where: { id, deletedAt: null, status: { in: searchableStatuses } },
          data: resetSearchPolicy(),
        });

        logger.info(`Custom search terms ${normalizedTerms ? 'set' : 'cleared'} for request ${id}`, {
          requestId: id,
          customSearchTerms: normalizedTerms,
          adminId: req.user.id,
        });

        // Optionally trigger a new search
        let searchTriggered = false;
        if (triggerSearch && searchableStatuses.includes(existingRequest.status)) {
          // Reset status to pending and clear error
          const reset = await prisma.request.updateMany({
            where: { id, deletedAt: null, status: { in: searchableStatuses } },
            data: { status: 'pending', errorMessage: null, ...resetSearchPolicy() },
          });
          if (!reset.count) return NextResponse.json({ error: 'Conflict', message: 'Request state changed' }, { status: 409 });

          // Queue search job based on request type
          const { getJobQueueService } = await import('@/lib/services/job-queue.service');
          const jobQueue = getJobQueueService();
          const audiobookData = {
            id: existingRequest.audiobook.id,
            title: existingRequest.audiobook.title,
            author: existingRequest.audiobook.author,
            asin: existingRequest.audiobook.audibleAsin || undefined,
          };

          if (existingRequest.type === 'ebook') {
            await jobQueue.addSearchEbookJob(id, audiobookData, undefined, { trigger: 'manual' });
          } else {
            await jobQueue.addSearchJob(id, audiobookData, { trigger: 'manual' });
          }

          searchTriggered = true;
          logger.info(`Search triggered for request ${id} with custom terms`, { requestId: id });
        }

        return NextResponse.json({
          success: true,
          customSearchTerms: normalizedTerms,
          searchTriggered,
        });
      } catch (error) {
        logger.error('Failed to update search terms', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'ServerError', message: 'Failed to update search terms' },
          { status: 500 }
        );
      }
    });
  });
}
