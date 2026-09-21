/**
 * Component: Bundled Ebook Preservation
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import path from 'path';
import { buildRenamedFilename, substituteTemplate } from './path-template.util';
import { copyVerifiedImport, ensureImportDirectory } from './import-safety';
import { validateBundledEbook, type EbookIdentity, type EbookValidation } from './ebook-validation';

export interface BundledEbookResult {
  files: Array<{ sourcePath: string; validation: EbookValidation; targetPath?: string }>;
  warnings: string[];
  onlyEbooks: boolean;
  preserveSource: boolean;
}

interface PreservationOptions {
  enabled: boolean;
  ebookRoot?: string;
  companionPath?: string;
  expectedLanguage?: string;
  fileMode: number;
  dirMode: number;
}

const ancillary = new Set(['.jpg', '.jpeg', '.png', '.webp', '.nfo', '.txt', '.sfv', '.url']);

/** Receives only the import's exact inventory. Never discovers or downloads more files. */
export async function preserveBundledEbooks(
  files: string[],
  metadata: EbookIdentity,
  options: PreservationOptions,
): Promise<BundledEbookResult> {
  const candidates = files.filter(file => ['.epub', '.pdf'].includes(path.extname(file).toLowerCase()));
  const result: BundledEbookResult = { files: [], warnings: [], onlyEbooks: false, preserveSource: candidates.length > 0 };
  for (const sourcePath of candidates) {
    try {
      const validation = await validateBundledEbook(sourcePath, metadata, options.expectedLanguage);
      const entry: BundledEbookResult['files'][number] = { sourcePath, validation };
      result.files.push(entry);
      if (validation.status !== 'validated') {
        result.warnings.push(`${path.basename(sourcePath)}: ${validation.status}. ${validation.reason}. Source retained for manual review.`);
        continue;
      }
      if (!options.enabled) {
        result.warnings.push(`${path.basename(sourcePath)}: bundled ebook copy disabled; source retained.`);
        continue;
      }
      const root = options.ebookRoot || options.companionPath;
      if (!root) {
        result.warnings.push(`${path.basename(sourcePath)}: configure ebook_media_dir to preserve an ebook-only download in the library; source retained.`);
        continue;
      }
      const targetDir = options.ebookRoot
        ? path.join(root, substituteTemplate('{author}/{title}', metadata))
        : root;
      await ensureImportDirectory(root, targetDir, options.dirMode);
      const filename = buildRenamedFilename('{title}', metadata, path.extname(sourcePath).toLowerCase());
      const destination = path.join(targetDir, filename);
      await copyVerifiedImport(sourcePath, destination, options.fileMode);
      entry.targetPath = destination;
    } catch (error) {
      result.warnings.push(`${path.basename(sourcePath)}: ebook preservation failed: ${error instanceof Error ? error.message : 'unknown error'}. Source retained.`);
    }
  }
  // Unknown archives, partial downloads, and unreadable entries prevent a permanent format claim.
  result.onlyEbooks = candidates.length > 0 && result.files.length === candidates.length &&
    result.files.every(file => file.validation.confirmedFormat) &&
    files.every(file => candidates.includes(file) || ancillary.has(path.extname(file).toLowerCase()) || path.basename(file) === '.DS_Store');
  return result;
}
