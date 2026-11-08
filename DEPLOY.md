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

It writes `ai_fsm_<ts>.dump` (pg_dump, custom format), `ai_fsm_uploads_<ts>.tar.gz`, and an encrypted `.env` copy (`ai_fsm_env_<ts>.gpg`, only if the passphrase file exists). It then tries an offsite copy with rclone; a failed copy is non-fatal.

Check the dump before continuing:

```bash
ssh garonhome 'ls -lh /opt/business/ai-fsm/backups | tail -5'
```

If the dump is missing or zero bytes, stop. Do not deploy.

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

1. Syncs the checkout to `origin/<branch>` with a hard reset. If the host had local commits not on origin, they are saved to a `deploy-backup/<sha>-<ts>` branch first.
2. Starts `postgres` and waits for `pg_isready`.
3. Creates `schema_migrations` if missing. Applies each `db/migrations/*.sql` not yet recorded, in filename order, with `ON_ERROR_STOP=1`. Files with `seed` in the name are skipped. On the first run against an existing database with an empty tracking table, every file is recorded as applied without being run.
4. Builds `web` and `worker`.
5. Runs `up -d web worker`.
6. Waits until the web container reports `healthy`. The wait loop has no timeout. If it hangs, check `docker compose ... ps` from another shell.
7. Prints service status and the `/api/health` response.

Migrations run inside this script. `scripts/db-migrate.sh` is a separate runner for local use with `MIGRATION_DATABASE_URL`. Do not use it for garonhome.

Migration rules: files are additive. Applied filenames are immutable (see `ai/INVARIANTS.md`).

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
bash scripts/restore-garonhome.sh /opt/business/ai-fsm/backups/ai_fsm_<pre-deploy-ts>.dump
```

The restore stops `web` and `worker`, drops and recreates the database, restores the dump, and restarts the services.

Unverified — confirm on host: a restore drill has been run recently.

## 8. PWA refresh (Titan Go)

Titan Go checks for a newer service worker, but iPadOS can keep an open PWA process alive. After a deploy, fully close Titan Go and reopen it. If an old shell persists, open the site in Safari once and reload, then reopen the installed PWA.

## 9. Behaviour to preserve across deploys

- Existing auth and session flow is retained.
- The PostgreSQL/RLS Settings data-loading fix is retained.
- Titan workforce native API routes under `apps/web/app/api/v1/titan/` are not removed.
- The SQLite-only donor Zero runtime is not re-enabled. Zero execution stays fail-closed until the PostgreSQL runtime adapter is complete.
- Non-Field Desk/Pay backend routes are kept. They are removed only from the primary Field navigation.
