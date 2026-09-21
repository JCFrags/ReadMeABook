# E-book Support

**Status:** ✅ Implemented | First-class ebook requests with multi-source support (Anna's Archive + Indexer Search)

## Overview
Ebooks are first-class citizens in RMAB, with their own request type, tracking, and UI representation. When an audiobook request completes, an ebook request is automatically created (if a source is enabled). Supports multiple sources: Anna's Archive (direct HTTP) and Indexer Search (via Prowlarr with ebook categories).

## Bundled ebooks (no additional acquisition)

Bundled preservation is separate from first-class ebook requests and their acquisition switches. It inspects files already present in the completed audiobook download. It does not enable Anna's Archive, indexer search, auto-grab, or Find Missing Ebooks.

| Key | Default | Purpose |
|-----|---------|---------|
| `bundled_ebook_import_enabled` | `false` | Copy validated bundled EPUB/PDF. Environment fallback: `BUNDLED_EBOOK_IMPORT_ENABLED`. |
| `ebook_media_dir` | empty | Independent destination root. Environment fallback: `EBOOK_MEDIA_DIR`. Mount it before enabling. |

- Independent layout: `{root}/{author}/{title}/{title}.epub` and `.pdf`, using existing sanitized metadata helpers. Keep both valid formats in one item folder.
- Without an independent root, an enabled successful audio import can preserve companions in its audio folder. Ebook-only downloads retain their sources and warn that a root is needed.
- Database configuration takes priority over environment values. These keys do not change the destination of separately acquired first-class ebook requests.
- Make independent copies. Compare SHA-256 before reusing an existing destination. Different content is a visible conflict, not an overwrite or a successful reuse.
- Preserve every source. The organize processor suppresses source/Usenet cleanup when bundled ebooks are present, including rejected or ambiguous artifacts. Existing seeding cleanup policy remains separate.
- Library watchers can index the independent root. The audio library scan setting does not scan a separate ebook library automatically.
- Validation results and warnings appear in job results/events. A warning does not fail a successful audio import or create an ebook request.
- Bundled ebook copies never change the shared audiobook row's path, format, completion state, or availability linkage. Only the audio import fulfills the audio request.
- Legacy first-class ebook requests still share the audiobook row's path/format state. Separate ebook templates can affect serving/deletion path resolution. Bundled preservation does not use or enable that acquisition pipeline. Keep its acquisition sources disabled when another application owns independent ebooks.

### Bounded validation

- Outcomes: `validated`, `unverified`, `rejected`. Only `validated` copies enter the watched library. Other artifacts remain at source with a manual-review warning.
- EPUB: ZIP signature, mimetype, archive CRCs, container/OPF XML, title and author, explicit requested edition, nonempty reading order, and all spine resources. Inspect up to six opening spine documents for explicit sample/MEAP/early-access markers. Do not extract archive paths or execute scripts. Encrypted/scripted resources require manual validation.
- EPUB bounds: 256 MiB archive, 512 MiB expanded, 10,000 entries, 32 MiB per entry, 2 MiB per text document. Oversize material is not silently approved.
- PDF: signature and end marker. Use optional Poppler `pdfinfo` and `pdftotext` for page count, encryption, opening-page identity/edition, and final-page readability. Each command has a 15-second timeout and 1 MiB output bound. Missing tools, unreadable text, encryption, or inconclusive identity leave the PDF unverified.
- Reject explicit wrong-title/author/edition EPUBs and obvious samples, MEAPs, or incomplete editions. Reject explicit `dc:language` conflicts against the configured Audible region language (`audible.region`, default `us`, mapped by `getLanguageForRegion`). Normalize common BCP 47 tags and ISO language aliases, including regional variants. This is a configured constraint, not an inferred per-book language. Keep ambiguous PDF identity unverified, because conversion metadata alone is not reliable.
- Missing or inconclusive EPUB language does not cause rejection. Validation results state that language is not verified. PDF language is not verified by these bounded text checks. Matching metadata does not prove the language of the complete text.
- These checks establish bounded structural/identity evidence, not whole-text completeness, a full EPUB standards audit, or browser rendering.
- A confirmed EPUB/PDF-only download cannot fulfill an audiobook request. The processor preserves it, blocks that release for the request, and returns the audio request to cooled search without repeated import attempts. Unknown archives or unreadable inventories do not justify that permanent-format classification.

## Key Details

### First-Class Ebook Requests
- **Request Type:** `type: 'ebook'` (vs `'audiobook'`)
- **Parent Relationship:** Ebook requests are children of audiobook requests (`parentRequestId`)
- **Terminal State:** `downloaded` (ebooks don't have "available" state like audiobooks)
- **UI Badge:** Orange (#f16f19) ebook badge to distinguish from audiobooks
- **Separate Tracking:** Own progress, status, and error handling

### Source Priority
1. **Anna's Archive** (if enabled) - Direct HTTP downloads
   - Searched first via ASIN, then title + author
   - Uses FlareSolverr if configured (Cloudflare bypass)
2. **Indexer Search** (if enabled, and no Anna's Archive result)
   - Searches Prowlarr with ebook categories (default: 7020)
   - Ranks using unified ranking algorithm with ebook-specific scoring
   - Downloads via qBittorrent (torrents) or SABnzbd (Usenet)
3. **Both disabled** → Ebook downloads disabled entirely

### Flow (Anna's Archive)
1. Audiobook organization completes
2. Ebook request created automatically (if source enabled)
3. `search_ebook` job searches Anna's Archive
4. `start_direct_download` downloads via HTTP
5. `organize_files` copies to audiobook folder
6. Request marked as `downloaded` (terminal)
7. "Available" notification sent

### Flow (Indexer Search)
1. Audiobook organization completes
2. Ebook request created automatically (if source enabled)
3. `search_ebook` job searches indexers (if Anna's Archive failed/disabled)
4. `download_torrent` job adds to qBittorrent/SABnzbd (reuses audiobook processor)
5. `monitor_download` tracks progress
6. `organize_files` copies to audiobook folder
7. Request marked as `downloaded` (terminal)
8. Torrent left to seed (respects seeding limits)

### Configuration

**Admin Settings → E-book Sidecar tab** (3 sections)

#### Section 1: Anna's Archive
| Key | Default | Description |
|-----|---------|-------------|
| `ebook_annas_archive_enabled` | `false` | Enable Anna's Archive downloads |
| `ebook_sidecar_base_url` | `https://annas-archive.gl` | Base URL for mirror |
| `ebook_sidecar_flaresolverr_url` | `` (empty) | FlareSolverr proxy URL (optional) |

#### Section 2: Indexer Search
| Key | Default | Description |
|-----|---------|-------------|
| `ebook_indexer_search_enabled` | `false` | Enable Indexer Search via Prowlarr |

*Note: Ebook categories are configured per-indexer in Settings → Indexers → Edit Indexer → EBook tab*

#### Section 3: General Settings
| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `ebook_sidecar_preferred_format` | `epub` | `epub, pdf, mobi, azw3, any` | Preferred format |
| `ebook_auto_grab_enabled` | `true` | `true, false` | Auto-create ebook requests after audiobook downloads |
| `ebook_kindle_fix_enabled` | `false` | `true, false` | Apply Kindle compatibility fixes to EPUB files |

*Notes:*
- *Auto-grab is automatically disabled if no ebook sources are enabled. Manual fetch via admin buttons still works.*
- *Kindle fix toggle only visible when preferred format is EPUB.*

### Safety-Net: Find Missing Ebooks Job

A scheduled `find_missing_ebooks` job (daily midnight, enabled by default) backstops the auto-grab path for cases where it silently misses books (race conditions, transient indexer failures, requests created before sources were configured, books from Goodreads/Hardcover sync). Per run it scans up to 50 audiobook requests in `downloaded`/`available` status and triggers the existing ebook fetch flow for any audiobook missing a successful ebook companion. **Lifetime auto-retry cap: 5 per audiobook** — after 5 failed auto-attempts the job stops retrying that audiobook (admin Manual "Fetch Ebook" remains available). Counter is tracked in `Request.ebookAutoRetryCount` and is **processor-private**: manual Fetch Ebook routes never read, write, or reset it. Gated by `ebook_auto_grab_enabled` AND at least one source enabled; logs no-op runs honestly. See `documentation/backend/services/scheduler.md` for full details.

### Kindle EPUB Fix

**Purpose:** Apply compatibility fixes to EPUB files before organizing, ensuring successful Kindle import.

**Fixes Applied:**
1. **Encoding declaration** - Adds UTF-8 XML declaration to files missing it
2. **Body ID link fix** - Removes `#body`/`#bodymatter` fragments from hyperlinks that break on Kindle
3. **Language validation** - Ensures `dc:language` uses Amazon KDP-approved codes (defaults to `en` if invalid)
4. **Stray IMG removal** - Removes `<img>` tags without `src` attributes

**How It Works:**
- Enabled via toggle in E-book Sidecar settings (only visible when EPUB format selected)
- Applied during `organize_files` job, before copying to final location
- Creates temp fixed file → organizes temp file → cleans up temp file
- Original download file stays intact (important for seeding torrents)
- Non-blocking: if fix fails, continues with original file

**Source:** Based on [kindle-epub-fix](https://github.com/innocenat/kindle-epub-fix)

## Database Schema

**Request model additions:**
```prisma
type             String    @default("audiobook") // 'audiobook' | 'ebook'
parentRequestId  String?   @map("parent_request_id")
parentRequest    Request?  @relation("EbookParent", fields: [parentRequestId], references: [id])
childRequests    Request[] @relation("EbookParent")
```

**Indexes:** `type`, `parentRequestId`

## Job Processors

### search_ebook
- Searches Anna's Archive first (if enabled), then indexers (if enabled)
- Anna's Archive: Creates download history with `downloadClient: 'direct'`, triggers `start_direct_download`
- Indexer: Triggers `download_torrent` job (reuses audiobook processor)

### start_direct_download
- Downloads file via HTTP with progress tracking
- Tries multiple slow download links on failure
- Triggers `organize_files` on success

### download_torrent (shared with audiobooks)
- Routes to qBittorrent (torrents) or SABnzbd (Usenet)
- Creates download history with indexer metadata
- Triggers `monitor_download` job

## Ranking Algorithm (Indexer Results)

Ebook torrent ranking uses unified algorithm with ebook-specific scoring:

| Component | Points | Description |
|-----------|--------|-------------|
| **Title/Author Match** | 60 pts | Reuses audiobook matching logic (word coverage, author presence) |
| **Format Match** | 10 pts | 10 pts if matches preferred format, 0 otherwise |
| **Size Quality** | 15 pts | Inverted: < 5MB = 15pts, 5-15MB = 10pts, 15-20MB = 5pts |
| **Seeder Count** | 15 pts | Logarithmic scaling (same as audiobooks) |

**Filtering:**
- Files > 20 MB are filtered out (too large for ebooks)
- Dual threshold: base score >= 50 AND final score >= 50

**Bonus System:** Same as audiobooks (indexer priority, flag bonuses)

## Delete Behavior

**Ebook deletion is different from audiobook deletion:**
- Only deletes ebook files (`.epub`, `.pdf`, `.mobi`, etc.)
- Does NOT delete the title folder (audiobook files remain)
- Does NOT delete from backend library (Plex/ABS)
- Does NOT clear audiobook availability linkage
- Soft-deletes the ebook request record
- Torrents left to seed (respects seeding limits)

## UI Representation

### RequestCard
- Orange ebook badge displayed next to status badge
- Orange book icon for placeholder cover art
- Interactive search disabled (Anna's Archive only)

### Status Flow
```
pending → searching → downloading → processing → downloaded (terminal)
                 ↘ awaiting_search (retry) ↗
```

## FlareSolverr Integration

Anna's Archive uses Cloudflare protection. FlareSolverr bypasses this using a headless browser.

### Setup
```bash
docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
```

Configure URL in Admin Settings → E-book Sidecar: `http://localhost:8191`

### Performance
- First request: ~5-10 seconds
- Subsequent: ~2-5 seconds per page
- Total: ~15-30 seconds per ebook

## Scraping Strategy (Anna's Archive)

### Method 1: ASIN Search (exact match)
```
Search: https://annas-archive.gl/search?ext=epub&lang=en&q="asin:B09TWSRMCB"
  ↓
MD5 Page: https://annas-archive.gl/md5/[md5]
  ↓
Slow Download: https://annas-archive.gl/slow_download/[md5]/0/5
  ↓
File Server: http://[server]/path/to/file.epub
```

### Method 2: Title + Author (fallback)
```
Search: https://annas-archive.gl/search?q=Title+Author&ext=epub&lang=en
  ↓ (Same flow from MD5 page)
```

## File Naming

**Pattern:** `[Title] - [Author].[format]`

**Sanitization:**
- Remove: `<>:"/\|?*`
- Collapse spaces, trim, limit to 200 chars

## Error Handling

**Non-blocking errors:**
- No search results → Request goes to `awaiting_search` for retry
- All downloads fail → Same retry behavior
- Audiobook organization never affected

## Technical Files

**Processors:**
- `src/lib/processors/search-ebook.processor.ts` - Multi-source search
- `src/lib/processors/direct-download.processor.ts` - Anna's Archive downloads
- `src/lib/processors/download-torrent.processor.ts` - Indexer downloads (shared)
- `src/lib/processors/organize-files.processor.ts` (ebook branch)

**Services:**
- `src/lib/services/ebook-scraper.ts` - Anna's Archive scraping
- `src/lib/services/job-queue.service.ts` (ebook job types)

**Utils:**
- `src/lib/utils/file-organizer.ts` (`organizeEbook` method)
- `src/lib/utils/ranking-algorithm.ts` (`rankEbookTorrents` function)
- `src/lib/utils/indexer-grouping.ts` (supports `'ebook'` type)
- `src/lib/utils/epub-fixer.ts` (Kindle EPUB compatibility fixes)
- `src/lib/utils/bundled-ebooks.ts` (existing-download inventory and preservation)
- `src/lib/utils/ebook-validation.ts` (bounded EPUB/PDF checks)
- `src/lib/utils/import-safety.ts` (contained, verified, no-overwrite copies)
- `src/lib/utils/import-format-failure.ts` (per-request block and cooled audio-search transition)

**UI:**
- `src/components/requests/RequestCard.tsx` (ebook badge)

**Delete:**
- `src/lib/services/request-delete.service.ts` (ebook-specific logic)

## Format Support

| Format | Extension | Recommended |
|--------|-----------|-------------|
| EPUB | `.epub` | Yes |
| PDF | `.pdf` | Sometimes |
| MOBI | `.mobi` | Legacy |
| AZW3 | `.azw3` | Sometimes |

## Indexer Categories

Indexer configuration supports separate category arrays for audiobooks and ebooks:
- **Audiobook Categories:** Default `[3030]` (Audio/Audiobook)
- **Ebook Categories:** Default `[7020]` (Books/EBook)

Categories are configured per-indexer via the tabbed interface in the Edit Indexer modal.

## Limitations

1. Title search may return wrong book for common titles
2. Download speed depends on file server load (Anna's Archive)
3. English books only (title search filter for Anna's Archive)
4. Format detection from torrent titles may be imprecise

## Related
- [File Organization](../phase3/file-organization.md) - Ebook organization
- [Settings Pages](../settings-pages.md) - Configuration UI
- [Ranking Algorithm](../phase3/ranking-algorithm.md) - Ebook ranking
- [Request Deletion](../admin-features/request-deletion.md) - Delete behavior
- [Prowlarr Integration](../phase3/prowlarr.md) - Indexer search
