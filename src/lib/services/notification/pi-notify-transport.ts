/**
 * Component: Authenticated Pi-Notify HTTP Transport
 * Documentation: documentation/backend/services/notifications.md
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export class PiNotifyTransportError extends Error {
  constructor(public readonly code: string) {
    super(`Pi-Notify request failed (${code})`);
    this.name = 'PiNotifyTransportError';
  }
}

export interface PiNotifyTransportConfig {
  serverUrl: string;
  accessToken: string;
  socketPath?: string;
}

/** No redirects, raw response logs, or unlimited response bodies. */
export async function piNotifyRequest(
  config: PiNotifyTransportConfig,
  path: '/v1/events' | '/v1/health',
  body?: unknown
): Promise<{ status: number; body: any }> {
  let base: URL;
  try {
    base = new URL(config.serverUrl);
  } catch {
    throw new PiNotifyTransportError('invalid_url');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new PiNotifyTransportError('invalid_url');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol === 'http:' && !loopback) throw new PiNotifyTransportError('https_required');
  if (config.socketPath && (!config.socketPath.startsWith('/') || base.protocol !== 'http:' || !loopback)) {
    throw new PiNotifyTransportError('invalid_socket');
  }
  if (typeof config.accessToken !== 'string' || !config.accessToken.trim() || /[\r\n]/.test(config.accessToken)) {
    throw new PiNotifyTransportError('missing_token');
  }
  const data = body === undefined ? undefined : JSON.stringify(body);
  if (data && Buffer.byteLength(data) > 64 * 1024) throw new PiNotifyTransportError('event_too_large');
  const endpoint = new URL(path, base);
  const send = base.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = send(endpoint, {
      method: data === undefined ? 'GET' : 'POST',
      ...(config.socketPath ? { socketPath: config.socketPath } : {}),
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: 'application/json',
        ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
      },
    });
    const timer = setTimeout(() => request.destroy(new PiNotifyTransportError('timeout')), 10_000);
    request.once('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof PiNotifyTransportError ? error : new PiNotifyTransportError('connection_failed'));
    });
    request.once('response', (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          request.destroy(new PiNotifyTransportError('response_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', () => {
        clearTimeout(timer);
        reject(new PiNotifyTransportError('response_failed'));
      });
      response.once('end', () => {
        clearTimeout(timer);
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new PiNotifyTransportError(`http_${status}`));
          return;
        }
        try {
          resolve({ status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          reject(new PiNotifyTransportError('invalid_response'));
        }
      });
    });
    request.end(data);
  });
}
