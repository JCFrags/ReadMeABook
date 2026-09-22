/**
 * Component: Issue Notification Reconciliation Processor
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { getNotificationService } from '../services/notification';
import { reconcileIssueNotifications } from '../services/notification/issue-notification-delivery';
import { RMABLogger } from '../utils/logger';
import type { JobPayload } from '../services/job-queue.service';

export async function processReconcileIssueNotifications(payload: JobPayload) {
  const service = getNotificationService();
  const result = await reconcileIssueNotifications((config, event) => service.sendToBackend('pi_notify', config, event));
  RMABLogger.forJob(payload.jobId, 'ReconcileIssueNotifications').info('Issue notification reconciliation finished', result);
  return result;
}
