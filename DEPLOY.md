# Deployment (production)

Authoritative production runbook for garonhome.local. Reconciled 2026-11-08 against `scripts/deploy.sh`, `scripts/deploy-garonhome.sh`, `scripts/backup-garonhome.sh` and `infra/compose.garonhome.yml`. Decision record: `docs/working/deployment-target-decision-2026-11-08.md`.

Deploying is production. Do not deploy without explicit owner authorization for that release.

## 1. Production target (the only one)

- Host: `garonhome.local` (SSH alias `garonhome`)
- Deploy root: `/opt/business/ai-fsm`
- Checkout: `/opt/business/ai-fsm/repo` (git)
- Env file: `/opt/business/ai-fsm/env/.env` (never in git)
- Data: `/opt/business/ai-fsm/data` (postgres, uploads)
- Backups: `/opt/business/ai-fsm/backups`
- Compose file: `infra/compose.garonhome.yml` (project `ai-fsm`; services `web`, `worker`, `postgres`)
- Entrypoint: `scripts/deploy-garonhome.sh`

These paths are NOT the production path: `/home/admin/apps/ai-fsm`, the systemd unit `ai-fsm`, `start-production.sh`, and the UI-ZIP overlay. See section 6.

## 2. Pre-flight

1. Pick the commit. Default is `origin/main`.
   - Locally: `git fetch origin main && git log origin/main -1 --oneline`
   - On host: `ssh garonhome 'cd /opt/business/ai-fsm/repo && git log -1 --oneline'`
   - Record the host's current commit. It is the rollback target.
2. The host checkout must have no uncommitted changes. The deploy script refuses if it does.
3. The env file must contain `BOOKING_ACCOUNT_ID` as a UUID. The deploy script exits without it.
4. Confirm the external network exists (unverified from repo, run on host):
   `docker network inspect business_proxy >/dev/null`

## 3. Backup (run before every deploy)

The deploy script does not take a backup. Run this first:

```bash
ssh garonhome 'cd /opt/business/ai-fsm/repo && bash scripts/backup-garonhome.sh'
```

It writes three mandatory **encrypted** artifacts (`ai_fsm_<ts>.dump.gpg`, `ai_fsm_uploads_<ts>.tar.gz.gpg`, and `ai_fsm_env_<ts>.gpg`) plus a SHA-256 manifest. The complete set is uploaded, then every remote object is read back and SHA-256-verified, including the manifest, before a run is successful. Old size-only status reports do not satisfy the deployment gate; generate a fresh backup after upgrading. Missing uploads, passphrase or offsite copies make the run fail with `backups/status/INCOMPLETE`; do not deploy after an incomplete pre-deploy backup.

Check the dump before continuing:

```bash
ssh garonhome 'ls -lh /opt/business/ai-fsm/backups | tail -5'
```

If the dump is missing or zero bytes, stop. Do not deploy. Confirm `node scripts/check-backup-health.mjs /opt/business/ai-fsm/backups 26` exits 0. The deployment script now enforces this read-only check before any database changes; it cannot replace a real scratch restore drill.

Unverified — confirm on host: the nightly cron `0 2 * * *` for the backup script, and the rclone remote `googledrive`.

## 4. Deploy (migrations, build, restart)

Run from a workstation (it ssh's to the host):

```bash
bash scripts/deploy.sh main        # or a branch name to test it first
```

Or on the host:

```bash
cd /opt/business/ai-fsm/repo
DEPLOY_BRANCH=main bash scripts/deploy-garonhome.sh
```

What `deploy-garonhome.sh` does, in order:

1. Validates the branch reference and refuses any tracked **or untracked** checkout changes. Syncs to `origin/<branch>`; divergent local commits receive a `deploy-backup/<sha>-<ts>` branch before the canonical runner resets. The workstation wrapper no longer performs its own Git checkout/reset.
2. Runs `node scripts/check-backup-health.mjs` against the last encrypted verified backup and **aborts before starting services or migrations** on missing, stale or incomplete status. Then starts `postgres`, with a bounded readiness wait (`FSM_DEPLOY_DB_ATTEMPTS`, default 60 checks, 2 seconds apart).
3. Validates migration names and history, creates `schema_migrations` if missing, then applies each unrecorded migration in filename order with `ON_ERROR_STOP=1`. The explicitly named `002_seed_dev.sql` is excluded. Each SQL file and its tracking INSERT run in one transaction with a database advisory lock and a concurrent-replay guard. A populated schema with no tracking history now **aborts** instead of silently marking files applied; reconcile its actual migration history before deploying.
4. Builds `web` and `worker`.
5. Runs `up -d web worker`.
6. Waits for a healthy web container with a bounded check (`FSM_DEPLOY_WEB_ATTEMPTS`, default 60, 2 seconds apart). A missing healthcheck, unhealthy status, or timeout fails deployment instead of hanging indefinitely.
7. Prints service status and the `/api/health` response.

Migrations run inside this script. `scripts/db-migrate.sh` is a separate runner for local use with `MIGRATION_DATABASE_URL`. Do not use it for garonhome.

Migration rules: files are additive. Applied filenames are immutable (see `ai/INVARIANTS.md`). The legacy chain does not claim to be Titan Central's eventual canonical company-ID migration history. See [migration safety and source recovery](docs/working/legacy-migration-safety.md); do not apply this chain to an already-Central-managed shared database without reconciliation. `scripts/db-seed.sh` rejects declared production environments.

### 4a. Database runtime roles

Each service connects with its own role. `DATABASE_URL` in the env file is the admin URL, used for migrations, provisioning, and scripts. The role model is in `ai/INVARIANTS.md` and `docs/working/rls-web-tier-flip.md`.

| Variable | Role | Attributes | Status |
|---|---|---|---|
| `WEB_DATABASE_URL` | `ai_fsm` (admin) until the web cutover gate clears, then `ai_fsm_web` | `ai_fsm_web` is NOBYPASSRLS | Web still bypasses RLS. Cutover is blocked (see the flip runbook). |
| `WORKER_DATABASE_URL` | `ai_fsm_worker` | BYPASSRLS, DML on RLS tables, no DDL, no superuser | Active after this deploy. |

`scripts/deploy-garonhome.sh` provisions the roles after migrations and before web and worker start:
- `ai_fsm_worker` every deploy, using `AI_FSM_WORKER_PASSWORD` (required).
- `ai_fsm_web` only when `AI_FSM_WEB_PASSWORD` is set.

Provisioning is idempotent. It refuses a role whose attributes or ownership fall outside its model. Passwords stay in the env file and are never committed.

First deploy of the role split, in order:
1. Run section 3 (backup).
2. Add these to `/opt/business/ai-fsm/env/.env`. Generate the values; never commit them.
   - `AI_FSM_WORKER_PASSWORD=<random>`
   - `WORKER_DATABASE_URL=postgresql://ai_fsm_worker:<same password>@postgres:5432/<POSTGRES_DB>`
   - `WEB_DATABASE_URL=<same value as DATABASE_URL>`
3. Run section 4. The preflight fails before any change if one of the three is missing.
4. Verify with section 5 and the role query below. Check that the worker log shows polls and no authentication errors.

Role check after deploy:

```bash
COMPOSE="docker compose --env-file /opt/business/ai-fsm/env/.env -f infra/compose.garonhome.yml"
$COMPOSE exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname LIKE '"'"'ai_fsm%'"'"' ORDER BY 1"'
# expect ai_fsm_worker: rolsuper f, rolbypassrls t. ai_fsm_web (if provisioned): rolbypassrls f.
```

Worker rollback: set `WORKER_DATABASE_URL` to the admin URL and run `$COMPOSE up -d worker`. The role stays in place and does no harm.

Web cutover (not part of this deploy): set `WEB_DATABASE_URL` to the `ai_fsm_web` URL only after every blocker and verification item in `docs/working/rls-web-tier-flip.md` is closed and checked on a staging copy.

Remote backup timeouts: `FSM_BACKUP_REMOTE_COPY_TIMEOUT_SEC` and `FSM_BACKUP_REMOTE_READ_TIMEOUT_SEC` default to 900 seconds and require values between 5 and 3600. Invalid remote names or timeouts write an `INCOMPLETE` status that blocks future deployment. The alert hook setting `BACKUP_ALERT_CMD` accepts one executable path, not arbitrary shell code.

## 5. Health checks

Run on the host from `/opt/business/ai-fsm/repo`:

```bash
COMPOSE="docker compose --env-file /opt/business/ai-fsm/env/.env -f infra/compose.garonhome.yml"

$COMPOSE ps
# expect web, worker, postgres running; web healthy

$COMPOSE exec -T web wget -qO- http://127.0.0.1:3000/api/health
# expect {"status":"ok", ... "checks":{"db":"ok"} ...}

$COMPOSE exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5"'
# expect the new migration files listed
```

Unverified — confirm on host:

- `curl -sf http://fsm.garonhome.local/api/health` through Nginx Proxy Manager (LAN DNS and NPM host settings are not in the repo).
- The public HTTPS origin (`APP_URL`) through the Cloudflare Tunnel.
- The 5-minute monitor `scripts/healthcheck-garonhome.sh` is installed in cron, and its ntfy topic is set.

## 6. Legacy and non-production paths

These are not used for garonhome. Do not run them against production.

### 6a. UI-ZIP overlay (NON-PRODUCTION, legacy patch overlay)

An earlier Titan Go UI patch was copied as a ZIP into `/home/admin/apps/ai-fsm`, unzipped over the tree, built with `pnpm --filter ./apps/web build`, and restarted with `systemctl restart ai-fsm`. That flow:

- Skips the Compose stack, so the `web` and `worker` containers are not rebuilt.
- Skips `schema_migrations`, so no migration is recorded or applied.
- Targets a second checkout that is not the one `scripts/deploy-garonhome.sh` manages.

The original step list is in git history (`git show 9d801e1:DEPLOY.md`). Use `scripts/deploy-garonhome.sh` instead.

### 6b. `start-production.sh` (legacy, not referenced by compose or deploy scripts)

Runs `next start` on `127.0.0.1:3000` from `/home/admin/apps/ai-fsm`. It is not part of the Compose stack.

Unverified — confirm on host: whether a systemd unit `ai-fsm` still exists and calls this script, and whether `/home/admin/apps/ai-fsm` still holds a running copy. If it does, retire it on the host. Do not change production from the repo side without owner authorization.

## 7. Rollback

Rollback is two separate actions. Pick the one that matches the failure.

**Code rollback.** `deploy-garonhome.sh` always resets to `origin/<branch>`. A plain `git checkout <old-sha>` followed by the script will roll forward to the branch tip again. To roll back code:

1. Make a branch on origin that points at the previous good commit. This is a push: get owner approval first.
2. `DEPLOY_BRANCH=<that-branch> bash scripts/deploy-garonhome.sh`

Migrations are forward-only. Old code must tolerate the newer additive schema.

**Data rollback.** Restore the pre-deploy dump:

```bash
cd /opt/business/ai-fsm/repo
FSM_RESTORE_CONFIRM_DB=ai_fsm bash scripts/restore-garonhome.sh /opt/business/ai-fsm/backups/ai_fsm_<pre-deploy-ts>.dump.gpg
```

The restore requires a typed `FSM_RESTORE_CONFIRM_DB` equal to the target database name, plus the full encrypted set and SHA-256 manifest. The preflight checks all three artifacts and validates archive member paths before stopping services or replacing a database. Restore health checks are bounded (`FSM_RESTORE_WEB_ATTEMPTS`, default 30 attempts). The example name `ai_fsm` must be replaced if the deployment uses another `POSTGRES_DB`. It then stops `web` and `worker`, drops and recreates the database, restores the dump, and restarts the services. Never use a partial backup set for destructive rollback.

Unverified — confirm on host: a restore drill has been run recently.

## 8. PWA refresh (Titan Go)

Titan Go checks for a newer service worker, but iPadOS can keep an open PWA process alive. After a deploy, fully close Titan Go and reopen it. If an old shell persists, open the site in Safari once and reload, then reopen the installed PWA.

## 9. Behaviour to preserve across deploys

- Existing auth and session flow is retained.
- The PostgreSQL/RLS Settings data-loading fix is retained.
- Titan workforce native API routes under `apps/web/app/api/v1/titan/` are not removed.
- The SQLite-only donor Zero runtime is not re-enabled. Zero execution stays fail-closed until the PostgreSQL runtime adapter is complete.
- Non-Field Desk/Pay backend routes are kept. They are removed only from the primary Field navigation.
