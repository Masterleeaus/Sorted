# Decision: one production deployment target (2026-11-08)

Issue: #7 (docs/runbook alignment only; no deployment behaviour changed).

## Decision

Production is the garonhome.local Docker Compose stack:

- checkout `/opt/business/ai-fsm/repo`
- compose `infra/compose.garonhome.yml`
- entrypoint `scripts/deploy-garonhome.sh` (via `scripts/deploy.sh`)
- backup `scripts/backup-garonhome.sh`, run before each deploy

`DEPLOY.md` is the single procedure. `/home/admin/apps/ai-fsm`, the systemd unit `ai-fsm`, `start-production.sh`, and the UI-ZIP overlay are legacy and not production.

## Why

- The deploy script, backup script, restore script, healthcheck script and compose file all use `/opt/business/ai-fsm`. Only `DEPLOY.md` and `start-production.sh` use `/home/admin/apps/ai-fsm`.
- Only the Compose flow applies migrations through `schema_migrations`. The overlay path skips migrations.
- `ai/INVARIANTS.md`, `AGENTS.md`, `README.md` and `docs/canonical/ARCHITECTURE.md` already name the Compose target.

## Alternatives rejected

- Keep the overlay procedure as production: bypasses Compose and migrations, and writes to a second checkout.
- Delete `start-production.sh` now: it is code, and this issue is docs-only. Left in place and labelled.

## Known gaps (not fixed here)

- `scripts/deploy-garonhome.sh` does not take a backup. The runbook now requires a separate backup step.
- Its wait for `healthy` has no timeout.
- `docs/DEPLOYMENT_RUNBOOK.md` rollback Option A (`git checkout <old>` then deploy) does not work: the script resets to `origin/<branch>`. `DEPLOY.md` §7 documents the working route.
- `docs/DEPLOYMENT_RUNBOOK.md` says `git pull origin main`; the script does a hard reset.

## Unverified — confirm on host

- Whether systemd unit `ai-fsm` and `/home/admin/apps/ai-fsm` still run anything.
- Nightly backup cron, rclone remote `googledrive`.
- Health monitor cron (`scripts/healthcheck-garonhome.sh`).
- NPM host `fsm.garonhome.local`, LAN DNS, Cloudflare Tunnel origin.
- Recent restore drill.
- `business_proxy` network exists.
