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

A nonzero exit indicates a stale, missing or incomplete verified backup, and should trigger operator investigation. The health file alone is not proof of a successful scratch restore.

## Production Target

Production runs on garonhome.local using `infra/compose.garonhome.yml` and deploy root `/opt/business/ai-fsm`. The runbook is [DEPLOY.md](DEPLOY.md). Do not deploy to `/home/admin/apps/ai-fsm`; that path is legacy.
