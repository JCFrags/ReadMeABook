/**
 * Component: Exact Collection Import Inventory
 * Documentation: documentation/phase3/file-organization.md
 */

import fs from 'fs/promises';
import path from 'path';
import type { CollectionSelection } from '../collections/types';
import { readCollectionSelection } from '../collections/validation';
import { assertContained, assertImportPath } from './import-safety';

export function sameCollectionSelection(left: CollectionSelection, right: CollectionSelection): boolean {
  const canonical = (selection: CollectionSelection) => JSON.stringify([
    selection.version, selection.batchId, selection.infoHash.toLowerCase(),
    [...selection.files].sort((a, b) => a.index - b.index).map(file => [file.index, file.path, file.size, file.kind]),
  ]);
  return canonical(left) === canonical(right);
}

/** downloadRoot is the mapped qBittorrent save_path, never its content_path. */
export async function collectionImportInventory(downloadRoot: string, input: CollectionSelection) {
  const selection = readCollectionSelection(input);
  if (!selection) throw new Error('Collection selection is required');
  await assertImportPath(downloadRoot);
  if (!(await fs.stat(downloadRoot)).isDirectory()) throw new Error('Collection save root is not a directory');
  for (const file of selection.files) {
    const source = path.join(downloadRoot, file.path);
    assertContained(downloadRoot, source);
    await assertImportPath(source);
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size !== file.size) {
      throw new Error(`Incomplete selected collection file: ${file.path}. Expected ${file.size} bytes, found ${stat.size}`);
    }
  }
  return {
    audioFiles: selection.files.filter(file => file.kind === 'audio').map(file => file.path),
    coverFile: selection.files.find(file => file.kind === 'cover')?.path,
    files: selection.files.map(file => file.path),
    isFile: false,
  };
}
