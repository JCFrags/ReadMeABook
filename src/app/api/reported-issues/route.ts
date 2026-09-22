/**
 * Component: Shared Report Issue API
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { createReportedIssue, ReportedIssueError } from '@/lib/services/reported-issue.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.ReportedIssues');

/** Authenticated reports do not require a request, ebook cache entry, or general book context. */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    if (!req.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
      const issue = await createReportedIssue(await req.json(), req.user.id);
      return NextResponse.json({ success: true, issue }, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'ValidationError', details: error.errors }, { status: 400 });
      }
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'ValidationError', message: 'Invalid JSON body' }, { status: 400 });
      }
      if (error instanceof ReportedIssueError) {
        return NextResponse.json({ error: 'ReportIssueError', message: error.message }, { status: error.statusCode });
      }
      logger.error('Failed to report issue', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'ServerError', message: 'Failed to report issue' }, { status: 500 });
    }
  });
}
