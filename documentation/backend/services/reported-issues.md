# Reported audiobook issues

**Status:** Implemented | Local reports and opt-in structured Pi-Notify delivery

## Overview
Report Issue records a problem with an available audiobook. Reporting does not delete content, start a download, resolve an issue, or grant repair permissions.

## API and records
- `POST /api/audiobooks/[asin]/report-issue`: authenticated user, `{reason, title?, author?, coverArtUrl?}`. Reason: 1–250 characters. Returns the saved issue even if notification enqueue fails.
- One open issue per audiobook is checked before creation. Duplicate open reports return `409`.
- `GET /api/admin/reported-issues`: admin-only list of current open issues. Match the exact issue ID before acting. There is no single-issue GET route.
- `POST /api/admin/reported-issues/[id]/resolve`: admin-only dismiss or replace workflow.
- `ReportedIssue`: stable `id`, `audiobookId`, `reporterId`, `reason`, `status`, creation/update/resolution timestamps. States: `open`, `dismissed`, `replaced`.
- `/admin` displays open reports. Dismiss closes a report. Replace removes existing content before downloading the selected replacement. Replacement needs separate explicit permission and protected originals.

## Pi-Notify connector
- Use the existing notification backend settings and select only `issue_reported` for provider `pi_notify`.
- Pi-Notify owns subscriptions, target selection, and approved repair instructions. RMAB emits structured source data only. Report text and book metadata are untrusted data, not instructions.
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
- [Background jobs](jobs.md)
- [Recurring jobs](scheduler.md)
- [Fork deployment and rollback](../../../FORK.md)
