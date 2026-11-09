# Operational invariants (read before auditing, building infra, or deploying)

Agent-facing working knowledge that is **not** in the canonical docs and is
painful to re-derive. These are operational facts, not product/domain rules
(those stay in `docs/canonical/`). TASK-123.

## Deploy lag — check `origin/main` AND `/opt`, never the local checkout
Production runs on **garonhome** via `infra/compose.garonhome.yml`. The prod
checkout at `/opt/business/ai-fsm/repo` and the running container can lag
`origin/main` by many PRs. The local dev checkout here is usually an **old
feature branch**. Before answering "what's built / what's live", check both:
- `git fetch origin main && git log origin/main -1` (what's merged)
- `ssh garonhome 'cd /opt/business/ai-fsm/repo && git log -1'` (what's deployed)

Trusting the local checkout mis-reported feature status **twice**. Always branch
new work off `origin/main`, not the local HEAD.

## Deploy
Production procedure: `DEPLOY.md` (authoritative). Entrypoint:
`bash scripts/deploy.sh [branch]` → ssh garonhome → reset `/opt/business/ai-fsm/repo`
to `origin/<branch>` → `scripts/deploy-garonhome.sh` runs SQL migrations (idempotent,
tracked in `schema_migrations`) → rebuilds web+worker → waits for `/api/health`.
The deploy script does **not** take a backup; run `scripts/backup-garonhome.sh` first.
Deploying is prod and gated; do it only on explicit say-so. After merging, the
phone/PWA (`app.mydovetails.com`) does not change until this runs.

**Not the production path:** `/home/admin/apps/ai-fsm`, the systemd unit `ai-fsm`,
`start-production.sh`, and any UI-ZIP overlay. These are legacy (see `DEPLOY.md` §6).
Never deploy by copying files into them.

## Two runtimes, asymmetric egress
The **worker** container is on the `internal: true` network and has **no
internet egress**. Anything calling an external service — Web Push (FCM/Apple),
Anthropic, webhooks — **must run on the web tier**. `lib/push/send.ts` sends on
its own pooled connection; do not route external sends through the
worker-drained `notification_queue`. Email works from the worker only because it
targets a LAN SMTP relay.

## DB roles: web is still superuser-bound; the worker has its own role
Roles (provisioned by `scripts/db-provision-runtime.sh`, deployed by `DEPLOY.md` section 4a):
- **Admin** `ai_fsm`: superuser. Migrations, provisioning, scripts. `DATABASE_URL`.
- **Web** (`WEB_DATABASE_URL`): still the admin URL. `ai_fsm_web` is provisioned NOBYPASSRLS
  but is not in use. Until the cutover gate in `docs/working/rls-web-tier-flip.md` clears,
  RLS is bypassed for web queries. Code sets `app.current_account_id` (`withDbSession`,
  the location ingest route, `lib/push/send.ts`) and **every query scopes by `account_id`**.
  Keep both. About 100 web files make DB calls without setting account context, so do not
  flip the web URL early.
- **Worker** (`WORKER_DATABASE_URL`): `ai_fsm_worker`, BYPASSRLS, NOSUPERUSER, DML on the
  explicit table list in `scripts/db-provision-runtime.sh` (SELECT only on `accounts`), no DDL or ownership. Cross-account sweeps need this bypass. Policies do not
  protect worker writes, so each worker job must scope by `account_id` or be a reviewed
  cross-account job. Decision record: ADR-024.

Do not assume RLS isolates web requests until the web cutover has run.

## garonhome also runs Home Assistant
Scheduled interrupts (RAM start-day, home-arrival + 8 PM day-review) are **HA
rest_commands** hitting `/api/internal/*`, not the worker (no egress). HA config:
`~/docker/homeassistant/{automations,rest_commands}.yaml`; apply via a
homeassistant container restart.

## Migrations: numbers collide, applied files are immutable
`db/migrations/NNN_*.sql` use sequential integer prefixes that **collide across
branches** (175 shipped twice). Applied filenames are **immutable** — renaming
one makes the deploy treat it as new and re-run it, hitting its unconditional
`CREATE TRIGGER` and failing. Claim the next number at **merge** time from the
highest existing; never renumber an applied migration. CI (`scripts/check-migration-prefixes.mjs`,
TASK-128) fails a PR that adds a new file onto an existing prefix; the current
collisions are grandfathered by exact filename.

## Backlog gating + merge gates
New work needs a `docs/backlog/` task first, citing a ROADMAP phase (0–4 or
`cross-cutting`; see the Phase→Epic map in `docs/canonical/ROADMAP.md`). Add its
row to `docs/backlog/README.md` and advance "Next available ID". Merging to main
requires conversation-resolution + resolved Codex threads (`mergeStateStatus`
CLEAN/UNSTABLE). After a merge, a stale PR branch goes `BEHIND` — update it, don't
force.

## Tests + running them locally
- **unit** — no infra: `pnpm test:unit`.
- **integration** (Tier 3, `*.integration.test.ts`) — direct-DB suites need
  `TEST_DATABASE_URL`; HTTP suites also need a running server + `TEST_BASE_URL`
  (they `skipIf` absent). Bring the stack up + run them with
  `bash scripts/dev-stack.sh integration` (see that script).
- **e2e** — Playwright; runs in CI (`e2e-smoke`).
