/**
 * Component: Collection API Validation
 * Documentation: documentation/features/collection-workflow.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CollectionError, METADATA_LIMIT } from './validation';

export const collectionSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), infoHash: z.string().regex(/^[a-f0-9]{40}$/i) }).strict(),
  z.object({ kind: z.literal('upload'), torrentBase64: z.string().max(Math.ceil(METADATA_LIMIT / 3) * 4) }).strict(),
  z.object({ kind: z.literal('prowlarr'), downloadUrl: z.string().min(1).max(16384), indexerId: z.number().int().positive() }).strict(),
]);

export async function collectionBody(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new CollectionError('JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 6 * 1024 * 1024) {
      await reader.cancel();
      throw new CollectionError('Collection request body is too large', 413);
    }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CollectionError('Invalid JSON body'); }
}

export function collectionFailure(error: unknown): NextResponse {
  if (error instanceof CollectionError) return NextResponse.json({ error: 'CollectionError', message: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: 'ValidationError', message: 'Invalid collection request fields' }, { status: 400 });
  // Do not expose upstream request URLs, credentials, or filesystem paths in errors.
  return NextResponse.json({ error: 'CollectionError', message: 'Collection operation failed. No unvalidated torrent selection was started' }, { status: 500 });
}
