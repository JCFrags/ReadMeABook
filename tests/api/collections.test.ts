/**
 * Component: Collection API Authorization Check
 * Documentation: documentation/features/collection-workflow.md
 */

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const preview = vi.hoisted(() => vi.fn());
vi.mock('@/lib/collections/service', () => ({ previewCollection: preview }));
vi.mock('@/lib/utils/jwt', () => ({ verifyAccessToken: () => ({ sub: 'user-id', role: 'user' }) }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ id: 'user-id', deletedAt: null, sessionsInvalidatedAt: null })) } } }));

import { POST } from '@/app/api/admin/collections/preview/route';

describe('collection route authorization', () => {
  it('rejects anonymous and non-admin callers before reading metadata', async () => {
    const url = 'http://localhost/api/admin/collections/preview';
    expect((await POST(new NextRequest(url, { method: 'POST' }))).status).toBe(401);
    expect((await POST(new NextRequest(url, { method: 'POST', headers: { Authorization: 'Bearer test-session' } }))).status).toBe(403);
    expect(preview).not.toHaveBeenCalled();
  });
});
