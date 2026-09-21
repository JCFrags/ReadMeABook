/**
 * Component: Collection Selection API
 * Documentation: documentation/features/collection-workflow.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '@/lib/middleware/auth';
import { collectionBody, collectionFailure, collectionSourceSchema } from '@/lib/collections/http';
import { selectCollection } from '@/lib/collections/service';

const schema = z.object({
  source: collectionSourceSchema,
  expectedHash: z.string().regex(/^[a-f0-9]{40}$/i),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  identityConfirmed: z.literal(true),
  mappings: z.array(z.object({ requestId: z.string().uuid(), fileIndexes: z.array(z.number().int().nonnegative()).min(1).max(2000) }).strict()).min(1).max(50),
}).strict();

export async function POST(request: NextRequest) {
  return requireAuth(request, req => requireAdmin(req, async () => {
    try { return NextResponse.json(await selectCollection(schema.parse(await collectionBody(req)))); }
    catch (error) { return collectionFailure(error); }
  }));
}
