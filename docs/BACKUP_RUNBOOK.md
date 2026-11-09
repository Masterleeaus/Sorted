# PostgreSQL Backup & Restore Runbook

## Overview

This runbook covers backup, restore, and validation procedures for the ai-fsm PostgreSQL database.
Target deployment: garonhome.local running Docker Compose (`infra/compose.garonhome.yml`).
Deploy root: `/opt/business/ai-fsm/`

---

## Backup Strategy

| Backup type | Tool | Frequency | Retention |
|-------------|------|-----------|-----------|
| Logical (SQL dump) | `pg_dump` → `gpg --symmetric` (AES-256) | Daily (cron) | 7 days local + 30 days offsite (Google Drive, via rclone) |
| Uploaded files (`data/uploads/`) | `tar` → `gpg --symmetric` (AES-256) | Daily (cron) | 7 days local + 30 days offsite |
| Secrets (`.env`) | `gpg --symmetric` (AES-256) | Daily (cron) | 7 days local + 30 days offsite |

Every artifact is encrypted before it leaves the pipeline. No plaintext dump, archive or `.env` copy is written to the host or uploaded. See [Encryption and key management](#encryption-and-key-management).
| WAL archiving | Not configured | — | N/A (MVP) |

> **MVP note**: WAL archiving is deferred for post-MVP. Logical backups are sufficient for a low-write field-service app with acceptable RPO of 24 hours.

> **Why the `.env` backup matters**: GitHub has the code, but `.env` is gitignored by design (it holds `POSTGRES_PASSWORD`, `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, Square tokens). Without a copy of it, a full disk loss leaves you with a restorable database whose `APP_ENCRYPTION_KEY`-protected rows (e.g. Square credentials) are permanently unreadable, even though the bytes are intact.

---

## Daily Backup Procedure

### Manual backup

```bash
# Run from garonhome.local deploy root
cd /opt/business/ai-fsm/repo
bash scripts/backup-garonhome.sh
```

The script writes an encrypted, compressed Postgres custom-format dump to `/opt/business/ai-fsm/backups/`. It only prunes individually verified backup files older than seven days after a successful run, and never prunes an unverified historical set solely because a newer backup succeeded.

### Automated backup (cron)

Add to crontab (`crontab -e`):

```cron
# Daily backup at 02:00
0 2 * * * cd /opt/business/ai-fsm/repo && bash scripts/backup-garonhome.sh >> /opt/business/ai-fsm/logs/backup.log 2>&1
```

The backup script (`scripts/backup-garonhome.sh`) performs:
1. `pg_dump` from the running postgres container, encrypted in-stream, to `/opt/business/ai-fsm/backups/ai_fsm_YYYYMMDDTHHMMSSZ.dump.gpg`
2. `tar` of `/opt/business/ai-fsm/data/uploads/`, encrypted in-stream, to `ai_fsm_uploads_YYYYMMDDTHHMMSSZ.tar.gz.gpg`
3. `gpg --symmetric` encryption of `.env` to `ai_fsm_env_YYYYMMDDTHHMMSSZ.gpg`
4. Writes `ai_fsm_YYYYMMDDTHHMMSSZ.sha256` (SHA-256 of the three encrypted files above)
5. Pushes all four files offsite via `rclone`
6. Verifies each offsite copy by remote listing (name and byte size) before counting it as stored
7. Writes the status markers described in [Backup status and alerts](#backup-status-and-alerts)
8. Prunes local sets older than 7 days, but only sets whose offsite copy is verified (see Retention below)
9. Prunes offsite (Google Drive) copies older than 30 days via `rclone delete --min-age`, only when this run's set is complete and verified

The run refuses to start (no files written) if the passphrase file is missing or empty, or if it sits inside the backup directory. A run is **complete** only when the database dump, the uploads archive, the `.env` backup and the manifest are all written and all four are verified on Drive by name and size. Remote byte-size verification does not prove remote content integrity; perform a periodic independent download and SHA-256 restore drill. Anything else is **INCOMPLETE**: the script exits non-zero and the status files say why.

### Backup status and alerts

Status lives in `/opt/business/ai-fsm/backups/status/` (not matched by the artifact patterns, so it is never pruned as a backup):

| File | Meaning |
|------|---------|
| `last-success.json` | Written only by a complete, verified run. Holds the set timestamp, completion time, and the name, byte size and SHA-256 of each artifact. It is the source of truth for "last good backup". |
| `last-run.json` | The most recent run, `"status": "ok"` or `"incomplete"`, with the list of failures. |
| `INCOMPLETE` | Present only while the most recent run was incomplete. Lists the failures. |
| `verified-<timestamp>` | Marker that a set was verified on Drive. Local sets are pruned only if their **own** marker exists and the current run succeeds. A fresh successful set never authorizes deleting an unrelated unverified old set. |

**Alert hook: not configured.** The repo has no alert endpoint. The script calls `BACKUP_ALERT_CMD` with the message as its first argument whenever a run is incomplete. Set it in the env file to a command that posts to your chat or email service, for example:

```bash
# in /opt/business/ai-fsm/env/.env (operator-owned, not in git)
BACKUP_ALERT_CMD=/opt/business/ai-fsm/bin/notify-backup
```

If `BACKUP_ALERT_CMD` is unset, the script prints `ALERT (BACKUP_ALERT_CMD not configured; nothing sent)` to stderr and the cron log. That is a missing alert, not a successful one. Until the hook is configured, check the status files daily (see below).

### Deployment and monitoring enforcement

Before starting PostgreSQL, applying migrations or rebuilding services, `scripts/deploy-garonhome.sh` now executes the read-only backup health gate with `FSM_PREDEPLOY_BACKUP_MAX_AGE_HOURS` (default 26 hours). A stale, incomplete, missing or mismatched report blocks the deployment; **there is no automatic fallback to a previous apparently successful set**. Take and verify a fresh complete encrypted backup before retrying. A new host with no prior verified backups requires an explicitly designed and reviewed initial-provisioning procedure, not an implicit backup bypass.

`scripts/healthcheck-garonhome.sh` independently evaluates backup status on its monitoring schedule. Web-down and backup-invalid states now return exit code 1 to the scheduler as well as attempting ntfy notification. Configure an external monitoring system to observe that exit status, because network delivery of an alert is not guaranteed. `FSM_BACKUP_MAX_AGE_HOURS` controls the monitor's freshness threshold; do not confuse this with the predeployment threshold.

### Machine-readable health check

Run the read-only health gate from the repository checkout:

```bash
node scripts/check-backup-health.mjs /opt/business/ai-fsm/backups 26
```

It prints one JSON record and exits **0** only when the most recent run succeeded, its set matches the individually verified backup, the three required artifacts have valid metadata, the verification marker exists, and the success timestamp is recent. All missing, stale, invalid, incomplete, and inconsistent states exit **1**. The check reads status files only: it does not connect to the production database or decrypt backup data. It is suitable for a local monitoring scheduler, but **does not independently verify the remote content or prove that a restore will succeed**. Continue regular offsite-download and scratch-restore drills.

If the environment file is absent or fails to source, the backup script still writes `last-run.json` and `INCOMPLETE` before exiting. External monitoring should alert on the health check's non-zero exit; a `BACKUP_ALERT_CMD` inside a missing environment file cannot be relied upon for this failure case.

### Operator check: is the last full backup good?

Run this on garonhome, for example in the morning:

```bash
cd /opt/business/ai-fsm/backups/status
test ! -e INCOMPLETE && echo "last run: complete" || { echo "last run: INCOMPLETE"; cat INCOMPLETE; }
cat last-success.json
# Age in hours of the last verified full set (should be under 26):
echo $(( ( $(date -u +%s) - $(date -u -d "$(sed -nE 's/.*"completed_at": "([^"]+)".*/\1/p' last-success.json)" +%s) ) / 3600 ))
```

Then confirm the set is on Drive, using the `set` value from `last-success.json` (replace `<TS>`):

```bash
rclone lsf --files-only googledrive:ai-fsm-backups | grep "<TS>"
```

Expect four names: `ai_fsm_<TS>.dump.gpg`, `ai_fsm_uploads_<TS>.tar.gz.gpg`, `ai_fsm_env_<TS>.gpg`, `ai_fsm_<TS>.sha256`.

A `last-success.json` older than about 26 hours, or an `INCOMPLETE` file, means the nightly job did not produce a complete verified set. Startup failures such as a missing or malformed `.env` now persist an incomplete status as well. Fix the cause listed in `INCOMPLETE` (or in `docs/BACKUP_RUNBOOK.md` Known Limitations) and run the script manually.

### One-time setup: the `.env` backup passphrase

```bash
# On garonhome, once:
openssl rand -base64 32 > /opt/business/ai-fsm/env/backup.passphrase
chmod 600 /opt/business/ai-fsm/env/backup.passphrase
```

Then store that passphrase value in the company password manager (1Password/Bitwarden) as the durable source of truth — the file on disk and the encrypted `.gpg` backups are both useless without it, and it isn't itself backed up (deliberately, so a stolen backup set alone can't decrypt itself). See [Encryption and key management](#encryption-and-key-management) for placement, recovery, rotation and incident steps.

---

## Offsite / Remote Backup

This is already automatic — `scripts/backup-garonhome.sh` pushes every encrypted dump, uploads archive, `.env` backup and `.sha256` manifest to the `googledrive:ai-fsm-backups` Google Drive folder via `rclone` as part of the nightly cron run. Each copy is checked by remote listing (name and size). Copies older than 30 days are pruned (`rclone delete --min-age 30d`, configurable via `FSM_BACKUP_REMOTE_RETENTION_DAYS`), but only after a complete verified run.

Direct folder link: `https://drive.google.com/drive/folders/1gYp-bXjpAj3DpTKOvF6RZt1ElH4HNT36`

If you can't find the backups in Drive, it's almost always because the browser session is on a different Google account than the one `rclone` authorized. Check which account by inspecting the token in `rclone config show googledrive`, or just open the direct folder link above and let Google prompt an account switch.

To verify what's actually on Drive right now (bypasses the local log, checks the source of truth):

```bash
rclone lsl googledrive:ai-fsm-backups
```

---

## Restore Procedure

Use the restore script for the full restore sequence:

```bash
cd /opt/business/ai-fsm/repo
bash scripts/restore-garonhome.sh /opt/business/ai-fsm/backups/ai_fsm_YYYYMMDDTHHMMSSZ.dump.gpg
```

The restore helper intentionally accepts **only** encrypted `*.dump.gpg` sets, refuses reserved PostgreSQL system database names, requires a usable decryption passphrase, and stops before any destructive operation if the manifest or any companion archive is missing. Old plaintext/partial sets must be migrated through a separate, explicitly reviewed recovery procedure rather than passed to the production restore command.

The restore script handles the full sequence automatically:
1. Requires the SHA-256 manifest and all three encrypted artifacts, checks the full set, and decrypts the dump to `/dev/null` to confirm passphrase and integrity before anything is stopped
2. Stops `web` and `worker` containers (prevents writes during restore)
3. Terminates active DB sessions
4. Drops and recreates the `ai_fsm` database
5. Streams the decrypted dump into `pg_restore` (no plaintext copy is written to disk)
6. Restarts `web` and `worker`
7. Verifies the health endpoint

### Restore drill (verification without touching the live database)

Run this after changing keys or scripts, and at least monthly:

```bash
cd /opt/business/ai-fsm/repo
bash scripts/verify-backup-garonhome.sh /opt/business/ai-fsm/backups/ai_fsm_YYYYMMDDTHHMMSSZ.dump.gpg
```

It checks the set's checksums, decrypts all three artifacts into a private temp directory (`FSM_VERIFY_TMPDIR`, default `$TMPDIR` or `/tmp`), restores the dump into a scratch database named `ai_fsm_verify_<pid>`, counts the public tables, and checks the uploads archive and `.env` backup. On exit, success or failure, it drops the scratch database and deletes the temp directory. The last line is `VERIFY OK` or `VERIFY FAILED`.

### Manual restore steps (if script is unavailable)

#### 1. Stop the application

```bash
docker compose --env-file /opt/business/ai-fsm/env/.env \
  -f /opt/business/ai-fsm/repo/infra/compose.garonhome.yml \
  stop web worker
```

#### 2. Drop and recreate the target database

```bash
docker exec -it ai-fsm-postgres psql --username=postgres <<'SQL'
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = 'ai_fsm' AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS ai_fsm;
CREATE DATABASE ai_fsm OWNER postgres;
SQL
```

#### 3. Restore from dump

```bash
DUMP_FILE="/opt/business/ai-fsm/backups/ai_fsm_YYYYMMDDTHHMMSSZ.dump.gpg"

gpg --batch --quiet --decrypt --passphrase-file /path/to/passphrase "$DUMP_FILE" \
  | docker exec -i ai-fsm-postgres pg_restore \
  --username=postgres \
  --dbname=ai_fsm \
  --verbose \
  --no-owner \
  --no-acl \
  --no-owner --no-privileges
```

#### 4. Restart the application

```bash
docker compose --env-file /opt/business/ai-fsm/env/.env \
  -f /opt/business/ai-fsm/repo/infra/compose.garonhome.yml \
  start web worker
```

#### 5. Verify (see Validation Drill below)

---

## Restoring Uploads and Secrets

Needed for a full disaster-recovery rebuild (new host, or a wiped drive) — the DB restore above only covers the database.

### Restore uploaded files

```bash
gpg --batch --quiet --decrypt --passphrase-file /path/to/passphrase \
  ai_fsm_uploads_YYYYMMDDTHHMMSSZ.tar.gz.gpg \
  | tar -xzf - -C /opt/business/ai-fsm/data/
```

### Restore `.env`

Requires the passphrase from the password manager (see one-time setup above):

```bash
gpg --batch --yes --decrypt \
  --passphrase-file /path/to/passphrase \
  -o /opt/business/ai-fsm/env/.env \
  ai_fsm_env_YYYYMMDDTHHMMSSZ.gpg
chmod 600 /opt/business/ai-fsm/env/.env
```

On a brand-new host, pull all four files of the set (dump `.gpg`, uploads `.gpg`, env `.gpg`, `.sha256`) from the `googledrive:ai-fsm-backups` rclone remote first, check them with `sha256sum -c ai_fsm_YYYYMMDDTHHMMSSZ.sha256`, then run these restores before `docker compose up`.

Backups made before the encryption change (`ai_fsm_*.dump` and `ai_fsm_uploads_*.tar.gz`, no `.gpg`) are plaintext. Restore them with `pg_restore` / `tar -xzf` directly.

---

## Validation Drill

Run this after every restore and at least monthly as a fire drill.

### Step 1 — Basic connectivity

```bash
docker exec -it ai-fsm-postgres psql \
  --username=postgres \
  --dbname=ai_fsm \
  -c "SELECT version();"
```

Expected: PostgreSQL version string printed, no error.

### Step 2 — Row counts look reasonable

```bash
docker exec -it ai-fsm-postgres psql \
  --username=postgres \
  --dbname=ai_fsm \
  -c "SELECT
        (SELECT count(*) FROM users)       AS users,
        (SELECT count(*) FROM jobs)        AS jobs,
        (SELECT count(*) FROM visits)      AS visits,
        (SELECT count(*) FROM estimates)   AS estimates,
        (SELECT count(*) FROM invoices)    AS invoices,
        (SELECT count(*) FROM payments)    AS payments,
        (SELECT count(*) FROM audit_log)   AS audit_log;"
```

Compare against last known good counts (record them after each planned backup).

### Step 3 — Health endpoint returns 200

On garonhome, port 3000 is not exposed to the host. Run the health check from inside the container:

```bash
docker exec ai-fsm-web wget -qO- http://localhost:3000/api/health | jq .
```

Expected response:
```json
{ "status": "ok", "service": "web", "checks": { "db": "ok" }, "ts": "..." }
```

Or via the reverse proxy:

```bash
curl -sf http://fsm.garonhome.local/api/health | jq .
```

### Step 4 — Smoke test login

```bash
curl -s -X POST http://fsm.garonhome.local/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<seed-password>"}' | jq .user.role
```

Expected: `"owner"` (or whatever the seed admin role is).

### Step 5 — Record drill results

Append to `docs/DECISION_LOG.md` under a new `DRILL-<date>` entry:

```
### DRILL-<YYYY-MM-DD>: Backup restore validation
- Date: <UTC datetime>
- Backup file: ai_fsm_<timestamp>.dump
- Restore duration: <N minutes>
- Row counts: users=X, jobs=Y, ...
- Health check: ok
- Login smoke test: ok
- Notes: <any issues found>
```

---

## Backup Integrity Check (without full restore)

Quick check that the dump file is not corrupted:

```bash
DUMP_FILE="/opt/business/ai-fsm/backups/ai_fsm_<timestamp>.dump.gpg"
gpg --batch --quiet --decrypt --passphrase-file /path/to/passphrase "$DUMP_FILE" \
  | docker exec -i ai-fsm-postgres pg_restore --list | head -20
```

No error output = file is structurally valid.

---

## Recovery Time Objective (RTO)

| Database size | Estimated restore time |
|---------------|------------------------|
| < 100 MB | 1–3 minutes |
| 100 MB – 1 GB | 3–15 minutes |
| > 1 GB | 15+ minutes |

---

## Known Limitations (MVP)

1. **No point-in-time recovery (PITR)** — WAL archiving not configured. Maximum data loss = 24 hours (last backup).
2. **No replication / standby** — single-node PostgreSQL. If garonhome.local hardware fails, restore from offsite backup to another x86 host.
3. **Plaintext backups from before the encryption change remain** on Drive and locally until their retention ends (up to 30 days offsite). Delete them early only after a verified encrypted set exists.

---

## Encryption and key management

All dump, uploads and `.env` artifacts are encrypted with `gpg --symmetric --cipher-algo AES256` (the same tool already used for `.env`, so no new software is needed on garonhome). The key is one passphrase, stored in a file.

### Where each secret lives

| Item | Location | Notes |
|------|----------|-------|
| Passphrase (the key) | `/opt/business/ai-fsm/env/backup.passphrase` (chmod 600) | Outside `backups/`. The script refuses to run if the file is inside the backup directory. |
| Passphrase (durable copy) | Company password manager | The only recovery path if the host is lost. |
| Encrypted artifacts | `/opt/business/ai-fsm/backups/` and `googledrive:ai-fsm-backups` | Never contain the key. |
| Passphrase | Never in git, never in Drive, never in the backup set | |

Nothing in this layout puts the decryption key beside the archive it protects. Anyone who gets only the backup set (local copy, Drive account, or a leaked download) cannot decrypt it.

### Recovery

- **Host lost, password manager available**: install the host, write the passphrase to `env/backup.passphrase` (`chmod 600`), copy the set from Drive, verify with `sha256sum -c`, run `scripts/verify-backup-garonhome.sh`, then restore.
- **Passphrase file lost, password manager available**: recreate the file from the password manager, then run the restore drill to confirm it decrypts a recent set.
- **Passphrase lost everywhere**: the encrypted sets cannot be opened. Record the loss in `docs/DECISION_LOG.md`, take a fresh backup on a working host with a new key, and rotate the offsite set (see below).

### Rotation (planned, at least yearly or after staff change)

1. Generate a new key: `openssl rand -base64 32 > /opt/business/ai-fsm/env/backup.passphrase.new && chmod 600 ...backup.passphrase.new`.
2. Save the new value in the password manager, under a new entry name that includes the date.
3. Move the old file to `env/backup.passphrase.<YYYYMMDD>` (still outside `backups/`), and move the new file into place as `env/backup.passphrase`.
4. Run a backup, then the restore drill against the new set.
5. Keep the old passphrase file only until every set encrypted with it has aged out of local and offsite retention (30 days offsite). Then delete it and mark the password-manager entry as retired. To decrypt an old set during that window, pass the old file as `FSM_BACKUP_PASSPHRASE_FILE=...` to the restore or verify script.

### Incident steps (passphrase or backup set suspected exposed)

1. Rotate the key as above, immediately.
2. Delete the exposed offsite sets (`rclone delete` on the exposed file names) and any local copies, once a backup under the new key is verified.
3. Check Drive sharing and the Google account's access log for who downloaded the set.
4. Remember the limit: the old key still decrypts any copy that was already taken. Rotation protects only new backups.
5. Record the incident and the actions in `docs/DECISION_LOG.md`.

### Retention and deletion

- Local: 7 days, deleted by `backup-garonhome.sh`, and only for a set whose offsite copy is verified (marker `status/verified-<ts>`). An unverified set is kept while Drive is failing. Once a run completes and verifies, older unverified sets are pruned as well, because a complete offsite set now exists. If Drive is down for a long time, local disk use grows by one set per night; the INCOMPLETE alert is the signal to act.
- Offsite: 30 days (`FSM_BACKUP_REMOTE_RETENTION_DAYS`), deleted by `rclone delete --min-age`.
- A set is deleted as a unit: its dump, uploads, env and `.sha256` files.
- Deleting a set does not require rotating the key. Destroying a retired passphrase file makes its remaining copies permanently unreadable, which is the intended deletion for a retired key.

### Integrity

- `ai_fsm_<ts>.sha256` lists SHA-256 for the three encrypted files of a set. Verify with `cd /opt/business/ai-fsm/backups && sha256sum -c ai_fsm_<ts>.sha256`.
- gpg also authenticates each encrypted file (MDC) when decrypting, so a corrupted or altered file fails to decrypt.
- Offsite copies are checked after upload when the set is verified; see the offsite section.
- `scripts/test-backup-garonhome.sh` is a simulation of the backup, verify and restore scripts with a fake `docker` and `rclone` in a temp dir. It needs no host, database or Drive access. Run it after changing any backup script: `bash scripts/test-backup-garonhome.sh`.
