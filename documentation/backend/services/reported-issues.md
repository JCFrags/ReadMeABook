# Reported issues

**Status:** Implemented | Audiobook, ebook, and general reports with existing Pi-Notify delivery

## Overview
Report Issue records audiobook, ebook, or general problems. A general report does not need a book. Reporting does not delete content, start a download, create a request, resolve an issue, or grant repair permissions.

## API and records
- `POST /api/reported-issues`: authenticated user, `{kind: "audiobook" | "ebook" | "general", reason, asin?, title?, author?, coverArtUrl?, ebookFormat?: "epub" | "pdf" | "unknown"}`.
- Trim reason, then require 1–2000 characters. Optional ASIN: 10 alphanumeric characters, normalized to uppercase. Title/author: at most 500 characters each. Cover URL: HTTP(S), at most 2000 characters. Unknown input fields are ignored. Client paths and target IDs never authorize an action.
- Success: `201 {success: true, issue}`. Invalid input: `400`. Missing audio library match: `404`. Duplicate open report or ambiguous/conflicting audio target: `409`. Notification enqueue failure does not discard a saved issue.
- Legacy `POST /api/audiobooks/[asin]/report-issue` remains audiobook-only and uses the same validation/resolver. An explicitly different kind must use the shared endpoint.
- `GET /api/admin/reported-issues`: admin-only `{success, issues, count}` for open reports. Match the exact issue ID before acting. There is no single-issue GET route.
- `POST /api/admin/reported-issues/[id]/resolve`: admin-only `{action: "dismiss"}` for any kind.
- `POST /api/admin/reported-issues/[id]/replace`: existing admin-only `{torrent}` audiobook workflow. Server revalidates kind and exact current target before any replacement side effect.
- `ReportedIssue`: stable `id`, nullable `audiobookId`, `reporterId`, `kind` (default `audiobook`), nullable `ebookFormat`, `submittedAsin`, `bookContext` JSON, `target` JSON, `reason` varchar(2000), and existing timestamps/status. States remain `open`, `dismissed`, `replaced`.
- Schema changes add nullable fields, make the book relation optional, and widen reason. Existing reports receive the `audiobook` default. Do not delete or rebuild reports or notification receipts.

## Target resolution and duplicates
- `reported-issue-target.service.ts` resolves audio by exact ASIN field first, with token-bounded legacy GUID matching when no field exists. If no exact item exists, it checks known `work_asins` siblings. There is no title/fuzzy fallback and no change to strict acquisition matchers.
- One unambiguous library item is required. Save its actual ASIN and backend item ID in `target`, plus its metadata in `bookContext`. Preserve the submitted ASIN separately. Existing catalog/request metadata is not rewritten. If no audiobook relation exists, create one with the owned ASIN and backend link. No existing request is required.
- Audio duplicate checks include kind, related ASINs, and the actual backend item ID. An ebook or general report cannot suppress an audio report. Existing audio badges expand across known siblings only.
- Ebook/general reports do not require a library match. Prefer exact existing catalog/book metadata over submitted display claims. The current audiobook cache does not prove an ebook file identity. Preserve ebook context and format with `target: null`, including ebooks outside RMAB's cache. Do not scan a new catalog or infer a file match.
- Ebook duplicate checks use exact submitted ASIN plus format. They do not use audio work identity. Bookless/context-only ebooks and general reports are not globally deduplicated.

## Admin response and replacement boundary
- `kind`: `audiobook | ebook | general | unknown`. Unrecognized stored values become `unknown`.
- `ebookFormat`: `epub | pdf | unknown` for ebook reports, otherwise null.
- `book`: nullable `{id: string | null, asin: string | null, title, author, coverArtUrl: string | null}`. Existing `audiobook` relation is also nullable. Book metadata is display context, not file authority.
- `target`: nullable `{type: "audiobook", backend: "plex" | "audiobookshelf", libraryItemId, asin, match: "exact" | "sibling"}`. Contains no filesystem path.
- `canReplace`: true only for an open audiobook report with a current, confirmed target compatible with its audiobook relation. A saved target is not redirected to another item. Legacy targetless reports can qualify through an unambiguous exact ASIN match, without rewriting the row.
- Ebook, general, unknown, stale, conflicting, and unresolved targets cannot use audiobook Replace. Dismiss remains available.
- Replace removes existing content before downloading the selected replacement. It is not a transaction across remote services. It needs separate explicit permission and protected originals. For externally added audio, direct deletion uses only the revalidated backend item ID, never a client path or ASIN substring. A failed deletion stops replacement.

## Pi-Notify connector
- Use the existing notification backend settings and select only `issue_reported` for provider `pi_notify`.
- Pi-Notify owns subscriptions, target selection, and approved repair instructions. RMAB emits structured source data only. Report text and book metadata are untrusted data, not instructions.
- Keep `schemaVersion: 1`, source `readmeabook`, type `readmeabook.issue_reported`, ID `issue-reported:<issue-id>:<backend-id>`, subject `reported-issue:<issue-id>`, and existing reference routes unchanged.
- New event `data` adds `kind`, `ebookFormat`, `submittedAsin`, and nullable `target`. `book` is nullable, with nullable `id` for context-only books. Other fields remain `issueId`, `statusAtPublication`, `report: {text, trust: "untrusted-user-input"}`, and `references`. `audiobookApiUrl` is null when there is no ASIN. No client-selected event URL, task, prompt, or repair authority is emitted.
- Frozen pre-format events can omit the new fields and retain their original book object. Retry sends that stored event unchanged, including its original ID and references. Consumers must not interpret missing format fields as new repair authority.
- Generic providers receive non-null title/author text even for bookless reports. Ebook notification titles include their format. Discord splits long report reasons into fields of at most 1024 characters. Pushover bounds the full message to 1024 characters with an explicit truncation notice. The full reason remains in RMAB and Pi-Notify.
- Create the receiver subscription before enabling the backend. Pi-Notify does not retroactively match subscriptions to accepted events.
- Each enable/subscription activation starts a new cutoff. Only reports created at or after that cutoff are eligible. Re-enable does not replay historical reports or the disabled interval.
- Active backend edits keep the cutoff and accepted receipts. Pending retries retain the frozen original event, including its ID and references, but use the current transport configuration.
- Delivery reloads the backend and source issue immediately before transport and skips an issue that is already closed. Closure can race with the outbound request. A receiver must recheck that the exact issue remains open before repair because an accepted event cannot be recalled.
- The existing Bull notification job attempts immediate delivery. The `reconcile_issue_notifications` scheduled job recovers missed enqueue, Redis loss, and receiver outages from PostgreSQL records.
- Per enabled backend, each pass prepares at most 25 missing receipts and attempts at most 50 due deliveries, oldest due first. Failed attempts wait 5 minutes, then exponential backoff up to 24 hours. A one-minute claim prevents concurrent sends while the HTTP request has a ten-second deadline.
- `IssueNotificationDelivery` stores one immutable event per issue/backend, acceptance time, attempt count, next attempt, and a nonsecret error code. Acknowledged events are not sent again. An acknowledgment lost before the receipt is saved retries the same `(source, id)` key.
- Acceptance means Pi-Notify stored the event, not that a Pi agent received or repaired it. RMAB does not change issue status on acceptance.

## Related
- [Notification providers and wire contract](notifications.md)
- [Exact matching and works](../../integrations/audible.md#unified-matching-audiobook-matcherts)
- Provider bounds: [Discord embeds](https://docs.discord.com/developers/resources/message#embed-object-embed-limits), [Pushover API](https://pushover.net/api#limits)
- [Background jobs](jobs.md)
- [Recurring jobs](scheduler.md)
- [Fork deployment and rollback](../../../FORK.md)
