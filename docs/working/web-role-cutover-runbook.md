# Web role cutover runbook (admin role to ai_fsm_web)

Host runbook for moving the **web** container from the admin database role (`ai_fsm`)
to the restricted `ai_fsm_web` role, so RLS is enforced for web requests.

Date written: 2026-11-14. Sources: `docs/working/rls-web-tier-flip.md`, `DEPLOY.md`
(sections 3, 4, 4a, 5, 7), `ai/INVARIANTS.md`, `scripts/db-provision-runtime.sh`,
`scripts/deploy-garonhome.sh`, `db/migrations/204_token_resolvers.sql`,
`db/migrations/207_token_resolver_owner.sql`, `infra/garonhome.env.example`,
`infra/compose.garonhome.yml`.

Items marked **confirm on host** cannot be checked from the repo.

## 0. Gate: do not flip yet

**Status: NOT READY.** The web cutover is blocked. Do not change `WEB_DATABASE_URL`
to the `ai_fsm_web` URL until every item in section 7 is closed and the verification
in section 5 passes on a staging copy. Flipping early means web requests run under
RLS with no account context and return empty or 404 results for the owner's own data.

Steps 1 and 2 are safe to do now. Steps 3 onward are the cutover itself.

Ticket links: issue #6 (least-privilege role, tenant isolation) and issue #15
(worker RLS reconciliation). TASK-146 in `docs/backlog/`.

## 1. Backup first

Take a backup before any change. Do not deploy without it.

```bash
ssh garonhome 'cd /opt/business/ai-fsm/repo && bash scripts/backup-garonhome.sh'
ssh garonhome 'ls -lh /opt/business/ai-fsm/backups | tail -5'
```

- The dump (`ai_fsm_<ts>.dump`) and uploads tarball must exist and be non-zero.
  If either is missing or zero bytes, stop.
- Record the timestamp of this backup. It is the data rollback point.
- Backup encryption and offsite verification are open (issues #22 and #24). Until
  they close, the dump is not encrypted before offsite copy.
- Confirm on host: the nightly cron `0 2 * * *`, the `googledrive` rclone remote, and
  that a restore drill has run recently.

## 2. Pre-checks (no change)

Run on the host from `/opt/business/ai-fsm/repo`. Use one shell variable for the
compose command:

```bash
COMPOSE="docker compose --env-file /opt/business/ai-fsm/env/.env -f infra/compose.garonhome.yml"
```

1. Current web URL. It should equal `DATABASE_URL` (admin) today. Record it in the
   host's ops notes (not in git) as the rollback value.
   `grep -E '^(DATABASE_URL|WEB_DATABASE_URL|WORKER_DATABASE_URL)=' /opt/business/ai-fsm/env/.env | sed 's/:[^:@]*@/:***@/'`
2. Migrations 204 and 207 are applied:
   `$COMPOSE exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT filename FROM schema_migrations WHERE filename LIKE '"'"'20%'"'"' ORDER BY 1"'`
   Confirm on host.
3. Blocker list in section 7 is empty (see the gate in section 0).
4. The repo checkout on the host is clean. The deploy script refuses otherwise.
5. Staging copy exists with the same migrations and two or more accounts, so the
   cross-tenant check in section 5 can run. Confirm on host.

## 3. Env changes

Two values matter. Change them in `/opt/business/ai-fsm/env/.env` only. Never commit them.

Step 3a (safe now, no behaviour change): set the web role password. The deploy
provisions `ai_fsm_web` only when this is set.

```text
AI_FSM_WEB_PASSWORD=<random, generated on host>
```

Step 3b (the cutover, after the gate): point web at the restricted role. Use the same
password in the URL.

```text
WEB_DATABASE_URL=postgresql://ai_fsm_web:<same password>@postgres:5432/<POSTGRES_DB>
```

Leave these unchanged:

- `DATABASE_URL`: admin. Migrations, provisioning, and scripts still use it.
- `WORKER_DATABASE_URL`: `ai_fsm_worker`. Unchanged.
- `AI_FSM_WORKER_PASSWORD`: unchanged.

Common mistake: `WEB_DATABASE_URL` set without `AI_FSM_WEB_PASSWORD`, or the two
passwords differ. The role then either does not exist or cannot log in, and web fails
its health check. The deploy preflight checks only that `WEB_DATABASE_URL` is set, not
that it matches the role.

### Owner-role steps

Two ownership facts matter before the cutover. Confirm both on host after migration 207.

- The 204 resolver functions are owned by `ai_fsm_token_definer` after migration 207.
  That role is `NOLOGIN`, `NOINHERIT`, and `BYPASSRLS`. It owns no tables and holds only
  the column grants the resolver bodies need. No password, no login.
- `ai_fsm_web` must own nothing. It must not own tables, functions, schemas or be a
  member of any role. The provisioner refuses a role that does.

Doc drift to fix later: `docs/working/rls-web-tier-flip.md` says the resolver functions
are owned by the migration (admin) role. Migration 207 changed that. Treat 207 as the
current state and update the flip doc in a separate change.

## 4. Run the deploy (provisions roles, then switches web)

The deploy provisions roles after migrations and before web starts. The web container
reads `WEB_DATABASE_URL` only when it starts, so the cutover takes effect when `web` is
recreated by this deploy.

```bash
ssh garonhome
cd /opt/business/ai-fsm/repo
DEPLOY_BRANCH=<branch> bash scripts/deploy-garonhome.sh
```

Or from a workstation: `bash scripts/deploy.sh <branch>`.

What the script does for roles (`scripts/deploy-garonhome.sh`):

1. Preflight: fails if `WEB_DATABASE_URL`, `WORKER_DATABASE_URL`, or
   `AI_FSM_WORKER_PASSWORD` is missing.
2. Applies unapplied migrations (includes 207 if not yet applied).
3. Runs `scripts/db-provision-runtime.sh` for `ai_fsm_worker` (every deploy).
4. Runs it for `ai_fsm_web` only if `AI_FSM_WEB_PASSWORD` is set. Idempotent. It creates
   the role if missing, sets its password, grants DML on RLS tables and EXECUTE on the
   login and token resolver functions, and refuses attributes or ownership outside the
   model. It never alters an existing role's attributes.
5. Builds and runs `web` and `worker`.
6. Waits for the web container to report `healthy`. This wait has no timeout. If it
   hangs, check `$COMPOSE ps` from a second shell.

Confirm on host: the deploy log shows `Provisioned restricted ai_fsm_web`, and the
web container shows `healthy`.

## 5. Verification

Run these in order. Stop at the first failure and go to rollback (section 6).

### 5a. Role attributes (as admin)

```bash
$COMPOSE exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname LIKE '"'"'ai_fsm%'"'"' ORDER BY 1"'
```

Expect:

- `ai_fsm`: superuser (admin, unchanged).
- `ai_fsm_web`: `rolsuper f`, `rolbypassrls f`, `rolcanlogin t`.
- `ai_fsm_worker`: `rolsuper f`, `rolbypassrls t`, `rolcanlogin t`.
- `ai_fsm_token_definer`: `rolcanlogin f`, `rolbypassrls t` (present if 207 applied).

### 5b. Function ownership (as admin)

```bash
$COMPOSE exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT p.proname, pg_get_userbyid(p.proowner), p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '"'"'public'"'"' AND (p.proname LIKE '"'"'resolve_%'"'"' OR p.proname LIKE '"'"'consume_portal%'"'"') ORDER BY 1"'
```

Expect all ten 204 resolvers owned by `ai_fsm_token_definer` with `prosecdef t`
(after 207). If 207 is not applied, they are owned by `ai_fsm`. That is acceptable only
before the cutover.

### 5c. RLS is on for account tables (as admin)

```bash
$COMPOSE exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FILTER (WHERE relrowsecurity) AS rls_on, count(*) FILTER (WHERE NOT relrowsecurity) AS rls_off FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '"'"'public'"'"' AND c.relkind = '"'"'r'"'"' AND c.relname IN (SELECT table_name FROM information_schema.columns WHERE column_name = '"'"'account_id'"'"' AND table_schema = '"'"'public'"'"')"'
```

Expect `rls_off = 0`. Also run the repo check from a workstation at the same commit:
`node scripts/check-rls-coverage.mjs`.

### 5d. Web role has no ownership and no DDL

```bash
$COMPOSE exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = '"'"'ai_fsm_web'"'"') AS owned_rel, (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = '"'"'ai_fsm_web'"'"') AS memberships"'
```

Expect `0|0`.

### 5e. RLS denies with no account context (as ai_fsm_web)

Read the web password from the env file on the host. Do not print it. Pass it into the
container as an env var.

```bash
set -a; . /opt/business/ai-fsm/env/.env; set +a
$COMPOSE exec -T -e PGPASSWORD="$AI_FSM_WEB_PASSWORD" postgres sh -lc \
  'psql -h 127.0.0.1 -U ai_fsm_web -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM clients"'
```

Expect `0`. If it returns the real count, RLS is not enforced for this role. Stop and roll back.

### 5f. RLS allows with account context (as ai_fsm_web)

Use an account id from the staging copy or from `SELECT id, name FROM accounts`
(as admin; confirm on host).

```bash
$COMPOSE exec -T -e PGPASSWORD="$AI_FSM_WEB_PASSWORD" postgres sh -lc \
  "psql -h 127.0.0.1 -U ai_fsm_web -d \"\$POSTGRES_DB\" -tAc \"SET app.current_account_id = '<ACCOUNT_A>'; SET app.current_role = 'owner'; SELECT count(*) FROM clients\""
```

Expect the real client count for account A (non-zero if A has clients).

### 5g. Cross-tenant read returns zero rows (as ai_fsm_web)

Needs two accounts (A and B). Run on the staging copy first. Confirm on host that B
exists. Do not create an account on production just to test this.

```bash
$COMPOSE exec -T -e PGPASSWORD="$AI_FSM_WEB_PASSWORD" postgres sh -lc \
  "psql -h 127.0.0.1 -U ai_fsm_web -d \"\$POSTGRES_DB\" -tAc \"SET app.current_account_id = '<ACCOUNT_A>'; SELECT count(*) FROM clients WHERE account_id = '<ACCOUNT_B>'\""
```

Expect `0`. Repeat for `estimates`, `invoices`, and `properties`. The repo covers this
at API level in `apps/web/lib/__tests__/api-tenant-isolation.integration.test.ts`
(run with `TEST_WEB_DATABASE_URL` pointed at `ai_fsm_web`).

Note: own-account reads fail under this role until blocker B4 in section 7 is closed.
A failure of an own-account read is expected at this stage. A cross-tenant leak is not.

### 5h. Application and worker smoke

- Health: `$COMPOSE exec -T web wget -qO- http://127.0.0.1:3000/api/health`. Expect
  `"db":"ok"`.
- Web logs: `$COMPOSE logs --since 10m web | grep -i 'permission denied'`. Expect none.
  Confirm on host.
- Worker: `$COMPOSE logs -f worker` shows polls and no authentication errors.
- App smoke on the staging copy first, then on production (flip doc, item 4): log in,
  My Day, open a client and property, create and price an estimate, submit the public
  booking form, open a client portal link, record a payment, and run the Square webhook
  and estimate respond paths. Confirm on host.

## 6. Rollback to the previous WEB_DATABASE_URL

Rollback changes only the web connection. No data changes. Migrations, roles and
grants stay in place (they are additive and harmless to leave).

1. In `/opt/business/ai-fsm/env/.env`, set `WEB_DATABASE_URL` back to the value
   recorded in section 2, step 1 (the admin URL, equal to `DATABASE_URL` before the
   cutover).
2. Recreate the web container so it reads the value:

```bash
cd /opt/business/ai-fsm/repo
COMPOSE_PROJECT_NAME=ai-fsm docker compose --env-file /opt/business/ai-fsm/env/.env -f infra/compose.garonhome.yml up -d web
$COMPOSE exec -T web wget -qO- http://127.0.0.1:3000/api/health
```

3. Confirm `db: ok` and that the app loads. Confirm on host.

Do not roll back the data with the restore script unless the cutover itself changed
data. A web-role failure does not write bad data, because RLS denies it. If the
failure was a bad write, use the data rollback in `DEPLOY.md` section 7 with the
backup from section 1.

Worker rollback (separate, if needed): set `WORKER_DATABASE_URL` to the admin URL and
run `$COMPOSE up -d worker`.

## 7. Blocker list: what is NOT converted

Per `docs/working/rls-web-tier-flip.md` (status 2026-11-08). Re-check each item against
the branch before the cutover. The flip doc and the code notes disagree in places, so
the status column is a claim to verify, not a fact.

Open (blocks the cutover):

- **B4. Raw query sites.** About 102 non-test web files make DB calls with no account
  context (no `withDbSession`, `queryForSession`, `queryOneForSession`, or
  `set_config`). Example: `api/v1/clients/[id]` GET. Recount before the cutover.
- **B5. Full verification under the role.** Every authenticated and token path, including
  sessionless and internal endpoints, must be tested under `ai_fsm_web`.
- **Still open, listed in the flip doc:**
  - `api/internal/sms` (inbound keyword flow, unscoped client and job writes).
  - `api/internal/sms/outbound` (client writes outside the comms insert).
  - `api/internal/push/day-review-reminder` (cross-account sweep over open days).
  - `api/internal/location` (large, unscoped reads).
  - The raw-query files in B4.

Converted on branch, but the flip doc still lists them as blockers. Confirm merged and
verified:

- **B1. Portal read-bootstrap.** Portal client, estimate and invoice routes,
  `requirePortalClient`, request-access, and portal session use the 204 resolvers
  (`issue/6-portal-pages`). Confirm on host that the branch is merged.
- **B2. Square webhook account lookup.** Uses `resolve_square_location_settings`.
  Confirm the in-transaction `set_config` runs before any other read.
- **B3. Public estimate respond.** Uses `resolve_estimate_share_account`. Confirm the
  account context is set before the UPDATE.

Other gates (open or in progress):

- Issue #6 and issue #15 are open on GitHub. Branch `issue/6-15-db-roles` and
  `issue/15-worker-grants` exist locally. Merge state: confirm on host and on origin.
- Migration 207 owner change: confirm applied on host (see section 3).
- Staging copy with two accounts: confirm exists.
- Backup encryption and offsite verification (issues #22, #24). Not a cutover blocker
  by repo rule, but a deploy-safety item.
- Draft PRs #31 and #32 touch tenant-safe intake media and security fixes. Confirm
  whether they are needed for this cutover.

Booking and intake already set context in-transaction. `attention_events` INSERT is
permissive (migration 185) so portal first-open telemetry is not dropped.

## 8. Decisions made in this runbook

- The cutover is an env change plus a deploy, not a separate step. The deploy already
  provisions the role, and the web container reads the URL at start.
- Rollback is an env change plus `up -d web`. No migration rollback is needed.
- The admin URL is recorded before the change, so rollback needs no lookup.
- Migration 207 is treated as the current resolver owner. The flip doc is out of date
  on this point.
