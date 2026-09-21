/**
 * Component: Collection Metadata Reader
 * Documentation: documentation/features/collection-workflow.md
 */

import axios from 'axios';
import * as parseTorrentModule from 'parse-torrent';
import type { ConfigurationService } from '@/lib/services/config.service';
import type { QBittorrentService, TorrentFile } from '@/lib/integrations/qbittorrent.service';
import { RMAB_USER_AGENT } from '@/lib/utils/user-agent';
import type { CollectionFile, CollectionLimits, CollectionSource } from './types';
import { CollectionError, METADATA_LIMIT, collectionHash, collectionPath, fileKind, validateFileList } from './validation';

const parseTorrent = (parseTorrentModule as any).default || parseTorrentModule;

export interface CollectionMetadata {
  infoHash: string;
  name: string;
  files: CollectionFile[];
  totalBytes: number;
  existing: boolean;
  torrentBuffer?: Buffer;
}

export function fromClientFiles(files: TorrentFile[]): CollectionFile[] {
  return files.map(f => ({ index: f.index, path: f.name, size: f.size, priority: f.priority, progress: f.progress, kind: fileKind(f.name) }));
}

/** Accept one configured download endpoint, never an arbitrary URL or redirect destination. */
export function validateProwlarrSource(downloadUrl: string, baseUrl: string, indexerId: number): URL {
  let url: URL;
  let base: URL;
  try { url = new URL(downloadUrl); base = new URL(baseUrl); } catch { throw new CollectionError('Invalid configured metadata source'); }
  const expectedPath = `${base.pathname.replace(/\/$/, '')}/${indexerId}/download`;
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.pathname !== expectedPath
    || url.username || url.password || url.hash || !Number.isSafeInteger(indexerId) || indexerId <= 0) {
    throw new CollectionError('Use a configured Prowlarr download endpoint or upload the .torrent metadata');
  }
  return url;
}

function rawSegment(value: unknown): string {
  const bytes = ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
  const text = bytes ? bytes.toString('utf8') : value;
  if (typeof text !== 'string' || text.includes('/') || (bytes && !Buffer.from(text).equals(bytes))) {
    throw new CollectionError('Torrent path encoding is unsafe');
  }
  return collectionPath(text);
}

export async function parseCollectionTorrent(buffer: Buffer, limits: CollectionLimits): Promise<CollectionMetadata> {
  if (!buffer.length || buffer.length > METADATA_LIMIT) throw new CollectionError('Torrent metadata exceeds the 4 MiB limit');
  let parsed: any;
  try { parsed = await parseTorrent(buffer); } catch { throw new CollectionError('Invalid torrent metadata'); }
  const infoHash = collectionHash(parsed.infoHash);
  const info = parsed.info;
  if (!info) throw new CollectionError('Torrent metadata is unresolved');
  rawSegment(info.name);
  const name = rawSegment(info['name.utf-8'] || info.name);
  // Check original path components before parse-torrent can normalize traversal segments.
  const rawFiles = info.files;
  if (rawFiles) {
    if (!Array.isArray(rawFiles) || rawFiles.length > limits.maxTorrentFiles) throw new CollectionError('Torrent file count exceeds the limit');
    for (const raw of rawFiles) {
      if (raw['symlink path'] || Buffer.from(raw.attr || '').toString('utf8').includes('l')) throw new CollectionError('Torrent symlinks are not supported');
      for (const segments of [raw.path, ...(raw['path.utf-8'] ? [raw['path.utf-8']] : [])]) {
        if (!Array.isArray(segments) || !segments.length) throw new CollectionError('Torrent path is invalid');
        segments.forEach(rawSegment);
      }
    }
  }
  if (info['symlink path'] || Buffer.from(info.attr || '').toString('utf8').includes('l')) throw new CollectionError('Torrent symlinks are not supported');
  const files: CollectionFile[] = (parsed.files || []).map((file: any, index: number) => ({
    index, path: file.path, size: file.length, kind: fileKind(file.path), priority: 0, progress: 0,
  }));
  const totalBytes = validateFileList(files, limits);
  return { infoHash, name, files, totalBytes, existing: false, torrentBuffer: buffer };
}

async function readRemote(source: Extract<CollectionSource, { kind: 'prowlarr' }>, config: ConfigurationService): Promise<Buffer | string> {
  const settings = await config.getMany(['prowlarr_url', 'prowlarr_api_key', 'prowlarr_indexers']);
  const base = settings.prowlarr_url || process.env.PROWLARR_URL;
  if (!base) throw new CollectionError('Prowlarr is not configured');
  const indexers = JSON.parse(settings.prowlarr_indexers || '[]');
  if (!Array.isArray(indexers) || !indexers.some(i => i.id === source.indexerId && i.enabled !== false)) throw new CollectionError('This indexer is not enabled');
  const url = validateProwlarrSource(source.downloadUrl, base, source.indexerId);
  const apiKey = settings.prowlarr_api_key || process.env.PROWLARR_API_KEY;
  // Do not forward a supplied API key or follow a redirect with our credentials.
  url.searchParams.delete('apikey');
  let response;
  try {
    response = await axios.get(url.toString(), {
      responseType: 'arraybuffer', maxRedirects: 0, timeout: 20000,
      maxContentLength: METADATA_LIMIT, maxBodyLength: METADATA_LIMIT,
      validateStatus: status => status >= 200 && status < 400,
      headers: { 'User-Agent': RMAB_USER_AGENT, ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
    });
  } catch { throw new CollectionError('Could not read bounded torrent metadata from the configured indexer', 502); }
  if (response.status >= 300) {
    const location = response.headers.location;
    if (typeof location === 'string' && location.startsWith('magnet:')) return location;
    throw new CollectionError('Metadata redirect blocked. Upload the .torrent file instead');
  }
  const buffer = Buffer.from(response.data);
  const text = buffer.toString('utf8').trim();
  return text.startsWith('magnet:') ? text : buffer;
}

export async function loadCollectionMetadata(source: CollectionSource, client: QBittorrentService, config: ConfigurationService, limits: CollectionLimits): Promise<CollectionMetadata> {
  let metadata: CollectionMetadata | undefined;
  let hash: string;
  if (source.kind === 'existing') {
    hash = collectionHash(source.infoHash);
  } else {
    let content: Buffer | string;
    if (source.kind === 'upload') {
      if (typeof source.torrentBase64 !== 'string' || source.torrentBase64.length > Math.ceil(METADATA_LIMIT / 3) * 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.torrentBase64)) throw new CollectionError('Invalid or oversized torrent metadata upload');
      content = Buffer.from(source.torrentBase64, 'base64');
    } else if (source.kind === 'prowlarr') {
      if (source.downloadUrl.startsWith('magnet:')) content = source.downloadUrl;
      else content = await readRemote(source, config);
    } else throw new CollectionError('Unsupported collection metadata source');
    if (typeof content === 'string') {
      let parsed: any;
      try { parsed = await parseTorrent(content); } catch { throw new CollectionError('Invalid magnet metadata'); }
      hash = collectionHash(parsed?.infoHash);
    } else {
      metadata = await parseCollectionTorrent(content, limits);
      hash = metadata.infoHash;
    }
  }
  const existing = await client.findTorrent(hash);
  if (existing) {
    const files = fromClientFiles(await client.getFiles(hash));
    return { infoHash: hash, name: existing.name, files, totalBytes: validateFileList(files, limits), existing: true };
  }
  if (!metadata) throw new CollectionError('Magnet metadata is unresolved or the torrent is absent. Upload a .torrent file. No torrent was started');
  return metadata;
}
