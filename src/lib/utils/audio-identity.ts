/**
 * Component: Conservative Audio Release Identity
 * Documentation: documentation/phase3/search-policy.md
 */

import { normalizeDiscoveryText } from './search-discovery';

export interface AudioIdentity {
  title: string;
  author?: string;
  narrator?: string | null;
  series?: string | null;
  seriesPart?: string | null;
  language?: string | null;
  preferredLanguage?: string;
}

export interface AudioIdentityAssessment {
  status: 'compatible' | 'conflict' | 'unknown';
  reasons: string[];
  unverified: string[];
}

const normalize = (text: string) => normalizeDiscoveryText(text).toLowerCase();
const AUDIO = /\b(m4b|m4a|mp3|flac|ogg|opus|aac|audiobook|audio\s*book)\b/i;
const OTHER_FORMAT = /\b(epub|pdf|mobi|azw3?|cb[rz]|ebook|e-book|mkv|mp4|avi|web-?dl|bluray|blu-ray|h\.?26[45]|1080p|2160p)\b/i;
const COLLECTION = /\b(omnibus|anthology|box\s*set|collection|complete\s+series|books?\s+\d+\s*[-–]\s*\d+)\b/i;

function volume(text: string): string | undefined {
  const match = text.match(/\b(?:book|volume|vol\.?|part)\s*#?\s*(\d+(?:\.\d+)?|[ivxlcdm]+)\b/i);
  if (!match) return undefined;
  if (/^\d/.test(match[1])) return String(Number(match[1]));
  const roman: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const digits = match[1].toLowerCase().split('').map(c => roman[c]);
  return String(digits.reduce((sum, digit, i) => sum + (digit < (digits[i + 1] || 0) ? -digit : digit), 0));
}

function editions(text: string): string[] {
  const result: string[] = [];
  if (/\b(dramati[sz]ed|graphic\s*audio|audio\s*drama|full.cast)\b/i.test(text)) result.push('dramatized');
  if (/\bunabridged\b/i.test(text)) result.push('unabridged');
  else if (/\babridged\b/i.test(text)) result.push('abridged');
  const editionNumber = text.match(/\b(\d+)(?:st|nd|rd|th)?\s+(?:edition|ed\b)|\bedition\s+(\d+)\b/i);
  if (editionNumber) result.push(`edition-${Number(editionNumber[1] || editionNumber[2])}`);
  for (const label of ['revised', 'expanded', 'anniversary']) {
    if (new RegExp(`\\b${label}\\b`, 'i').test(text)) result.push(label);
  }
  return result;
}

function language(text: string): string | undefined {
  const names: Record<string, string> = {
    english: 'en', german: 'de', deutsch: 'de', french: 'fr', francais: 'fr',
    spanish: 'es', espanol: 'es', japanese: 'ja', italian: 'it', russian: 'ru',
    portuguese: 'pt', chinese: 'zh', dutch: 'nl', polish: 'pl',
  };
  const lower = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  for (const [name, code] of Object.entries(names)) {
    if (new RegExp(`(?:[\\[(]\\s*|\\blanguage\\s*[:=]\\s*)${name}\\b|\\b${name}\\s+edition\\b`).test(lower)) return code;
  }
  const code = text.match(/(?:\[|\blang(?:uage)?\s*[:=])\s*(en|de|fr|es|ja|it|ru|pt|zh|nl|pl)\s*(?:\]|\b)/i);
  return code?.[1].toLowerCase();
}

/** Compatible means metadata supports known constraints, not verified audio content. */
export function assessAudioIdentity(
  candidate: { title: string; format?: string; language?: string; narrator?: string },
  canonical: AudioIdentity
): AudioIdentityAssessment {
  const conflicts: string[] = [];
  const unknown: string[] = [];
  const unverified: string[] = [];
  const text = candidate.title;
  const candidateAudio = AUDIO.test(text) || /^(M4B|M4A|MP3|FLAC|OGG|OPUS|AAC)$/i.test(candidate.format || '');
  if (!AUDIO.test(text) && OTHER_FORMAT.test(text)) conflicts.push('Explicit non-audio release');
  else if (!candidateAudio) unknown.push('Audio format is unknown');
  if (COLLECTION.test(text)) unknown.push('Collection requires deliberate file selection');

  const expectedVolume = canonical.seriesPart
    ? volume(`Book ${canonical.seriesPart.replace(/^(book|vol(?:ume)?\.?|part)\s*/i, '')}`)
    : volume(canonical.title);
  const actualVolume = volume(text);
  if (expectedVolume && actualVolume && expectedVolume !== actualVolume) conflicts.push('Volume conflicts with request');
  else if (expectedVolume && !actualVolume) unknown.push('Requested volume is not identified');
  else if (!expectedVolume && actualVolume) unknown.push('Candidate volume is not specified by request');

  const expectedEditions = editions(canonical.title);
  const actualEditions = editions(text);
  for (const expected of expectedEditions) {
    if (!actualEditions.includes(expected)) {
      const numberedConflict = expected.startsWith('edition-') && actualEditions.some(e => e.startsWith('edition-'));
      const abridgementConflict = ['abridged', 'unabridged'].includes(expected) && actualEditions.some(e => ['abridged', 'unabridged'].includes(e));
      if (numberedConflict || abridgementConflict) conflicts.push('Edition conflicts with request');
      else unknown.push('Requested edition is not identified');
    }
  }
  if (actualEditions.includes('dramatized') && !expectedEditions.includes('dramatized')) {
    conflicts.push('Dramatized adaptation was not requested');
  }
  if (actualEditions.includes('abridged') && !expectedEditions.includes('abridged')) {
    conflicts.push('Abridged edition was not requested');
  }
  if (actualEditions.some(e => !expectedEditions.includes(e) && e !== 'unabridged')) {
    unknown.push('Candidate edition is not specified by request');
  }

  const expectedLanguage = canonical.language?.toLowerCase() || language(canonical.title) || canonical.preferredLanguage;
  const actualLanguage = candidate.language?.toLowerCase() || language(text);
  if (expectedLanguage && actualLanguage && expectedLanguage !== actualLanguage) conflicts.push('Language conflicts with request');
  else if (!actualLanguage) unverified.push('Language is not stated');

  if (canonical.narrator?.trim()) {
    const expected = canonical.narrator.split(/,|\s+&\s+|\s+and\s+/i).map(normalize).filter(Boolean);
    const explicit = candidate.narrator || text.match(/(?:narrated\s+by|read\s+by|narrator\s*:)\s*([^\[\]()|]+?)(?=\s+-\s+|$|[\[\]()|])/i)?.[1];
    const evidence = normalize(explicit || text);
    if (!expected.every(name => evidence.includes(name))) {
      if (explicit && !expected.some(name => evidence.includes(name))) conflicts.push('Narrator conflicts with request');
      else unverified.push('Catalog narrator is not confirmed by release metadata');
    }
  }
  return {
    status: conflicts.length ? 'conflict' : unknown.length ? 'unknown' : 'compatible',
    reasons: [...conflicts, ...unknown],
    unverified,
  };
}
