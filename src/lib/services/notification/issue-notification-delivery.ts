/**
 * Component: Durable Issue Notification Delivery
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma';
import { RMABLogger } from '@/lib/utils/logger';
import type { NotificationPayload } from './INotificationProvider';
import { buildIssueEvent, IssueEventSource, PiNotifyIssueEvent } from './pi-notify-event';
import { PiNotifyTransportError } from './pi-notify-transport';

const logger = RMABLogger.create('IssueNotificationDelivery');
const RETRY_BASE_MS = 5 * 60_000;
const CLAIM_MS = 60_000; // Longer than the transport's absolute ten-second deadline.
const MAX_RETRY_MS = 24 * 60 * 60_000;
const audiobook = { select: { id: true, title: true, author: true, audibleAsin: true } } as const;

type Backend = { id: string; type: string; enabled: boolean; events: unknown; config: unknown; issueEventsEnabledAt: Date | null };
type Send = (config: unknown, payload: NotificationPayload) => Promise<void>;
export type IssueDeliveryResult = 'accepted' | 'deferred' | 'skipped' | 'failed';

function active(backend: Backend | null): backend is Backend & { issueEventsEnabledAt: Date } {
  return !!backend && backend.type === 'pi_notify' && backend.enabled && !!backend.issueEventsEnabledAt &&
    Array.isArray(backend.events) && backend.events.includes('issue_reported');
}

async function ensureReceipt(backend: Backend, issue: IssueEventSource) {
  const key = { issueId: issue.id, backendId: backend.id };
  // Do not rebuild an existing event after metadata or configuration edits.
  const existing = await prisma.issueNotificationDelivery.findUnique({ where: { issueId_backendId: key } });
  if (existing) return existing;
  const config = backend.config as { applicationUrl?: string };
  const event = buildIssueEvent(backend.id, config.applicationUrl || '', issue);
  return prisma.issueNotificationDelivery.upsert({
    where: { issueId_backendId: key },
    create: { ...key, event: event as unknown as Prisma.InputJsonValue },
    update: {},
  });
}

export async function deliverIssueNotification(backendId: string, issueId: string, send: Send): Promise<IssueDeliveryResult> {
  const backend = await prisma.notificationBackend.findUnique({ where: { id: backendId } });
  if (!active(backend)) return 'skipped';
  const issue = await prisma.reportedIssue.findUnique({ where: { id: issueId }, include: { audiobook } });
  if (!issue || issue.status !== 'open' || issue.createdAt < backend.issueEventsEnabledAt) return 'skipped';
  const receipt = await ensureReceipt(backend, issue);
  if (receipt.acceptedAt) return 'skipped';
  const now = new Date();
  if (receipt.nextAttemptAt > now) return 'deferred';

  // One conditional write is a short claim. A crashed worker becomes due again.
  const claim = await prisma.issueNotificationDelivery.updateMany({
    where: { id: receipt.id, acceptedAt: null, nextAttemptAt: { lte: now } },
    data: { attempts: { increment: 1 }, lastAttemptAt: now, nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
  });
  if (claim.count !== 1) return 'deferred';
  const owned = { id: receipt.id, acceptedAt: null, lastAttemptAt: now };

  try {
    // Reload directly before transport. Disable/re-enable or resolution must not
    // turn a queued notification into a newly authorized repair event.
    const current = await prisma.notificationBackend.findUnique({ where: { id: backendId } });
    const currentIssue = active(current) ? await prisma.reportedIssue.findFirst({
      where: { id: issueId, status: 'open', createdAt: { gte: current.issueEventsEnabledAt } },
      select: { id: true },
    }) : null;
    if (!active(current) || !currentIssue) return 'skipped';

    const event = receipt.event as unknown as PiNotifyIssueEvent;
    await send(current.config, {
      event: 'issue_reported', issueId, title: event.data.book?.title ?? 'General report', author: event.data.book?.author ?? 'Not specified',
      userName: '', message: event.data.report.text, timestamp: new Date(event.occurredAt), structuredEvent: event,
    });
    await prisma.issueNotificationDelivery.updateMany({
      where: owned, data: { acceptedAt: new Date(), lastError: null },
    });
    logger.info('Pi-Notify accepted issue event', { issueId, backendId });
    return 'accepted';
  } catch (error) {
    const delay = Math.min(MAX_RETRY_MS, RETRY_BASE_MS * 2 ** Math.min(receipt.attempts, 9));
    const code = error instanceof PiNotifyTransportError ? error.code : 'delivery_failed';
    await prisma.issueNotificationDelivery.updateMany({
      where: owned,
      data: { nextAttemptAt: new Date(Date.now() + delay), lastError: code },
    });
    // Never log report text, tokens, URLs, or downstream response bodies.
    logger.warn('Pi-Notify issue delivery deferred', { issueId, backendId, code });
    return 'failed';
  }
}

/** Use the existing Bull schedule. Source rows recover missing enqueue/Redis loss. */
export async function reconcileIssueNotifications(send: Send) {
  const backends = await prisma.notificationBackend.findMany({
    where: { type: 'pi_notify', enabled: true, issueEventsEnabledAt: { not: null }, events: { array_contains: 'issue_reported' } },
    orderBy: { id: 'asc' },
  });
  const result = { prepared: 0, accepted: 0, deferred: 0, skipped: 0, failed: 0 };
  for (const backend of backends) {
    if (!active(backend)) continue;
    const missing = await prisma.reportedIssue.findMany({
      where: {
        status: 'open', createdAt: { gte: backend.issueEventsEnabledAt },
        notificationDeliveries: { none: { backendId: backend.id } },
      },
      include: { audiobook }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 25,
    });
    for (const issue of missing) {
      try {
        await ensureReceipt(backend, issue);
        result.prepared++;
      } catch {
        result.failed++;
        logger.warn('Could not prepare Pi-Notify issue event; check backend configuration', { issueId: issue.id, backendId: backend.id });
      }
    }
    const due = await prisma.issueNotificationDelivery.findMany({
      where: {
        backendId: backend.id, acceptedAt: null, nextAttemptAt: { lte: new Date() },
        issue: { status: 'open', createdAt: { gte: backend.issueEventsEnabledAt } },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], take: 50,
      select: { issueId: true },
    });
    for (const delivery of due) {
      try {
        result[await deliverIssueNotification(backend.id, delivery.issueId, send)]++;
      } catch {
        result.failed++;
        logger.warn('Could not reconcile Pi-Notify receipt', { issueId: delivery.issueId, backendId: backend.id });
      }
    }
  }
  logger.info('Pi-Notify issue reconciliation finished', result);
  return result;
}
