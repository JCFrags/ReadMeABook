# JCFrags fork

Modified by JCFrags beginning September 21, 2026. Based on upstream ReadMeABook v1.2.3, commit `f460f17ed861d59368b2b90efe0e167f382a5e97`.

This is not an official upstream release. The original [AGPL-3.0 license](LICENSE) and upstream notices remain unchanged. [Corresponding source](https://github.com/JCFrags/ReadMeABook) includes the build and startup files. The application version badge links to the source commit of the running build.

## Scope

- Separate bounded discovery queries from the requested book's matching identity.
- Group catalog search by exact series ID, retain standalone books, and show matching-volume navigation with the existing Watch confirmation. Existing watch and download policies remain unchanged.
- Delay confirmed no-match searches for 1, 3, 7, then 14 days. Keep provider failures distinct and prevent duplicate pending or active searches.
- Use configured RSS categories and bounded release-identity tracking.
- Preserve validated, already-downloaded EPUB/PDF files without enabling another acquisition source.
- Return confirmed ebook-only audio downloads to a delayed search state after blocking the bad release. Preserve their source files.
- Select explicit files from a collection, track one request per book, and preserve collection sources for later volumes.
- Accept format-specific audiobook and ebook reports plus general reports without a book. Resolve known audiobook catalog aliases to the owned copy, and keep ebook or unresolved targets out of audiobook replacement.
- Publish opt-in structured Report Issue events to Pi-Notify through an authenticated provider, durable receipts, and bounded Bull reconciliation. The receiver subscription owns the repair target and approved instructions. Reporting and event acceptance do not authorize deletion or replacement. See [reported issues](documentation/backend/services/reported-issues.md).

Matching metadata is not proof of a complete or correct edition. Unknown or conflicting identity can require manual review. Existing watched-series controls can request missing back-catalog books immediately. A watch is not a next-volume-only policy.

## Bundled ebook deployment

Bundled preservation is opt-in. Mount an independent ebook root and set:

```yaml
services:
  readmeabook:
    stop_grace_period: 120s
    environment:
      BUNDLED_EBOOK_IMPORT_ENABLED: "true"
      EBOOK_MEDIA_DIR: /ebooks
    volumes:
      - ./ebooks:/ebooks
```

This is an override fragment, not a complete deployment. Keep the existing application, database, Redis, audio and download mounts. The database settings `bundled_ebook_import_enabled` and `ebook_media_dir` take precedence over these environment fallbacks. The ebook path applies to bundled preservation, not the legacy first-class ebook acquisition flow.

The unified image includes Poppler's `pdfinfo` and `pdftotext` for bounded PDF checks. Ambiguous, incomplete or rejected files remain at their source with a warning. A preserved ebook does not fulfill an audiobook request.

## Build and activation

1. Run `npm ci` and the full `npm test` suite.
2. Build `dockerfile.unified` from the accepted source. The explicit local Compose file has a build section. The production Compose file only names an image.
3. Supply `APP_VERSION`, `GIT_COMMIT` and `BUILD_DATE` build arguments. Keep the source link tied to the deployed commit.
4. Deploy a reviewed tag or digest from `ghcr.io/jcfrags/readmeabook`. Do not silently replace this fork with the upstream image.
5. Verify the version endpoint, application health, request states and the changed behavior after activation.

Pull requests run the existing full test workflow and an amd64 unified-image build without publication. A version tag or manual workflow run can publish the image. The Dockerfile currently installs an amd64 ffmpeg binary. This fork does not advertise an arm64 image.

## Database and rollback

Back up the database, configuration and queued state before an image change. The unified startup uses `prisma db push` without `--accept-data-loss`. A failed schema sync stops startup instead of launching an incompatible application. Do not add a destructive flag merely to make startup pass.

The pipeline fields are additive. Before activation, compare the live schema with the proposed schema and review the generated changes. Allow enough stop time for PostgreSQL and Redis, and verify a clean shutdown before taking a cold snapshot.

Supervisor stops the application process group, including the Node child of its startup wrapper. PostgreSQL receives `SIGINT` for fast shutdown and has 60 seconds to finish. Keep the container stop timeout at least 120 seconds. A successful service-stop result alone is not proof of a clean database shutdown. Check the shutdown log and `pg_controldata` state before accepting a cold backup.

Upstream v1.2.3 runs schema sync with automatic data-loss approval on every start. Do not start that older image against the fork database as an unreviewed rollback. It can remove the new policy and collection fields. Preserve the latest state and restore a matching protected snapshot through a reviewed recovery procedure. Keep source media and collection manifests recoverable.

Collection cleanup and request deletion retain mapped or tagged collection torrents. These operations share the collection setup transaction lock and recheck the persisted mapping before any source deletion. Removing a collection source remains a separate explicit download-client action.
