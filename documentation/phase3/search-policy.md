# Automatic search policy

**Status:** Implemented

## Request eligibility
- `nextSearchAt` is the earliest scheduled retry time. Null permits an initial search.
- `consecutiveNoMatch` counts completed discovery passes with no acceptable candidate. Delays are 1, 3, 7, then 14 days. Later misses retain the 14-day delay.
- `lastSearchOutcome`: `no_results`, `all_rejected`, `wrong_format`, `provider_error`, or `matched`. Provider errors do not increment the no-match count. Import can use `noMatchPolicy(currentCount, 'wrong_format')` for one cooled transition without enqueue.
- Provider errors retry after one hour by default. HTTP `Retry-After` supports seconds or an HTTP date, bounded to one minute through 24 hours. A partial provider failure cannot confirm a no-match.
- Manual retry and saved search-term changes reset eligibility. A new RSS candidate can wake a cooling request once, except during a provider-error delay.
- A selected `DownloadHistory.collectionSelection` blocks ordinary search/reset routes with HTTP 409 `CollectionRecoveryRequired`. Enqueue and processor start also refuse it. Use collection selection or import recovery without replacing the manifest.
- The retry processor filters eligibility before its 50-request cap and retains never-searched/oldest-search ordering. The release-date gate and per-request blocklist remain in effect.

## Queue contract
- `addSearchJob(requestId, audiobook, options?)` and `addSearchEbookJob(requestId, audiobook, preferredFormat?, options?)` use the existing Bull queue.
- `options.trigger`: `initial` (default), `manual`, `retry`, or `rss`. RSS also requires `evidenceKey` from `observeRssReleases`.
- Return: database job ID, an existing live job ID for a duplicate, or an empty string when automatic search is not eligible.
- Deterministic Bull request/type IDs provide atomic queue uniqueness. A short Redis enqueue lock coordinates database history and eligibility. Historical database rows without a live Bull job do not block searches.
- `resetSearchPolicy()` in `src/lib/utils/search-policy.ts` returns update data for an explicit reset and clears `activeSearchJobId`. Import retries do not reset discovery policy.
- `activeSearchJobId` permits the same Bull job to resume after a stall and prevents a stale search from finishing another job's claim. `activeDownloadJobId` protects pre-history download failure events. Neither claim proves content identity.

## Discovery and identity
- Discovery uses at most four distinct queries: custom or canonical title with author, title alone, normalized title, then series with volume and author when available.
- Custom terms affect discovery only. Automatic ranking uses the canonical title and author. Existing score thresholds remain unchanged.
- `assessAudioIdentity` checks format, edition, volume, language, narrator, and collection evidence before automatic ranking. Explicit conflicts are rejected. Missing format or a requested edition/volume remains unknown and requires Interactive Search. Collections require deliberate file selection.
- Catalog narrator metadata alone is not a mandatory user preference. An absent candidate narrator or language stays in `unverified` evidence and does not itself veto selection. An explicit narrator conflict with the catalog or language conflict with the title/configured language preference blocks automatic choice.
- These checks use conservative release-name patterns, not audio content. A compatible result has no known conflict and meets known title constraints. It is not a verified edition. Unlabeled editions and languages cannot be proven from a title. Import validation remains necessary.
- Ebook Prowlarr ranking also keeps the canonical title. Anna's Archive uses canonical ASIN/title lookup. Its three scraper lookup functions accept an optional final `throwOnError` flag. Search jobs enable it to preserve HTTP failures and avoid negative-cache reuse. Other callers retain their existing behavior.
- Interactive Search and deliberate manual release selection retain their existing behavior.

## RSS freshness
- RSS reads the configured relevant category groups per indexer, not a global audiobook category.
- Redis stores at most 2,000 hashed release identities per indexer and a publication high-water mark. GUID/hash values and provider URLs are not stored in logs by this mechanism.
- The first feed read establishes a baseline. Only unseen entries published after the previous high-water mark can wake a request early. Missing or invalid publication dates do not prove freshness. Out-of-order old releases remain discoverable through scheduled searches.
- Fresh evidence expires after one hour. Per-request consumed evidence is bounded and cannot be used repeatedly to bypass cooldown.
- Loss of Redis state establishes a new baseline, rather than treating the whole feed as new.

## Isolated queue verification
- Use a disposable Redis instance, not application Redis, for concurrency and RSS cursor checks. Disable TCP, snapshots, and append-only persistence when using a private Unix socket.
- For a rootless official Redis container with a user-owned private socket directory, use `--user 0:0 --entrypoint redis-server`. The default image entrypoint drops privileges to the Redis user even with `--user 0:0`, which can make that directory unwritable. Do not apply this test-only setup to a deployed service.

## Related
- [Jobs](../backend/services/jobs.md)
- [Scheduler](../backend/services/scheduler.md)
- [Database](../backend/database.md)
- [Prowlarr](prowlarr.md)
