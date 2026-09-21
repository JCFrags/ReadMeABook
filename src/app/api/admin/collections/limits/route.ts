/**
 * Component: Collection Limits API
 * Documentation: documentation/features/collection-workflow.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { collectionBody, collectionFailure } from '@/lib/collections/http';
import { COLLECTION_LIMIT_KEYS, getCollectionLimits, validateCollectionLimits } from '@/lib/collections/limits';
import type { CollectionLimits } from '@/lib/collections/types';

export async function GET(request: NextRequest) {
  return requireAuth(request, req => requireAdmin(req, async () => {
    try { return NextResponse.json(await getCollectionLimits()); }
    catch (error) { return collectionFailure(error); }
  }));
}

export async function PUT(request: NextRequest) {
  return requireAuth(request, req => requireAdmin(req, async () => {
    try {
      const limits = validateCollectionLimits(z.object({
        maxSelectedBytes: z.number(), maxSelectedFiles: z.number(),
        maxTotalBytes: z.number(), maxTorrentFiles: z.number(),
      }).strict().parse(await collectionBody(req)));
      await getConfigService().setMany((Object.keys(COLLECTION_LIMIT_KEYS) as Array<keyof CollectionLimits>).map(key => ({
        key: COLLECTION_LIMIT_KEYS[key], value: String(limits[key]), category: 'download',
      })));
      return NextResponse.json(limits);
    } catch (error) { return collectionFailure(error); }
  }));
}
