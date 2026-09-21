/**
 * Component: Collection Safety Validation
 * Documentation: documentation/features/collection-workflow.md
 */

import { createHash } from 'crypto';
import path from 'path';
import { AUDIO_EXTENSIONS, DRM_EXTENSIONS } from '@/lib/constants/audio-formats';
import type { CollectionFile, CollectionFileKind, CollectionLimits, CollectionMapping, CollectionSelection } from './types';

export const METADATA_LIMIT = 4 * 1024 * 1024;
export const DEFAULT_COLLECTION_LIMITS: CollectionLimits = {
  maxSelectedBytes: 10 * 1024 ** 3,
  maxSelectedFiles: 200,
  maxTotalBytes: 2 * 1024 ** 4,
  maxTorrentFiles: 20000,
};
export const ELIGIBLE_COLLECTION_STATUSES = ['awaiting_search', 'awaiting_release', 'failed', 'warn'];

export class CollectionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function collectionPath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\\:\x00-\x1f\x7f]/.test(value)
    || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new CollectionError('Torrent contains an unsafe or ambiguous file path');
  }
  return value;
}

export function collectionHash(value: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) {
    throw new CollectionError('A v1 torrent info hash is required');
  }
  return value.toLowerCase();
}

export function fileKind(filename: string): CollectionFileKind {
  const ext = path.posix.extname(filename).toLowerCase();
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext) && !(DRM_EXTENSIONS as readonly string[]).includes(ext)) return 'audio';
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'cover';
  if (['.epub', '.pdf'].includes(ext)) return 'companion';
  return 'unsupported';
}

export function validateFileList(files: CollectionFile[], limits: CollectionLimits): number {
  if (!files.length || files.length > limits.maxTorrentFiles) throw new CollectionError('Torrent file count exceeds the limit or metadata is unresolved');
  const paths = new Set<string>();
  const indexes = new Set<number>();
  let total = 0;
  for (const file of files) {
    collectionPath(file.path);
    // Case-folding also prevents a collision when the download path is on a case-insensitive filesystem.
    const key = file.path.toLowerCase();
    if (paths.has(key) || indexes.has(file.index)) throw new CollectionError('Torrent has duplicate file paths or indexes');
    if (!Number.isSafeInteger(file.index) || file.index < 0 || !Number.isSafeInteger(file.size) || file.size < 0
      || ![0, 1, 4, 6, 7].includes(file.priority) || !Number.isFinite(file.progress) || file.progress < 0 || file.progress > 1) {
      throw new CollectionError('Torrent file metadata is invalid');
    }
    paths.add(key); indexes.add(file.index); total += file.size;
    if (!Number.isSafeInteger(total) || total > limits.maxTotalBytes) throw new CollectionError('Torrent total size exceeds the metadata preview limit');
  }
  return total;
}

export function fileFingerprint(infoHash: string, files: CollectionFile[]): string {
  return createHash('sha256').update(JSON.stringify([collectionHash(infoHash), files.map(f => [f.index, f.path, f.size, f.priority])])).digest('hex');
}

export function validateMappings(files: CollectionFile[], mappings: CollectionMapping[], limits: CollectionLimits): Map<string, CollectionFile[]> {
  validateFileList(files, limits);
  if (!Array.isArray(mappings) || !mappings.length || mappings.length > 50) throw new CollectionError('Select between 1 and 50 existing book requests');
  const byIndex = new Map(files.map(file => [file.index, file]));
  const selected = new Set<number>();
  const books = new Map<string, CollectionFile[]>();
  let bytes = 0;
  for (const mapping of mappings) {
    if (typeof mapping.requestId !== 'string' || !mapping.requestId || books.has(mapping.requestId)
      || !Array.isArray(mapping.fileIndexes) || !mapping.fileIndexes.length) throw new CollectionError('Each requested book needs one explicit file mapping');
    const mapped = mapping.fileIndexes.map(index => {
      const file = byIndex.get(index);
      if (!file || selected.has(index) || file.kind === 'unsupported' || file.size <= 0) throw new CollectionError('Selected files are missing, repeated, empty, or unsupported');
      selected.add(index); bytes += file.size;
      return file;
    });
    const audio = mapped.filter(file => file.kind === 'audio');
    if (!audio.length) throw new CollectionError('Every mapped book must contain audio. An ebook cannot fulfill an audiobook request');
    const audioDirs = new Set(audio.map(file => path.posix.dirname(file.path)));
    for (const file of mapped.filter(f => f.kind !== 'audio')) {
      if (!audioDirs.has(path.posix.dirname(file.path))) throw new CollectionError('Cover and companion files must be beside the mapped book audio');
    }
    // Flattened imports cannot safely contain repeated basenames from separate discs.
    const names = mapped.map(f => path.posix.basename(f.path).toLowerCase());
    if (new Set(names).size !== names.length) throw new CollectionError('A book contains repeated basenames. Select an unambiguous edition or rename the source explicitly');
    books.set(mapping.requestId, mapped);
  }
  if (selected.size > limits.maxSelectedFiles || bytes > limits.maxSelectedBytes) throw new CollectionError('Selected files exceed the configured byte or file limit');
  return books;
}

export function readCollectionSelection(value: unknown): CollectionSelection | null {
  if (value == null) return null;
  const selection = value as CollectionSelection;
  if (selection.version !== 1 || typeof selection.batchId !== 'string' || !selection.batchId || !Array.isArray(selection.files) || !selection.files.length) {
    throw new CollectionError('Saved collection selection is invalid');
  }
  collectionHash(selection.infoHash);
  const files = selection.files.map(f => ({ ...f, priority: 1, progress: 1 }));
  validateFileList(files, { ...DEFAULT_COLLECTION_LIMITS, maxTotalBytes: Number.MAX_SAFE_INTEGER });
  if (!files.some(f => f.kind === 'audio') || files.some(f => f.kind !== fileKind(f.path) || f.kind === 'unsupported' || f.size <= 0)) {
    throw new CollectionError('Saved collection selection has invalid file types');
  }
  return selection;
}
