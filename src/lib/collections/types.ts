/**
 * Component: Collection Selection Types
 * Documentation: documentation/features/collection-workflow.md
 */

export type CollectionFileKind = 'audio' | 'cover' | 'companion' | 'unsupported';

export interface CollectionFile {
  index: number;
  path: string;
  size: number;
  kind: CollectionFileKind;
  priority: number;
  progress: number;
}

/** Paths are relative to qBittorrent's save root, not the collection's content root. */
export interface CollectionSelection {
  version: 1;
  batchId: string;
  infoHash: string;
  files: Array<Pick<CollectionFile, 'index' | 'path' | 'size' | 'kind'>>;
}

export interface CollectionLimits {
  maxSelectedBytes: number;
  maxSelectedFiles: number;
  maxTotalBytes: number;
  maxTorrentFiles: number;
}

export type CollectionSource =
  | { kind: 'prowlarr'; downloadUrl: string; indexerId: number }
  | { kind: 'upload'; torrentBase64: string }
  | { kind: 'existing'; infoHash: string };

export interface CollectionMapping {
  requestId: string;
  fileIndexes: number[];
}

export interface CollectionBook {
  requestId: string;
  title: string;
  author: string;
  narrator: string | null;
  series: string | null;
  seriesPart: string | null;
  asin: string | null;
}

export interface CollectionPreview {
  infoHash: string;
  name: string;
  fingerprint: string;
  files: CollectionFile[];
  totalBytes: number;
  existing: boolean;
  limits: CollectionLimits;
  books: CollectionBook[];
}
