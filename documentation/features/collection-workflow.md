# Bounded collection selection

**Status:** Implemented | Admin-only qBittorrent collection mapping

## Overview
Admins can use one qBittorrent collection as a bounded source for existing audiobook requests. Each book has an explicit file mapping and a separate import. Watched-series request creation is unchanged.

## Key details
- Preview does not add or start a torrent. It reads a bounded `.torrent` or an existing qBittorrent file list.
- Unresolved magnets are blocked. The workflow never starts a full pack to fetch metadata.
- Only configured Prowlarr download endpoints can supply remote metadata. HTTP redirects to other origins are rejected. A metadata upload is also supported.
- Admins select exact audio, cover, and EPUB/PDF companion files. No edition, narrator, language, or completeness match is inferred.
- Selection requires explicit identity confirmation. Missing audio, repeated files, duplicate books, library matches, unsafe paths, and exceeded limits block the operation.
- New torrents start stopped. All file priorities are cleared before the approved selection is applied and verified. Existing hashes are reused without changing paths, categories, seeding limits, or retained priorities.
- Unrelated incomplete selections on an existing torrent block expansion. Completed retained files remain selected. Failures after a stop leave the torrent stopped for inspection.
- File-byte limits bound selected file sizes, not tracker traffic or BitTorrent boundary-piece overhead.
- Source files remain intact. Each request uses the existing monitor and organize queues with a persisted exact manifest. Never import the collection root without that manifest.

## Interfaces
- `POST /api/admin/collections/preview`: metadata source and anchor request. Returns actual files, fingerprint, limits, and eligible requests.
- `POST /api/admin/collections/select`: source, expected hash/fingerprint, exact per-request file indexes, and identity confirmation.
- `GET/PUT /api/admin/collections/limits`: administrator-controlled size and count limits.
- Metadata sources: configured Prowlarr torrent download URL, base64 `.torrent` upload, or existing 40-character torrent hash.
- `DownloadHistory.collectionSelection`: versioned per-book manifest. `files[].path` is relative to qBittorrent `save_path`, including the torrent root folder when present. The monitor maps `save_path` to the application path and passes it as `downloadPath`, with the manifest as argument 7 of `addOrganizeJob`.
- Claims and manifests commit before client mutation. Selection and destructive cleanup share PostgreSQL advisory transaction keys `hashtext('rmab-collection')`, `hashtext(lowercaseInfoHash)`. Import retries retain the manifest. Generic cleanup must preserve collection records, tags, and source torrents.
- Ordinary downloads claim `Request.activeDownloadJobId` and clear it on handoff or terminal failure. Collection claims clear both active job owners. Monitors check the currently selected download history and a non-deleted `downloading` request.

## Configuration
| Key | Default |
| --- | --- |
| `collection_max_selected_bytes` | 10737418240 (10 GiB) |
| `collection_max_selected_files` | 200 |
| `collection_max_total_bytes` | 2199023255552 (2 TiB) |
| `collection_max_torrent_files` | 20000 |

Metadata input is capped at 4 MiB. Limits use server-read file sizes, not release advertisements or submitted totals. Configurable hard ceilings are 100 GiB and 2000 selected files, and 50000 metadata files.

## Limits
- qBittorrent 4.4 or later in the 4.x or 5.x series only. Version and stopped-state verification are required before a new add.
- Existing approved audiobook requests in `awaiting_search`, `awaiting_release`, `failed`, or `warn` only. The picker includes the anchor request and up to 199 other eligible requests. One operation maps at most 50 books. No subscriptions, requests, or standalone ebooks are created.
- The administrator must verify ambiguous edition, narrator, volume, language, and completeness evidence. The file list is not proof of audio identity.
- Repeated basenames within one book are blocked. Cover and companion files must be in the same directory as that book's selected audio.
- A failed handoff is visible on the existing request. Retry through Collection or the manifest-aware import recovery controls. Ordinary release selection and automatic search must not replace a saved selection. This version has no detach action. Never retry by scanning the entire pack.
- Focused checks exercise metadata parsing, authentication, UI file mapping, new stopped adds, existing selections, path/size limits, and the monitor handoff. Live qBittorrent downloads and library imports require separate deployment verification.

## Related
- [qBittorrent](../phase3/qbittorrent.md)
- [Download clients](../phase3/download-clients.md)
- [Manual import](manual-import.md)
- [Background jobs](../backend/services/jobs.md)
