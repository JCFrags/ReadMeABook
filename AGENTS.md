# ReadMeABook agent instructions

Follow the project standards in `CLAUDE.md`. This is the JCFrags fork of ReadMeABook. See `FORK.md` for scope and deployment requirements.

## Source and delivery

- Keep changes on a focused branch. Use separate worktrees for non-overlapping agent assignments.
- Do not change another worktree's files or assume it shares development data.
- Preserve the AGPL license and upstream notices. Keep the running application's fork-source link accurate.
- Screen outgoing files, diffs, commit metadata and reports for credentials, personal information and private local paths.
- Use `JCFrags` for the fork owner's public identity. Do not copy workstation account names or private deployment details into this repository.
- Run the full existing `npm test` suite and build the unified image from the changed source before delivery.
- Use the normal pull-request checks and merge process. Deploy an exact accepted commit or image digest, not uncommitted container edits.

## Local container build

The tracked production Compose file references a prebuilt image. It does not build local source. Use the explicit development file:

```sh
docker compose -f docker-compose.local.yml build readmeabook
```

Podman users can build the same source with `podman build -f dockerfile.unified .`.

Before starting a development container, inspect the Compose file's ports, container name and bind mounts. Use task-owned data and ports. Never replace a running container or attach production databases to a development instance without approval.

Keep machine-specific Compose overrides outside version control. Never print their full contents or commit their credentials. Do not run a plain production `docker compose build` and report it as source-build verification.
