/**
 * Component: Notification Service
 * Documentation: documentation/backend/services/notifications.md
 */

import { getEncryptionService } from '../encryption.service';
import { RMABLogger } from '../../utils/logger';
import { prisma } from '../../db';
import { INotificationProvider, NotificationPayload, ProviderMetadata } from './INotificationProvider';
import { AppriseProvider } from './providers/apprise.provider';
import { DiscordProvider } from './providers/discord.provider';
import { NtfyProvider } from './providers/ntfy.provider';
import { PushoverProvider } from './providers/pushover.provider';
import { PiNotifyProvider } from './providers/pi-notify.provider';
import { deliverIssueNotification } from './issue-notification-delivery';

const logger = RMABLogger.create('NotificationService');

// Provider registry
const providers = new Map<string, INotificationProvider>();

export function registerProvider(provider: INotificationProvider): void {
  providers.set(provider.type, provider);
}

export function getProvider(type: string): INotificationProvider | undefined {
  return providers.get(type);
}

// Register built-in providers
registerProvider(new AppriseProvider());
registerProvider(new DiscordProvider());
registerProvider(new NtfyProvider());
registerProvider(new PushoverProvider());
registerProvider(new PiNotifyProvider());

export function getRegisteredProviderTypes(): string[] {
  return Array.from(providers.keys());
}

export function getAllProviderMetadata(): ProviderMetadata[] {
  return Array.from(providers.values()).map((p) => p.metadata);
}

export class NotificationService {
  private encryptionService = getEncryptionService();

  /**
   * Send notification to all enabled backends subscribed to the event
   */
  async sendNotification(payload: NotificationPayload): Promise<void> {
    try {
      // Get all enabled backends subscribed to this event
      const backends = await prisma.notificationBackend.findMany({
        where: {
          enabled: true,
          events: {
            array_contains: payload.event,
          },
        },
      });

      if (backends.length === 0) {
        logger.debug(`No backends subscribed to event: ${payload.event}`);
        return;
      }

      logger.info(`Sending notification to ${backends.length} backend(s)`, {
        event: payload.event,
        requestId: payload.requestId,
      });

      // Send to all backends in parallel (atomic per-backend)
      const results = await Promise.allSettled(
        backends.map((backend) => {
          if (backend.type === 'pi_notify') {
            if (payload.event !== 'issue_reported' || !payload.issueId) return Promise.resolve();
            return deliverIssueNotification(backend.id, payload.issueId,
              (config, event) => this.sendToBackend('pi_notify', config, event)).then((result) => {
                if (result === 'failed') throw new Error('Pi-Notify issue delivery failed; retry scheduled');
              });
          }
          return this.sendToBackend(backend.type, backend.config, payload);
        })
      );

      // Log results
      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      logger.info(`Notification sent: ${successful} succeeded, ${failed} failed`, {
        event: payload.event,
        requestId: payload.requestId,
      });

      // Log individual failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error(`Failed to send to backend ${backends[index].name}`, {
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            backend: backends[index].type,
          });
        }
      });
    } catch (error) {
      logger.error('Failed to send notifications', {
        error: error instanceof Error ? error.message : String(error),
        event: payload.event,
        requestId: payload.requestId,
      });
      // Don't throw - non-blocking
    }
  }

  /**
   * Route notification to type-specific provider
   */
  async sendToBackend(
    type: string,
    config: any,
    payload: NotificationPayload
  ): Promise<void> {
    const provider = getProvider(type);
    if (!provider) {
      throw new Error(`Unsupported backend type: ${type}`);
    }

    const decryptedConfig = this.decryptConfig(provider.sensitiveFields, config);
    return provider.send(decryptedConfig, payload);
  }

  /**
   * Encrypt sensitive config values before saving
   */
  encryptConfig(type: string, config: any): any {
    const provider = getProvider(type);
    if (!provider) {
      return { ...config };
    }

    const encrypted = { ...config };
    for (const field of provider.sensitiveFields) {
      if (encrypted[field] && !this.encryptionService.isEncryptedFormat(encrypted[field])) {
        encrypted[field] = this.encryptionService.encrypt(encrypted[field]);
      }
    }
    return encrypted;
  }

  /**
   * Mask sensitive config values for API responses
   */
  maskConfig(type: string, config: any): any {
    const provider = getProvider(type);
    if (!provider) {
      return { ...config };
    }

    const masked = { ...config };
    for (const field of provider.sensitiveFields) {
      if (masked[field]) {
        masked[field] = '••••••••';
      }
    }
    return masked;
  }

  /**
   * Re-encrypt any sensitive fields that were stored as plaintext due to
   * the isEncrypted() false-positive bug (URLs with exactly 2 colons).
   * Safe to call multiple times — skips already-encrypted values.
   */
  async reEncryptUnprotectedBackends(): Promise<number> {
    let fixed = 0;

    try {
      const backends = await prisma.notificationBackend.findMany();

      for (const backend of backends) {
        const provider = getProvider(backend.type);
        if (!provider) continue;

        const config = backend.config as any;
        let needsUpdate = false;
        const updatedConfig = { ...config };

        for (const field of provider.sensitiveFields) {
          if (updatedConfig[field] && !this.encryptionService.isEncryptedFormat(updatedConfig[field])) {
            updatedConfig[field] = this.encryptionService.encrypt(updatedConfig[field]);
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await prisma.notificationBackend.update({
            where: { id: backend.id },
            data: { config: updatedConfig },
          });
          fixed++;
          logger.info(`Re-encrypted plaintext sensitive fields for backend: ${backend.name}`);
        }
      }

      if (fixed > 0) {
        logger.warn(`Re-encrypted ${fixed} backend(s) with unprotected sensitive fields`);
      }
    } catch (error) {
      logger.error('Failed to re-encrypt backends', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return fixed;
  }

  /**
   * Decrypt sensitive config values
   */
  private decryptConfig(sensitiveFields: string[], config: any): any {
    const decrypted = { ...config };
    for (const field of sensitiveFields) {
      if (decrypted[field] && this.encryptionService.isEncryptedFormat(decrypted[field])) {
        decrypted[field] = this.encryptionService.decrypt(decrypted[field]);
      }
    }
    return decrypted;
  }
}

// Singleton instance
let notificationService: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = new NotificationService();
  }
  return notificationService;
}
