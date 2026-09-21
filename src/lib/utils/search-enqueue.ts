/**
 * Component: Atomic Search Enqueue
 * Documentation: documentation/phase3/search-policy.md
 */

import { randomUUID } from 'node:crypto';
import type Queue from 'bull';
import type Redis from 'ioredis';
import { prisma } from '../db';
import { resetSearchPolicy, SEARCHABLE_STATES } from './search-policy';
import { hasSelectedCollection } from './search-state';
import { claimRssEvidence } from './rss-freshness';

export interface SearchEnqueueOptions {
  trigger?: 'initial' | 'manual' | 'retry' | 'rss';
  evidenceKey?: string;
}

const LIVE_STATES = new Set(['active', 'waiting', 'delayed', 'paused']);

async function liveJob(queue: Queue.Queue, id: string) {
  const job = await queue.getJob(id);
  return job && LIVE_STATES.has(await job.getState()) ? job : null;
}

export async function enqueueSearch(
  queue: Queue.Queue,
  redis: Redis,
  type: 'search_indexers' | 'search_ebook',
  payload: { requestId: string; audiobook: { id: string; title: string; author: string; asin?: string }; preferredFormat?: string },
  options: SearchEnqueueOptions = {},
  priority = 10
): Promise<string> {
  const { requestId } = payload;
  const trigger = options.trigger || 'initial';
  const automatic = trigger === 'retry' || trigger === 'rss';
  const bullId = `search-${type}-${requestId}`;
  const lockKey = `rmab:enqueue:${bullId}`;
  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    acquired = await redis.set(lockKey, token, 'PX', 30000, 'NX') === 'OK';
    if (acquired) break;
    const existing = await liveJob(queue, bullId);
    if (existing) return existing.data.jobId;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!acquired) {
    if (automatic) return '';
    throw new Error('Search enqueue is already in progress. Retry shortly.');
  }

  try {
    const existing = await liveJob(queue, bullId);
    if (existing) return existing.data.jobId;

    // Reconcile pre-upgrade random Bull IDs against Redis, not historical status alone.
    const history = await prisma.job.findMany({
      where: { requestId, type, status: { in: ['pending', 'active', 'delayed', 'stuck'] } },
      select: { id: true, bullJobId: true },
    });
    for (const row of history) {
      if (row.bullJobId && row.bullJobId !== bullId && await liveJob(queue, row.bullJobId)) return row.id;
    }

    const request = await prisma.request.findUnique({ where: { id: requestId } });
    if (!request || request.deletedAt || !SEARCHABLE_STATES.includes(request.status)) return '';
    if (await hasSelectedCollection(requestId)) return '';
    const now = new Date();
    if (automatic && !['awaiting_search', 'awaiting_release'].includes(request.status)) return '';
    if (automatic && request.nextSearchAt && request.nextSearchAt > now) {
      if (trigger !== 'rss' || request.lastSearchOutcome === 'provider_error') return '';
    }
    if (trigger === 'rss' && !await claimRssEvidence(redis, requestId, options.evidenceKey)) return '';

    if (!automatic) {
      await prisma.request.updateMany({
        where: { id: requestId, status: { in: SEARCHABLE_STATES }, deletedAt: null },
        data: resetSearchPolicy(),
      });
    }
    // Terminal jobs never lock out a later search. Bull's job ID remains the atomic guard.
    const terminal = await queue.getJob(bullId);
    if (terminal) {
      if (LIVE_STATES.has(await terminal.getState())) return terminal.data.jobId;
      await terminal.remove();
    }
    const dbJob = await prisma.job.create({
      data: { requestId, type, status: 'pending', priority, payload, maxAttempts: 3, bullJobId: bullId },
    });
    try {
      await queue.add(type, { ...payload, searchTrigger: trigger, jobId: dbJob.id }, {
        jobId: bullId, priority, removeOnComplete: true, removeOnFail: true,
      });
      const queued = await queue.getJob(bullId);
      // Bull deduplicates atomically even if the short enqueue lock expired mid-write.
      if (queued && queued.data.jobId !== dbJob.id) {
        await prisma.job.update({ where: { id: dbJob.id }, data: {
          status: 'completed', completedAt: new Date(), result: { duplicateOf: queued.data.jobId },
        } });
        return queued.data.jobId;
      }
      return dbJob.id;
    } catch (error) {
      await prisma.job.update({ where: { id: dbJob.id }, data: {
        status: 'failed', completedAt: new Date(), errorMessage: 'Failed to enqueue search',
      } });
      throw error;
    }
  } finally {
    await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, lockKey, token);
  }
}
