/**
 * Component: Bounded Collection Safety Checks
 * Documentation: documentation/features/collection-workflow.md
 */

import { describe, expect, it, vi } from 'vitest';
import { CollectionError, DEFAULT_COLLECTION_LIMITS as limits, fileFingerprint, validateMappings } from '@/lib/collections/validation';
import { loadCollectionMetadata, parseCollectionTorrent, validateProwlarrSource } from '@/lib/collections/metadata';
import { prepareCollectionSelection } from '@/lib/collections/client-selection';
import { collectionProgress } from '@/lib/collections/progress';
import type { CollectionFile } from '@/lib/collections/types';

function encode(value: any): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string' || Buffer.isBuffer(value)) { const bytes = Buffer.from(value); return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]); }
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(encode), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'), ...Object.keys(value).sort().flatMap(key => [encode(key), encode(value[key])]), Buffer.from('e')]);
}
function torrent(segments = ['One', 'audio.mp3'], extra = {}) {
  return encode({ info: { name: 'Pack', files: [{ length: 10, path: segments, ...extra }], 'piece length': 16384, pieces: Buffer.alloc(20) } });
}
const hash = 'a'.repeat(40);
const batchId = '11111111-1111-4111-8111-111111111111';
const files: CollectionFile[] = [
  { index: 0, path: 'Pack/One/audio.mp3', size: 10, kind: 'audio', priority: 0, progress: 0 },
  { index: 1, path: 'Pack/One/cover.jpg', size: 2, kind: 'cover', priority: 0, progress: 0 },
  { index: 2, path: 'Pack/Two/audio.mp3', size: 12, kind: 'audio', priority: 0, progress: 0 },
];

function fakeClient(existing = false) {
  let state: any = existing ? { hash, tags: '', state: 'uploading', downloaded: 24 } : null;
  let actual = files.map(file => ({ ...file, name: file.path, priority: existing && file.index === 2 ? 6 : existing ? 0 : 1, progress: existing && file.index === 2 ? 1 : 0 }));
  const calls: string[] = [];
  const client = {
    findTorrent: vi.fn(async () => state), getTorrent: vi.fn(async () => state),
    getFiles: vi.fn(async () => actual.map(file => ({ ...file }))),
    addCollectionTorrent: vi.fn(async () => { calls.push('add-stopped'); state = { hash, tags: `rmab-collection,rmab-collection-${batchId}`, state: 'stoppedDL', downloaded: 0 }; return { created: true }; }),
    stopCollectionTorrent: vi.fn(async () => { calls.push('stop'); state.state = 'stoppedDL'; }),
    startCollectionTorrent: vi.fn(),
    setFilePriority: vi.fn(async (_hash: string, indexes: number[], priority: number) => {
      calls.push(`priority-${priority}:${indexes.join(',')}`);
      actual = actual.map(file => indexes.includes(file.index) ? { ...file, priority } : file);
    }),
  };
  return { client, calls, actual: () => actual };
}

describe('bounded collection selection', () => {
  it('parses real torrent metadata and rejects traversal before path normalization or symlink selection', async () => {
    const result = await parseCollectionTorrent(torrent(), limits);
    expect(result.files[0]).toMatchObject({ path: 'Pack/One/audio.mp3', size: 10, kind: 'audio' });
    expect(result.infoHash).toMatch(/^[a-f0-9]{40}$/);
    await expect(parseCollectionTorrent(torrent(['..', 'audio.mp3']), limits)).rejects.toBeInstanceOf(CollectionError);
    await expect(parseCollectionTorrent(torrent(['audio.mp3'], { attr: 'l', 'symlink path': ['other'] }), limits)).rejects.toThrow('symlinks');
  });

  it('requires one audio mapping per book, unique files, adjacent companions, and server-size limits', () => {
    expect(validateMappings(files, [{ requestId: 'one', fileIndexes: [0, 1] }], limits).get('one')).toHaveLength(2);
    expect(() => validateMappings(files, [{ requestId: 'one', fileIndexes: [1] }], limits)).toThrow('must contain audio');
    expect(() => validateMappings(files, [{ requestId: 'one', fileIndexes: [0] }, { requestId: 'two', fileIndexes: [0] }], limits)).toThrow('repeated');
    expect(() => validateMappings(files, [{ requestId: 'two', fileIndexes: [1, 2] }], limits)).toThrow('beside');
    expect(() => validateMappings(files, [{ requestId: 'one', fileIndexes: [0, 1] }], { ...limits, maxSelectedBytes: 11 })).toThrow('limit');
  });

  it('does not accept arbitrary URLs or alternate Prowlarr endpoints', () => {
    expect(validateProwlarrSource('https://indexers.example/base/1/download?link=source', 'https://indexers.example/base', 1).hostname).toBe('indexers.example');
    for (const url of ['https://elsewhere.example/1/download', 'file:///etc/passwd', 'https://indexers.example/base/api/v1/config', 'https://user:pass@indexers.example/base/1/download']) {
      expect(() => validateProwlarrSource(url, 'https://indexers.example/base', 1)).toThrow();
    }
  });

  it('blocks unresolved magnets without adding or starting any torrent', async () => {
    const { client } = fakeClient();
    await expect(loadCollectionMetadata({ kind: 'prowlarr', indexerId: 1, downloadUrl: `magnet:?xt=urn:btih:${hash}` }, client as any, {} as any, limits)).rejects.toThrow('unresolved');
    expect(client.addCollectionTorrent).not.toHaveBeenCalled();
    expect(client.startCollectionTorrent).not.toHaveBeenCalled();
  });

  it('clears all new priorities while stopped, applies only selected indexes, and leaves start to the persisted handoff', async () => {
    const { client, calls, actual } = fakeClient();
    await prepareCollectionSelection(client as any, { infoHash: hash, name: 'Pack', files, totalBytes: 24, existing: false, torrentBuffer: torrent() }, new Set([0, 1]), limits, batchId);
    expect(calls).toEqual(['add-stopped', 'priority-0:0,1,2', 'priority-1:0,1']);
    expect(actual().map(f => f.priority)).toEqual([1, 1, 0]);
    expect(client.startCollectionTorrent).not.toHaveBeenCalled();
  });

  it('reuses a hash and preserves its completed unrelated selection and priority', async () => {
    const { client, calls, actual } = fakeClient(true);
    const before = files.map(file => ({ ...file, priority: file.index === 2 ? 6 : 0, progress: file.index === 2 ? 1 : 0 }));
    await prepareCollectionSelection(client as any, { infoHash: hash, name: 'Pack', files: before, totalBytes: 24, existing: true }, new Set([0]), limits, batchId);
    expect(calls).toEqual(['stop', 'priority-1:0']);
    expect(actual().map(f => f.priority)).toEqual([1, 0, 6]);
    expect(client.addCollectionTorrent).not.toHaveBeenCalled();
    expect(fileFingerprint(hash, before)).not.toBe(fileFingerprint(hash, files));
  });

  it('blocks unrelated incomplete selections before stopping or changing an existing torrent', async () => {
    const { client } = fakeClient(true);
    const incomplete = files.map(file => ({ ...file, priority: 1 }));
    client.getFiles.mockResolvedValue(incomplete.map(f => ({ ...f, name: f.path })));
    await expect(prepareCollectionSelection(client as any, { infoHash: hash, name: 'Pack', files: incomplete, totalBytes: 24, existing: true }, new Set([0]), limits, batchId)).rejects.toThrow('unrelated incomplete');
    expect(client.stopCollectionTorrent).not.toHaveBeenCalled();
    expect(client.setFilePriority).not.toHaveBeenCalled();
  });

  it('tracks only mapped files and refuses changed file identity', async () => {
    const { client } = fakeClient(true);
    const selection = { version: 1 as const, batchId, infoHash: hash, files: [files[2]] };
    expect(await collectionProgress(client as any, hash, selection)).toEqual({ progress: 1, complete: true });
    await expect(collectionProgress(client as any, hash, { ...selection, files: [{ ...files[2], size: 99 }] })).rejects.toThrow('changed');
  });
});
