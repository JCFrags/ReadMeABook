/**
 * Component: Collection Preview API
 * Documentation: documentation/features/collection-workflow.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '@/lib/middleware/auth';
import { collectionBody, collectionFailure, collectionSourceSchema } from '@/lib/collections/http';
import { previewCollection } from '@/lib/collections/service';

const schema = z.object({ source: collectionSourceSchema, anchorRequestId: z.string().uuid() }).strict();

export async function POST(request: NextRequest) {
  return requireAuth(request, req => requireAdmin(req, async () => {
    try {
      const body = schema.parse(await collectionBody(req));
      return NextResponse.json(await previewCollection(body.source, body.anchorRequestId));
    } catch (error) { return collectionFailure(error); }
  }));
}
