/**
 * Component: Report Issue API
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { createReportedIssue, ReportIssueSchema, ReportedIssueError } from '@/lib/services/reported-issue.service';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.ReportIssue');

// Do not silently convert an explicitly different format to an audiobook report.
const LegacyReportSchema = z.object({ kind: z.literal('audiobook').optional() }).passthrough();

/**
 * POST /api/audiobooks/[asin]/report-issue
 * Report an issue with an available audiobook
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { asin } = await params;
      const body = LegacyReportSchema.parse(await req.json());
      const input = ReportIssueSchema.parse({ ...body, kind: 'audiobook', asin });
      const issue = await createReportedIssue(input, req.user.id);

      return NextResponse.json({ success: true, issue }, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: error.errors },
          { status: 400 }
        );
      }

      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'ValidationError', message: 'Invalid JSON body' }, { status: 400 });
      }

      if (error instanceof ReportedIssueError) {
        return NextResponse.json(
          { error: 'ReportIssueError', message: error.message },
          { status: error.statusCode }
        );
      }

      logger.error('Failed to report issue', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'ServerError', message: 'Failed to report issue' },
        { status: 500 }
      );
    }
  });
}
