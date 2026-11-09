# RLS web-tier flip runbook (TASK-146, issue #6 and #15)

Turns the already-written RLS from documentation into enforcement by moving the
**web** container from the Postgres superuser to the restricted **`ai_fsm_web`**
role. This is the step that activates the RLS policies in migrations `003` and
`182`–`185`.

**Status (2026-11-08): NOT READY.** The role split for the worker is done (see
below). The web cutover is blocked by the items under "Blockers". Do not change
`WEB_DATABASE_URL` to the `ai_fsm_web` URL until every blocker is closed and the
verification steps pass on a staging copy.

## Model (decision record: ADR-024 in `docs/DECISION_LOG.md`)

| Service | Role | Attributes | Why |
|---|---|---|---|
| migrations, provisioning, scripts | `ai_fsm` (admin) | superuser | DDL and role provisioning need owner rights. `DATABASE_URL`. |
| web | `ai_fsm_web` (target) | NOSUPERUSER, NOBYPASSRLS | Every request sets `app.current_account_id`, so RLS enforces tenant isolation. **Not active yet**: `WEB_DATABASE_URL` still equals the admin URL. |
| worker | `ai_fsm_worker` | NOSUPERUSER, BYPASSRLS, DML on RLS tables only | Trusted cross-account sweeps (migration 185). No job sets account context, and most already query estimates, invoices and visits across accounts. |

Why the worker uses BYPASSRLS instead of per-account jobs or SECURITY DEFINER
sweeps: the worker runs about 15 cross-account sweeps. Per-account execution would
rewrite each one. One SECURITY DEFINER function per sweep is more reviewed surface,
more upkeep, and no more protection than a role with a narrow grant set. BYPASSRLS is
the smallest change that keeps the worker's behaviour. The bypass is confined to
`ai_fsm_worker`. The provisioner refuses a role whose bypass attribute is wrong, and
refuses any role with superuser, CREATEDB, CREATEROLE, replication, ownership, or
membership. The worker has no DDL. Its table grants are an explicit list in the provisioner
(ADR-024 addendum, 2026-11-09), checked by `scripts/check-worker-grants.mjs`, not the
web role's DML set on RLS tables.

Worker rule: because the worker bypasses RLS, a new worker sweep is **not** protected
by a policy. It must scope its own writes by `account_id`, or it must be a reviewed
cross-account job.

## Provisioning (what is implemented)

- `scripts/db-provision-runtime.sh` creates `ai_fsm_web` (NOBYPASSRLS) and
  `ai_fsm_worker` (BYPASSRLS). It grants DML on RLS tables and sequences, and
  EXECUTE on the login lookup for web only. Run it after migrations, once per role.
  `PROVISION_VIA_COMPOSE=1` runs psql inside the postgres service, which is needed on
  garonhome because postgres has no host port.
- `scripts/deploy-garonhome.sh` runs the worker provisioning every deploy, and web
  provisioning when `AI_FSM_WEB_PASSWORD` is set. It runs after migrations and before
  web and worker start.
- `infra/compose.garonhome.yml`: web reads `WEB_DATABASE_URL` and worker reads
  `WORKER_DATABASE_URL`. Both are required with no fallback. The deploy preflight
  fails early if they are missing.
- `infra/garonhome.env.example` documents both URLs and the role passwords. Values
  are placeholders. Real values live only in the host env file.

## Blockers before the web cutover (TASK-146)

The auth login path is RLS-safe (`app_login_candidates`). The rest is not:

1. **Portal read-bootstrap (P1).** `api/v1/portal/request-access`, the portal
   client, estimate and invoice routes, and `lib/portal/session.ts` read
   `clients`, `estimates` and `invoices` before any account context. Under
   `ai_fsm_web`, those reads return nothing. Fix: a bounded `SECURITY DEFINER`
   resolver (token or email to account), granted to `ai_fsm_web`, then set context.
2. **Square webhook account lookup (P1).** `api/webhooks/square` reads
   `integration_settings` by `locationId` with no context. Fix: a bounded lookup
   returning `account_id`, then `set_config` in the transaction.
3. **Public estimate respond (P1).** `api/v1/estimates/[id]/respond` updates
   `estimates` from a signed token before context. Fix: resolve the account from the
   token, then `set_config`, before the UPDATE.
4. **Raw query sites (new finding, 2026-11-08).** About 102 non-test files in
   `apps/web` make DB calls and never set account context (heuristic: no
   `withDbSession`, `queryForSession`, `queryOneForSession` or `set_config` in the
   file). Example: `api/v1/clients/[id]` GET uses `queryOne` with `account_id` in the
   SQL. Under `ai_fsm_web` it returns 404 for the owner's own client. Fix: move each
   read to a session helper, or set context in the same transaction.
5. **Verify every authenticated and token path under the role** (the checklist below),
   including sessionless and internal endpoints.

Booking and intake already `set_config` in-transaction. `attention_events` INSERT is
permissive so portal first-open telemetry is not dropped (migration 185).

## Change 1, 2, 3: already implemented, but web stays on the admin URL

- Env: `WEB_DATABASE_URL` equals `DATABASE_URL` (admin) until the cutover. The cutover
  is changing that one value to the `ai_fsm_web` URL in the host env file, then running
  `docker compose ... up -d web`.
- Compose: `web.environment.DATABASE_URL: ${WEB_DATABASE_URL:?...}` (implemented).
- Deploy: `scripts/deploy-garonhome.sh` provisions roles after migrations, before build.
  The cutover does not need a separate provisioning step.

## Verification

Automated (scratch Postgres 16, all migrations applied, `ai_fsm_web` and `ai_fsm_worker`
provisioned by the script):

- `apps/web/lib/__tests__/db-isolation.integration.test.ts` (`TEST_RUNTIME_DATABASE_URL`):
  the role is not superuser or BYPASSRLS, cannot create tables, sees nothing with no
  context, and reads and writes only its account with context.
- `apps/web/lib/__tests__/api-tenant-isolation.integration.test.ts`
  (`TEST_WEB_DATABASE_URL`): account A cannot read or change account B's client or
  property through the real route handlers. Run it against `ai_fsm_web` at the cutover.
  Own-account reads will fail there until blocker 4 is fixed.
- `services/worker/src/worker-role.integration.test.ts` (`TEST_WORKER_DATABASE_URL`): the
  worker role runs a cross-account sweep. The full worker integration suite also passes
  when run as `ai_fsm_worker`.
- `node scripts/check-rls-coverage.mjs`: every account table has RLS and a policy.
- `node scripts/check-worker-grants.mjs`: every table the worker's SQL touches is in its grant list.

Manual, on garonhome, before the cutover (owner):

1. Role attributes, as the admin role:
   `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'ai_fsm%'`
   Expect `ai_fsm_web` f/f and `ai_fsm_worker` f/t.
2. RLS denies with no context, as `ai_fsm_web`: `SELECT count(*) FROM clients` returns 0.
3. RLS allows with context: `SET app.current_account_id='<acct>'; SET app.current_role='owner';`
   then `SELECT count(*) FROM clients` returns the real count.
4. App smoke on a staging copy with `WEB_DATABASE_URL` on `ai_fsm_web`: log in, load
   My Day, open a client and property, create and price an estimate, submit the public
   booking form, open a client portal link, record a payment, and complete the Square
   webhook and estimate respond paths. All must work.
5. Worker: `docker compose ... logs -f worker` shows polls running, with no
   authentication errors.

## Rollback

Point web back at the admin URL and restart. No data changes:

```bash
# in the host env file: WEB_DATABASE_URL=<the same value as DATABASE_URL>
COMPOSE_PROJECT_NAME=ai-fsm docker compose -f infra/compose.garonhome.yml up -d web
```

Worker rollback: set `WORKER_DATABASE_URL` to the admin URL and restart the worker.

## Gate wiring

`scripts/gate.sh` already runs `node scripts/*.test.mjs`, which covers
`check-rls-coverage.test.mjs`. The direct coverage check runs next to the migration
prefix check.
