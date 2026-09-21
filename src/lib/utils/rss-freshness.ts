/**
 * Component: Bounded RSS Release Evidence
 * Documentation: documentation/phase3/search-policy.md
 */

import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { TorrentResult } from './ranking-algorithm';

const PREFIX = 'rmab:rss:';
const MAX_SEEN = 2000;
const EVIDENCE_SECONDS = 3600;

export function rssReleaseKey(release: TorrentResult): string | undefined {
  const identity = release.infoHash?.toLowerCase() || release.guid;
  if (!Number.isInteger(release.indexerId) || typeof identity !== 'string' || !identity.trim()) return undefined;
  return createHash('sha256').update(`${release.indexerId}:${identity.trim()}`).digest('hex');
}

// One atomic feed observation. A missing cursor establishes a baseline, not new evidence.
const OBSERVE = `
local previous = tonumber(redis.call('GET', KEYS[2]))
local newest = previous or 0
local fresh = {}
for i = 4, #ARGV, 2 do
  local identity, published = ARGV[i], tonumber(ARGV[i + 1])
  local seen = redis.call('ZSCORE', KEYS[1], identity)
  if previous and not seen and published > previous and published <= tonumber(ARGV[1]) then
    table.insert(fresh, identity)
    redis.call('SET', ARGV[3] .. identity, '1', 'EX', 3600)
  end
  redis.call('ZADD', KEYS[1], ARGV[1], identity)
  if published <= tonumber(ARGV[1]) and published > newest then newest = published end
end
redis.call('SET', KEYS[2], newest)
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -tonumber(ARGV[2]) - 1)
return fresh
`;

export async function observeRssReleases(redis: Redis, releases: TorrentResult[]): Promise<TorrentResult[]> {
  const groups = new Map<number, TorrentResult[]>();
  for (const release of releases) {
    if (!rssReleaseKey(release)) continue;
    const group = groups.get(release.indexerId!) || [];
    group.push(release);
    groups.set(release.indexerId!, group);
  }
  const fresh = new Set<string>();
  for (const [indexerId, group] of groups) {
    const args = group.slice(0, 200).flatMap(release => {
      const date = new Date(release.publishDate).getTime();
      return [rssReleaseKey(release)!, Number.isFinite(date) ? date : 0];
    });
    const identities = await redis.eval(OBSERVE, 2, `${PREFIX}seen:${indexerId}`, `${PREFIX}cursor:${indexerId}`,
      Date.now(), MAX_SEEN, `${PREFIX}evidence:`, ...args) as string[];
    identities.forEach(identity => fresh.add(identity));
  }
  return releases.filter(release => fresh.delete(rssReleaseKey(release) || ''));
}

/** Evidence must be fresh and can wake a given request only once. */
export async function claimRssEvidence(redis: Redis, requestId: string, evidenceKey?: string): Promise<boolean> {
  if (!evidenceKey || !/^[a-f0-9]{64}$/.test(evidenceKey)) return false;
  const claimed = await redis.eval(`
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local added = redis.call('ZADD', KEYS[2], 'NX', ARGV[1], ARGV[2])
redis.call('ZREMRANGEBYRANK', KEYS[2], 0, -2001)
redis.call('EXPIRE', KEYS[2], ARGV[3])
return added
`, 2, `${PREFIX}evidence:${evidenceKey}`, `${PREFIX}request:${requestId}`, Date.now(), evidenceKey, EVIDENCE_SECONDS);
  return claimed === 1;
}
