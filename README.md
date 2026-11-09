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

## Recovery safety boundaries

Backup creation uses private file permissions, rejects unsafe rclone remote names, and applies configurable finite timeouts to offsite copies and SHA-256 verification reads. Any misconfiguration is recorded as `INCOMPLETE`. The backup alert hook must be a single executable path, not a shell command.

A destructive PostgreSQL restore requires `FSM_RESTORE_CONFIRM_DB` equal to the target `POSTGRES_DB`. Both the destructive restore and scratch-restore drill reject unexpected uploads archive paths. The destructive path is **database-only**; it does not automatically overwrite host environment files or unpack uploads. See [Backup Runbook](docs/BACKUP_RUNBOOK.md) for required companion recovery and restore approval.

## Safe deployment and service monitoring

The sole host deployment entrypoint is `scripts/deploy-garonhome.sh`; `scripts/deploy.sh` passes a validated branch over SSH without resetting the worktree itself. The production runner refuses dirty checkouts, enforces an independently verified recent encrypted backup and bounds the PostgreSQL and web-readiness checks.

`scripts/healthcheck-garonhome.sh` also tests the verified backup status, attempts a notification on stale/incomplete backups, and returns nonzero to the scheduler for a web or backup failure. Set the maximum-age and timeout values in the host environment using `infra/garonhome.env.example`. Never treat source-level mocks as evidence of a real encrypted restore or authorized production deployment; see [deployment](DEPLOY.md) and [backup operations](docs/BACKUP_RUNBOOK.md).

## Production Target

Production runs on garonhome.local using `infra/compose.garonhome.yml` and deploy root `/opt/business/ai-fsm`. The runbook is [DEPLOY.md](DEPLOY.md). Do not deploy to `/home/admin/apps/ai-fsm`; that path is legacy.
