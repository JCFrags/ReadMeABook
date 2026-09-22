/**
 * Component: Pi-Notify Notification Provider
 * Documentation: documentation/backend/services/notifications.md
 */

import { INotificationProvider, NotificationPayload, ProviderMetadata } from '../INotificationProvider';
import { PI_NOTIFY_ISSUE_TYPE, PI_NOTIFY_SOURCE } from '../pi-notify-event';
import { piNotifyRequest, PiNotifyTransportConfig, PiNotifyTransportError } from '../pi-notify-transport';

export interface PiNotifyConfig extends PiNotifyTransportConfig {
  applicationUrl: string;
}

export class PiNotifyProvider implements INotificationProvider {
  type = 'pi_notify';
  sensitiveFields = ['accessToken'];
  metadata: ProviderMetadata = {
    type: 'pi_notify',
    displayName: 'Pi-Notify',
    description: 'Structured issue reports only. Pi-Notify owns the subscription and approved repair instructions. Test checks connectivity without publishing an event.',
    iconLabel: 'Pi',
    iconColor: 'bg-slate-600',
    configFields: [
      { name: 'serverUrl', label: 'Pi-Notify base URL', type: 'text', required: true, placeholder: 'http://127.0.0.1:8080' },
      { name: 'accessToken', label: 'Source-scoped producer token', type: 'password', required: true },
      { name: 'applicationUrl', label: 'Canonical ReadMeABook URL', type: 'text', required: true, placeholder: 'https://books.example.org' },
      { name: 'socketPath', label: 'Unix socket path (optional, inside container)', type: 'text', required: false, placeholder: '/run/pi-notify/http.sock' },
    ],
  };

  async send(config: Record<string, any>, payload: NotificationPayload): Promise<void> {
    const transport = config as PiNotifyConfig;
    if (payload.test) {
      const response = await piNotifyRequest(transport, '/v1/health');
      if (response.status !== 200 || response.body?.schemaVersion !== 1 || response.body?.status !== 'ready') {
        throw new PiNotifyTransportError('invalid_health_response');
      }
      return;
    }
    const event = payload.structuredEvent;
    if (payload.event !== 'issue_reported' || !event || event.source !== PI_NOTIFY_SOURCE || event.type !== PI_NOTIFY_ISSUE_TYPE) {
      throw new PiNotifyTransportError('unsupported_event');
    }
    const response = await piNotifyRequest(transport, '/v1/events', event);
    const ack = response.body;
    if (response.status !== 202 || ack?.schemaVersion !== 1 || ack?.accepted !== true ||
        ack?.event?.id !== event.id || ack?.event?.source !== event.source) {
      throw new PiNotifyTransportError('invalid_acceptance');
    }
  }
}
