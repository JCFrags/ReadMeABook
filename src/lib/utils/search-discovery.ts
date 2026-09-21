/**
 * Component: Bounded Search Discovery
 * Documentation: documentation/phase3/search-policy.md
 */

export interface DiscoveryMetadata {
  customSearchTerms?: string | null;
  series?: string | null;
  seriesPart?: string | null;
}

export function normalizeDiscoveryText(text: string): string {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Discovery broadens recall only. Do not pass these terms to identity checks. */
export function buildDiscoveryQueries(title: string, author: string, metadata: DiscoveryMetadata = {}): string[] {
  const discoveryTitle = metadata.customSearchTerms?.trim() || title;
  const normalized = normalizeDiscoveryText(title);
  const queries = [
    `${discoveryTitle} ${author}`,
    discoveryTitle,
    normalized,
    metadata.series
      ? `${normalizeDiscoveryText(metadata.series)} ${metadata.seriesPart || ''} ${normalizeDiscoveryText(author)}`
      : `${normalizeDiscoveryText(title.split(/[:(\[]/, 1)[0])} ${normalizeDiscoveryText(author)}`,
  ];
  const seen = new Set<string>();
  return queries.map(query => query.trim().replace(/\s+/g, ' ').slice(0, 240))
    .filter(query => {
      const key = query.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 4);
}
