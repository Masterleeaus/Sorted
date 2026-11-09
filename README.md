# Dovetails FSM

Dovetails FSM is a residential handyman and home maintenance operating system focused on preserving property history, managing client relationships, creating accurate estimates, executing work efficiently, and maintaining a permanent service record for every property.

## Documentation Hierarchy

Use documentation in this order:

1. Code and database migrations are the implemented truth.
2. `docs/canonical/` is the authoritative product, domain, and architecture truth.
3. `docs/contracts/` and `docs/working/` contain supporting implementation notes.
4. `ai/` is only a compact AI-agent quick-reference layer.
5. `docs/archive/` and `docs/generated/` are historical/evidence only, not active instruction sources.

## Canonical Product Docs

Product direction comes only from:

- [Product Vision](docs/canonical/PRODUCT_VISION.md)
- [Domain Model](docs/canonical/DOMAIN_MODEL.md)
- [Workflow](docs/canonical/WORKFLOW.md)
- [Architecture](docs/canonical/ARCHITECTURE.md)
- [Roadmap](docs/canonical/ROADMAP.md)

Historical plans, generated reports, archived agent docs, and working notes are supporting material only.

## Titan Go

Titan Go is the installable PWA and UI layer inside this app (Field mode). It is not a separate product. Canonical docs define scope. See [docs/working/titan-go-identity-decision-2026-11-08.md](docs/working/titan-go-identity-decision-2026-11-08.md) for the decision and the list of prototype surfaces.

## Quick Start

```bash
cp .env.example .env
pnpm install
docker compose -f infra/compose.dev.yml up -d postgres redis
pnpm db:migrate
pnpm dev:web
```

## Project Layout

- `apps/web`: Next.js web app for owner/admin/tech workflows.
- `services/worker`: background worker for queued notifications and automation support.
- `packages/domain`: shared schemas, labels, constants, and domain helpers.
- `db/migrations`: SQL schema and migration history.
- `infra`: Docker Compose profiles.
- `docs/canonical`: source-of-truth product direction.
- `docs/working`: implementation and operations support.
- `docs/archive`: historical planning material.
- `docs/generated`: generated reports, audits, and migration records.

## Quality Gate

```bash
pnpm gate
```

For faster local static/unit feedback:

```bash
pnpm gate:fast
```

## Backup safety checks

The encrypted backup and restore procedures are in [Backup Runbook](docs/BACKUP_RUNBOOK.md). For a read-only production backup health signal:

```bash
node scripts/check-backup-health.mjs /opt/business/ai-fsm/backups 26
```

A nonzero exit indicates a stale, missing or incomplete verified backup, and should trigger operator investigation. Only backup status reports attesting `sha256-readback` of every encrypted offsite artifact and its manifest are accepted; old size-only success reports require a new backup. Remote age-only deletion is disabled to preserve independently unverified historical recovery sets. The health file alone is not proof of a successful scratch restore.

## Intake media storage and lifecycle (Pass 11)

The upload route and delete route now share a private file boundary that checks existing parent-directory segments with `lstat`, refuses symlinks, creates new photo files exclusively with `0600` permissions and deletes only regular files. Invite claiming, photo counting and request updates carry explicit tenant predicates even after setting transaction-local tenant context. The browser retains photos whose server deletion fails, exposing a retry instead of pretending the photo was removed, and clears in-flight removed items on upload failures.

Run `pnpm --filter @ai-fsm/web exec vitest run __tests__/intake-photo-*.test.ts` for executable filesystem/format checks, plus `node --test scripts/tests/intake-photo-*.test.mjs` for route contracts. Database-backed tests and customer media retention/deletion policy remain required before treating issue #5 as complete.



Customer intake photos are uploaded one at a time to a private, server-managed directory. The upload route checks declared file size/type against image signatures, rejects duplicate multipart fields, enforces invite-locked photo limits, and creates files exclusively with owner-only permissions. Deletion rechecks and locks the active invite in the same transaction as row deletion, blocking post-submit races. Photos are associated to their booking request when the invite is claimed; the count is calculated from database rows rather than a browser-supplied value. The server-side storage root is not a publicly guessable URL.

The `scripts/tests/intake-photo-*.test.mjs` quality subgate guards those cross-layer contracts, but real PostgreSQL and browser integration remain mandatory before issue #5 can be closed.



Scheduled and manual encrypted backups are serialized by a kernel `flock`. An `ACTIVE` status marker blocks the health gate during an active or interrupted job. Before any production database mutation, the deployment runner also performs streaming SHA-256 checks of the local encrypted dump, uploads, environment, and manifest against the latest attested success record. This is an integrity preflight, not a decryption or PostgreSQL restore test. Never clear an interrupted marker without reviewing the previous run.



Backup creation uses private file permissions, rejects unsafe rclone remote names, and applies configurable finite timeouts to offsite copies and SHA-256 verification reads. Any misconfiguration is recorded as `INCOMPLETE`. The backup alert hook must be a single executable path, not a shell command.

A destructive PostgreSQL restore requires `FSM_RESTORE_CONFIRM_DB` equal to the target `POSTGRES_DB`. Both the destructive restore and scratch-restore drill reject unexpected uploads archive paths. The destructive path is **database-only**; it does not automatically overwrite host environment files or unpack uploads. See [Backup Runbook](docs/BACKUP_RUNBOOK.md) for required companion recovery and restore approval.

## Safe deployment and service monitoring

The sole host deployment entrypoint is `scripts/deploy-garonhome.sh`; `scripts/deploy.sh` passes a validated branch over SSH without resetting the worktree itself. The production runner refuses dirty checkouts, enforces an independently verified recent encrypted backup and bounds the PostgreSQL and web-readiness checks.

`scripts/healthcheck-garonhome.sh` also tests the verified backup status, attempts a notification on stale/incomplete backups, and returns nonzero to the scheduler for a web or backup failure. Set the maximum-age and timeout values in the host environment using `infra/garonhome.env.example`. Never treat source-level mocks as evidence of a real encrypted restore or authorized production deployment; see [deployment](DEPLOY.md) and [backup operations](docs/BACKUP_RUNBOOK.md).

## Production Target

Production runs on garonhome.local using `infra/compose.garonhome.yml` and deploy root `/opt/business/ai-fsm`. The runbook is [DEPLOY.md](DEPLOY.md). Do not deploy to `/home/admin/apps/ai-fsm`; that path is legacy.
