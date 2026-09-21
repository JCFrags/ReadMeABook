/**
 * Component: Bundled Ebook and Safe Import Regressions
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FileOrganizer, getFileOrganizer } from '@/lib/utils/file-organizer';
import { validateBundledEbook } from '@/lib/utils/ebook-validation';
import { copyVerifiedImport, ensureImportDirectory, hashImportFile } from '@/lib/utils/import-safety';
import { collectionImportInventory } from '@/lib/utils/collection-import';
import type { CollectionSelection } from '@/lib/collections/types';

vi.mock('@/lib/db', () => ({ prisma: { configuration: { findUnique: vi.fn(async () => null) } } }));

const identity = { title: 'A Quiet Orbit', author: 'Example Writer' };
let root: string;

async function epub(filename: string, title = identity.title, front = 'First edition. A complete tale.', content = 'The end.', language?: string) {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'));
  zip.addFile('book.opf', Buffer.from(`<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>${title}</dc:title><dc:creator>${identity.author}</dc:creator>${language ? `<dc:language>${language}</dc:language>` : ''}</metadata><manifest><item id="front" href="front.xhtml"/><item id="end" href="end.xhtml"/></manifest><spine><itemref idref="front"/><itemref idref="end"/></spine></package>`));
  zip.addFile('front.xhtml', Buffer.from(`<html><body>${front}</body></html>`));
  zip.addFile('end.xhtml', Buffer.from(`<html><body>${content}</body></html>`));
  zip.writeZip(filename);
}

// Minimal, readable local PDF fixture. It contains no private book content.
async function pdf(filename: string) {
  const body = `BT /F1 12 Tf 50 700 Td (${identity.title} - ${identity.author}) Tj 0 -20 Td (First edition. The end.) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
  ];
  let data = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  data += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await fs.writeFile(filename, data);
}

describe('bounded bundled ebook imports', () => {
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-import-test-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('copies matching bundled formats independently and reports ebook-only downloads without audio success', async () => {
    const downloads = path.join(root, 'downloads');
    const ebooks = path.join(root, 'ebooks');
    await fs.mkdir(downloads);
    const source = path.join(downloads, 'book.epub');
    const sourcePdf = path.join(downloads, 'book.pdf');
    await epub(source);
    await pdf(sourcePdf);
    const originalHash = await hashImportFile(source);
    const organizer = new FileOrganizer(path.join(root, 'audio'), path.join(root, 'temp'), 0o664, 0o775, { enabled: true, ebookRoot: ebooks });
    const formatFailure = await organizer.organize(downloads, identity, '{author}/{title}');
    expect(formatFailure.success).toBe(false);
    expect(formatFailure.failureKind).toBe('wrong_format');
    expect(formatFailure.bundledEbooks?.files.map(file => file.validation.confirmedFormat)).toEqual([true, true]);
    const destination = path.join(ebooks, identity.author, identity.title, `${identity.title}.epub`);
    expect(await hashImportFile(destination)).toBe(originalHash);
    expect((await fs.stat(destination)).ino).not.toBe((await fs.stat(source)).ino);
    const pdfResult = formatFailure.bundledEbooks!.files.find(file => file.sourcePath.endsWith('.pdf'))!;
    // Poppler is optional. Its absence must be visible and must never admit an unverified PDF.
    if (pdfResult.validation.status === 'validated') {
      expect(await hashImportFile(pdfResult.targetPath!)).toBe(await hashImportFile(sourcePdf));
    } else {
      expect(pdfResult.targetPath).toBeUndefined();
      expect(formatFailure.bundledEbooks!.warnings.join(' ')).toContain('unverified');
    }
    await fs.writeFile(path.join(downloads, 'book.mp3'), 'fixture audio');
    const success = await organizer.organize(downloads, identity, '{author}/{title}');
    expect(success.success).toBe(true);
    expect(success.audioFiles).toHaveLength(1);
    expect(success.bundledEbooks!.preserveSource).toBe(true);
    expect(await hashImportFile(source)).toBe(originalHash);
  });

  it('rejects a MEAP, wrong title, and incomplete EPUB without deleting source files', async () => {
    const filename = path.join(root, 'book.epub');
    await epub(filename, identity.title, 'Welcome to the MEAP. Chapters 1-5 only.');
    expect(await validateBundledEbook(filename, identity)).toMatchObject({ status: 'rejected', confirmedFormat: true });
    await epub(filename, 'A Different Book');
    expect(await validateBundledEbook(filename, identity)).toMatchObject({ status: 'rejected', reason: expect.stringContaining('does not match') });
    await epub(filename);
    const zip = new AdmZip(filename);
    zip.deleteFile('end.xhtml');
    zip.writeZip(filename);
    expect(await validateBundledEbook(filename, identity)).toMatchObject({ status: 'rejected', confirmedFormat: true });
    expect((await fs.stat(filename)).size).toBeGreaterThan(0);
  });

  it('rejects explicit EPUB language conflicts and uses the configured region language', async () => {
    const filename = path.join(root, 'book.epub');
    await epub(filename, undefined, undefined, undefined, 'fr-FR');
    expect(await validateBundledEbook(filename, identity, 'en')).toMatchObject({ status: 'rejected', reason: expect.stringContaining('language') });
    expect(await validateBundledEbook(filename, identity)).toMatchObject({ status: 'validated' });
    for (const [declared, expected] of [['EN_us', 'eng'], ['eng-GB', 'en'], ['fra', 'fr'], ['fre-CA', 'fr'], ['ger', 'deu'], ['spa-MX', 'es']]) {
      await epub(filename, undefined, undefined, undefined, declared);
      expect(await validateBundledEbook(filename, identity, expected)).toMatchObject({ status: 'validated' });
    }
    for (const language of [undefined, 'und', 'unknown']) {
      await epub(filename, undefined, undefined, undefined, language);
      expect(await validateBundledEbook(filename, identity, 'en')).toMatchObject({ status: 'validated', reason: expect.stringContaining('language is not verified') });
    }
    await epub(filename, undefined, undefined, undefined, 'en-US');
    const { getConfigService } = await import('@/lib/services/config.service');
    const getConfig = vi.spyOn(getConfigService(), 'get').mockImplementation(async key => key === 'audible.region' ? 'fr' : null);
    const organized = await (await getFileOrganizer()).organize(filename, identity, '{author}/{title}');
    expect(getConfig).toHaveBeenCalledWith('audible.region');
    expect(organized.bundledEbooks?.files[0].validation).toMatchObject({ status: 'rejected', reason: expect.stringContaining('language') });
    expect(organized.bundledEbooks?.files[0].targetPath).toBeUndefined();
    expect((await fs.stat(filename)).size).toBeGreaterThan(0);
  });

  it('reuses identical bytes but refuses different existing content and symlink destinations', async () => {
    const source = path.join(root, 'source.epub');
    const destination = path.join(root, 'target.epub');
    await epub(source);
    expect(await copyVerifiedImport(source, destination, 0o664)).toBe(true);
    expect(await copyVerifiedImport(source, destination, 0o664)).toBe(false);
    const retainedHash = await hashImportFile(destination);
    await epub(source, identity.title, 'Another edition.', 'Different bytes.');
    await expect(copyVerifiedImport(source, destination, 0o664)).rejects.toThrow('Import conflict');
    expect(await hashImportFile(destination)).toBe(retainedHash);
    const link = path.join(root, 'link.epub');
    await fs.symlink(destination, link);
    await expect(copyVerifiedImport(source, link, 0o664)).rejects.toThrow('Symbolic links');
    await expect(ensureImportDirectory(root, path.join(root, '..', 'escape'), 0o775)).rejects.toThrow('escapes');
  });

  it('checks only exact collection paths and refuses incomplete or missing selected files', async () => {
    const folder = path.join(root, 'Pack', 'Book');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'one.mp3'), 'one');
    await fs.writeFile(path.join(folder, 'two.mp3'), 'two');
    const manifest: CollectionSelection = { version: 1, batchId: 'batch', infoHash: 'a'.repeat(40), files: [
      { index: 0, path: 'Pack/Book/one.mp3', size: 3, kind: 'audio' },
      { index: 1, path: 'Pack/Book/two.mp3', size: 3, kind: 'audio' },
    ] };
    // An unrelated unsafe pack member must not be visited by a selected import.
    await fs.symlink('/unavailable', path.join(root, 'unrelated'));
    const organizer = new FileOrganizer(path.join(root, 'audio'));
    const complete = await organizer.organize(root, identity, '{author}/{title}', undefined, undefined, undefined, manifest);
    expect(complete.success).toBe(true);
    expect(complete.accountedAudioCount).toBe(2);
    await fs.writeFile(path.join(folder, 'two.mp3'), 'partial');
    await expect(collectionImportInventory(root, manifest)).rejects.toThrow('Incomplete selected collection file');
    await fs.unlink(path.join(folder, 'two.mp3'));
    const incomplete = await organizer.organize(root, identity, '{author}/{title}', undefined, undefined, undefined, manifest);
    expect(incomplete.success).toBe(false);
    expect(incomplete.errors.join(' ')).toContain('ENOENT');
  });
});
