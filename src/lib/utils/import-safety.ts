/**
 * Component: Safe Import File Operations
 * Documentation: documentation/phase3/file-organization.md
 */

import fs from 'fs/promises';
import { constants, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';

export class ImportConflictError extends Error {
  constructor(filename: string, reason = 'existing destination has different content') {
    super(`Import conflict: ${reason}: ${filename}`);
    this.name = 'ImportConflictError';
  }
}

export function assertContained(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Import path escapes its configured root');
  }
}

/** Reject symbolic links, including links in an ancestor directory. */
export async function assertImportPath(candidate: string): Promise<void> {
  const absolute = path.resolve(candidate);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if ((await fs.lstat(current)).isSymbolicLink()) {
      throw new Error('Symbolic links are not allowed in import paths');
    }
  }
}

export async function ensureImportDirectory(root: string, target: string, mode: number): Promise<void> {
  assertContained(root, target);
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      await fs.mkdir(current, { mode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Import destination must contain only real directories');
    }
  }
}

export async function hashImportFile(filename: string): Promise<string> {
  await assertImportPath(filename);
  if (!(await fs.lstat(filename)).isFile()) throw new Error('Import source must be a regular file');
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Import source must be a regular file');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** Reuse only byte-identical files. Never modify an existing destination. */
export async function sameImportContent(source: string, destination: string): Promise<boolean> {
  await assertImportPath(source);
  await assertImportPath(destination);
  const [src, dst] = await Promise.all([fs.lstat(source), fs.lstat(destination)]);
  if (!src.isFile() || !dst.isFile()) throw new Error('Import content must be a regular file');
  if (src.size !== dst.size) return false;
  return (await hashImportFile(source)) === (await hashImportFile(destination));
}

/**
 * Stream to an exclusive temporary file, verify it, then publish without overwrite.
 * The temporary file and final link share an inode, never the download source.
 * Standard read/write syscalls retain NFS/FUSE copy compatibility.
 */
export async function copyVerifiedImport(source: string, destination: string, mode: number): Promise<boolean> {
  await assertImportPath(source);
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isFile()) throw new Error('Import source must be a regular file');
  await assertImportPath(path.dirname(destination));
  try {
    const destinationStat = await fs.lstat(destination);
    if (sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino) {
      throw new ImportConflictError(path.basename(destination), 'destination shares the source inode; an independent copy is required');
    }
    if (!(await sameImportContent(source, destination))) throw new ImportConflictError(path.basename(destination));
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporary = path.join(path.dirname(destination), `.rmab-${randomUUID()}.partial`);
  const sourceHandle = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await sourceHandle.stat()).isFile()) throw new Error('Import source must be a regular file');
    await pipeline(
      createReadStream(source, { fd: sourceHandle.fd, autoClose: false }),
      createWriteStream(temporary, { flags: 'wx', mode }),
    );
    if (!(await sameImportContent(source, temporary))) throw new Error('EIO: copied content verification failed');
    await fs.chmod(temporary, mode);
    try {
      // link() is atomic and fails if destination exists. rename() would overwrite it.
      await fs.link(temporary, destination);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await sameImportContent(source, destination))) throw new ImportConflictError(path.basename(destination));
      return false;
    }
  } finally {
    await sourceHandle.close();
    await fs.unlink(temporary).catch(() => undefined);
  }
}
