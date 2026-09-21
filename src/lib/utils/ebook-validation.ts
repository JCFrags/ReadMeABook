/**
 * Component: Bounded Bundled Ebook Validation
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { assertImportPath } from './import-safety';

const execute = promisify(execFile);
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false });

export interface EbookValidation {
  status: 'validated' | 'unverified' | 'rejected';
  confirmedFormat: boolean;
  reason: string;
  title?: string;
  author?: string;
}

export interface EbookIdentity { title: string; author: string }

const result = (status: EbookValidation['status'], confirmedFormat: boolean, reason: string): EbookValidation =>
  ({ status, confirmedFormat, reason });
const list = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: any): string => typeof value === 'object' && value ? text(value['#text']) : String(value ?? '');
const words = (value: string): string[] => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const normalized = (value: string): string => words(value).join(' ');
const edition = (value: string): string | undefined => {
  const match = normalized(value).match(/\b(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (?:edition|ed)\b/);
  if (!match) return undefined;
  const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'].indexOf(match[1]);
  return ordinal >= 0 ? String(ordinal + 1) : match[1].replace(/(?:st|nd|rd|th)$/, '');
};
const limitedEdition = /\b(?:meap|early access|preview edition|sample(?: edition| chapter| copy)?|excerpt|incomplete|advance (?:reader|review) copy)\b/i;
const limitedFrontMatter = /\b(?:meap|manning early access program|early access edition|sample edition|sample chapter|preview edition|this (?:book|publication|copy) is (?:an? )?(?:sample|excerpt|incomplete))\b/i;

function identityCheck(title: string, author: string, evidence: string, expected: EbookIdentity): EbookValidation {
  if (limitedEdition.test(title) || limitedFrontMatter.test(evidence)) {
    return result('rejected', true, 'Sample, early-access, or incomplete edition');
  }
  if (!title.trim() || !author.trim()) return result('unverified', true, 'Title or author identity is missing');
  const expectedEdition = edition(expected.title);
  const actualEdition = edition(`${title} ${evidence}`);
  if (expectedEdition && actualEdition && expectedEdition !== actualEdition) {
    return result('rejected', true, 'Edition does not match the requested title');
  }
  if (expectedEdition && !actualEdition) return result('unverified', true, 'Requested edition is not established');
  // Keep edition and numbered-volume tokens mandatory. Subtitles need explicit evidence too.
  const withoutEdition = (value: string) => normalized(value).replace(/\b(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (?:edition|ed)\b/g, '');
  const titleWords = words(withoutEdition(expected.title)).filter(word => !['a', 'an', 'the'].includes(word));
  const actualWords = new Set(words(withoutEdition(title)));
  const titleMatches = titleWords.length > 0 && titleWords.every(word => actualWords.has(word));
  const authors = words(expected.author).filter(word => word.length > 2);
  const actualAuthor = new Set(words(author));
  if (!titleMatches || !authors.length || !authors.every(word => actualAuthor.has(word))) {
    return result('rejected', true, 'Title or author does not match the requested book');
  }
  return { ...result('validated', true, 'Bounded structure and identity checks passed; whole-text completeness is not proven'), title, author };
}

function languageCode(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    // Canonicalize ISO aliases and compare primary languages, not regional variants.
    const code = new Intl.Locale(value.trim().replace(/_/g, '-')).language;
    return /^[a-z]{2,3}$/.test(code) && !['und', 'mul', 'zxx', 'mis'].includes(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function xml(content: string): any {
  if (/<!ENTITY/i.test(content) || XMLValidator.validate(content) !== true) throw new Error('Invalid or unsafe XML');
  return parser.parse(content);
}

function htmlText(content: string): string {
  const $ = cheerio.load(content);
  $('script, style, iframe, object').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

function archivePath(base: string, href: string): string {
  const decoded = decodeURIComponent(href.split('#')[0]);
  const resolved = path.posix.normalize(path.posix.join(base, decoded));
  if (!decoded || /[\\\0]/.test(decoded) || decoded.startsWith('/') || /^(?:[a-z]+:)/i.test(decoded) || resolved === '..' || resolved.startsWith('../')) {
    throw new Error('Unsafe EPUB resource path');
  }
  return resolved;
}

async function validateEpub(filename: string, expected: EbookIdentity, expectedLanguage?: string): Promise<EbookValidation> {
  if ((await fs.stat(filename)).size > MAX_ARCHIVE_BYTES) return result('unverified', false, 'EPUB exceeds bounded validation size');
  let confirmed = false;
  try {
    const zip = new AdmZip(filename);
    const entries = zip.getEntries();
    if (entries.length > 10000 || entries.some(entry => entry.header.size > MAX_ENTRY_BYTES ||
      (!entry.isDirectory && entry.header.size === 0 && entry.header.compressedSize > 2)) ||
      entries.reduce((size, entry) => size + entry.header.size, 0) > MAX_EXPANDED_BYTES) {
      return result('unverified', false, 'EPUB exceeds bounded archive expansion limits');
    }
    const names = new Set<string>();
    for (const entry of entries) {
      const name = archivePath('', entry.entryName);
      if (names.has(name)) throw new Error('Duplicate EPUB resource path');
      names.add(name);
      if (!entry.isDirectory) entry.getData(); // adm-zip checks CRC without extracting files.
    }
    const read = (name: string): string => {
      const entry = zip.getEntry(name);
      if (!entry || entry.isDirectory) throw new Error('Missing EPUB resource');
      if (entry.header.size > MAX_TEXT_BYTES) throw new Error('EPUB text exceeds bounded validation size');
      return entry.getData().toString('utf8');
    };
    if (read('mimetype').trim() !== 'application/epub+zip') throw new Error('Invalid EPUB mimetype');
    confirmed = true;
    const container = xml(read('META-INF/container.xml'));
    const rootfile: any = list(container.container?.rootfiles?.rootfile)[0];
    const opfPath = archivePath('', rootfile?.['@_full-path'] || '');
    const opf = xml(read(opfPath)).package;
    if (!opf) throw new Error('Missing EPUB package');
    const metadata = opf.metadata || {};
    const title = list(metadata.title).map(text).join(' ');
    const author = list(metadata.creator).map(text).join(', ');
    const expectedCode = languageCode(expectedLanguage);
    const languages = list(metadata.language).map(value => languageCode(text(value)));
    if (expectedCode && languages.some(code => code && code !== expectedCode)) {
      return result('rejected', true, 'EPUB language does not match the expected language');
    }
    const manifest = new Map<string, any>(list<any>(opf.manifest?.item).map(item => [item['@_id'], item]));
    const spine = list<any>(opf.spine?.itemref);
    if (!spine.length) throw new Error('Missing EPUB reading order');
    const front: string[] = [];
    for (const [index, reference] of spine.entries()) {
      const item = manifest.get(reference['@_idref']);
      if (!item) throw new Error('Missing EPUB spine item');
      const itemPath = archivePath(path.posix.dirname(opfPath), item['@_href'] || '');
      const content = read(itemPath);
      if (!content.trim()) throw new Error('Empty EPUB spine item');
      if (index < 6) front.push(htmlText(content).slice(0, 12000));
    }
    const evidence = `${title} ${front.join(' ')}`;
    if (limitedEdition.test(path.basename(filename)) || limitedFrontMatter.test(evidence)) {
      return result('rejected', true, 'Sample, early-access, or incomplete edition');
    }
    if (zip.getEntry('META-INF/encryption.xml') || [...manifest.values()].some(item => /\bscripted\b/.test(item['@_properties'] || ''))) {
      return result('unverified', true, 'Encrypted or scripted EPUB requires manual validation; no scripts were executed');
    }
    const validation = identityCheck(title, author, evidence, expected);
    if (validation.status === 'validated' && (!expectedCode || !languages.length || languages.some(code => !code))) {
      validation.reason += '; EPUB language is not verified';
    }
    return validation;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid archive';
    return result(reason.includes('exceeds bounded') ? 'unverified' : 'rejected', confirmed, `EPUB validation failed: ${reason}`);
  }
}

async function validatePdf(filename: string, expected: EbookIdentity): Promise<EbookValidation> {
  const handle = await fs.open(filename, 'r');
  try {
    const size = (await handle.stat()).size;
    const tail = Buffer.alloc(Math.min(size, 2048));
    await handle.read(tail, 0, tail.length, size - tail.length);
    if (!tail.includes(Buffer.from('%%EOF'))) return result('rejected', false, 'PDF is incomplete: missing end marker');
  } finally {
    await handle.close();
  }
  if (limitedEdition.test(path.basename(filename))) return result('rejected', true, 'Sample, early-access, or incomplete edition');
  try {
    const options = { timeout: 15000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } };
    const { stdout: info } = await execute('pdfinfo', [path.resolve(filename)], options);
    if (/^Encrypted:\s+yes/im.test(info)) return result('unverified', true, 'Encrypted PDF requires manual validation');
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    if (!pages) return result('rejected', true, 'PDF has no readable pages');
    const { stdout: opening } = await execute('pdftotext', ['-f', '1', '-l', String(Math.min(pages, 8)), path.resolve(filename), '-'], options);
    const { stdout: ending } = await execute('pdftotext', ['-f', String(pages), '-l', String(pages), path.resolve(filename), '-'], options);
    if (!opening.trim() || !ending.trim()) return result('unverified', true, 'PDF text readability or end-page check is inconclusive');
    if (limitedFrontMatter.test(opening)) return result('rejected', true, 'Sample, early-access, or incomplete edition');
    const expectedEdition = edition(expected.title);
    const actualEdition = edition(opening);
    if (expectedEdition && actualEdition && expectedEdition !== actualEdition) return result('rejected', true, 'PDF edition does not match the requested book');
    if (expectedEdition && !actualEdition) return result('unverified', true, 'PDF requested edition is not established');
    // Conversion metadata is often wrong. Require title and author together in the opening pages.
    const expectedWords = [...words(expected.title), ...words(expected.author)];
    const openingWords = new Set(words(opening));
    if (!expectedWords.every(word => openingWords.has(word))) return result('unverified', true, 'PDF opening pages do not establish the requested identity');
    const validation = identityCheck(expected.title, expected.author, opening, expected);
    if (validation.status === 'validated') validation.reason += '; PDF language is not verified';
    return validation;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return result('unverified', true, code === 'ENOENT'
      ? 'PDF tools unavailable: install pdfinfo and pdftotext or validate manually'
      : 'PDF readability check failed or exceeded its bounds; validate manually');
  }
}

export async function validateBundledEbook(filename: string, expected: EbookIdentity, expectedLanguage?: string): Promise<EbookValidation> {
  await assertImportPath(filename);
  if (!(await fs.lstat(filename)).isFile()) throw new Error('Ebook source must be a regular file');
  const handle = await fs.open(filename, 'r');
  let signature: Buffer;
  try {
    signature = Buffer.alloc(8);
    await handle.read(signature, 0, signature.length, 0);
  } finally {
    await handle.close();
  }
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.epub' && signature.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return validateEpub(filename, expected, expectedLanguage);
  if (ext === '.pdf' && /^%PDF-\d\.\d/.test(signature.toString('ascii'))) return validatePdf(filename, expected);
  return result('rejected', false, 'File signature does not match EPUB/PDF');
}
