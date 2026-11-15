# Production readiness (Sorted)

Date: 2026-11-15
Branch: `issue/prod-readiness-doc` (HEAD `9d6b8d0`, contains `claude/relaxed-ride-p7km75`)
Sources: GitHub open issues (39) and open PRs (5) read on 2026-11-15, plus the files cited on each line.

How to read this file:
- "Confirm on host" means the repo cannot show it. The owner checks it on garonhome.local or in GitHub.
- "PR #31 claims" means the PR body says it closes an issue. This pass did not confirm that claim.
- Nothing here is a deploy or merge decision. Deploying is production and needs owner approval (`DEPLOY.md` section 4).

Open items at a glance: 39 open issues, 5 open PRs. Groups A to F below.

---

## A. Done on this branch (in the code here, not yet on main)

Everything in this group is in commits on `issue/prod-readiness-doc`. It reaches `main` only when PR #31 merges.

- #1 Repo hygiene: 18 MB Desk-Chatbot ZIP removed (commit `4067d79`). Generated tsbuildinfo no longer tracked (`3015d3e`, `dd8bc64`). Issue still open; PR #31 claims it.
- #7 Deploy target unified on the garonhome Compose path (commit `0a49bbf`). `DEPLOY.md` reconciled 2026-11-08. Host side is in D.
- #8 Titan Go recorded as the UI layer, not product identity (commit `f7fdd49`). See `docs/working/titan-go-identity-decision-2026-11-08.md`.
- #9 Titan donor provenance recorded (commit `9cb3477`). See `docs/working/titan-donor-provenance.md`.
- #11 Bundled compatibility asset provenance inventoried (commit `cbaaea4`). The license decision is still open (C).
- #14 Path traversal fixed in visit and vault media uploads (commit `75d67bb`).
- #16 Multipart bodies bounded before buffering (commits `1a90479`, `6577e0d`). See `docs/working/upload-body-limits.md`.
- #18 HTML email values escaped (commit `888d0c4`).
- #19 Intake invite consumed atomically: `UPDATE intake_invites SET used_at = now() WHERE id = $1 AND used_at IS NULL` at `apps/web/app/api/intake/[token]/route.ts` line 194. No test was run here.
- #21 Portal sign-in fails closed when the account cannot be resolved (commit `888d0c4`).
- #22 Backup dumps and uploads encrypted with gpg AES-256 before offsite copy (commits `57750d4`, `0798d6c`; `scripts/backup-garonhome.sh` lines 126 to 143). The issue is still open. The offsite copy is not verified by this pass (see F).
- #23 Square webhook payments matched to the exact pending link and amount (commit `c35f8d5`).
- #24 Backup runs fail on incomplete sets and verify offsite copies (commits `0b67ee7`, `042fee9`). The alert half needs a host setting (D).
- #15 Worker RLS reconciled: `ai_fsm_worker` role with BYPASSRLS and an explicit grant list in `scripts/db-provision-runtime.sh`. `scripts/check-worker-grants.mjs` exists. Decision record ADR-024 addendum (cited in `DEPLOY.md` section 4a). Host state is in D and F.
- #17 Client IP from a trusted proxy boundary: `TRUSTED_PROXY_COUNT`, default 0, in `apps/web/lib/rate-limit.ts`. Design note: `docs/working/trusted-proxy-client-ip.md`. The garonhome value is in D.
- #6 (part): token resolvers in migration `204_token_resolvers.sql`, plus `207_token_resolver_owner.sql`. The blocker list is still open (E).
- #5 (part): customer photo upload, storage, cleanup and staff list are built on branch `issue/5-intake-followups` (`docs/working/intake-photo-attachments.md`, line 3). No open PR for that branch was found. Confirm it is merged or pushed.
- Titan known failures documented: 18 tests kept as known debt, not deleted or skipped (`docs/working/titan-known-failures.md`, commit `9d6b8d0`).

## B. In open PRs, not on this branch

- PR #31 (draft, base `main`, head `claude/relaxed-ride-p7km75`, 248 commits ahead of main). Carries all of group A to main. Its body says `lint` is red because `pnpm knip` fails (#4). Its body says it closes #1, #2, #3, #7, #8, #9, #11, #13, #14, #16, #17, #18, #19, #20, #21, #22, #24, #25 when merged. Those closures are claims, not checked here.
- PR #30 (not draft, base `main`, head `fix/issue-29-sorted-field-identity`). Starts the #29 Sorted Field rebrand (partial, per its body). Also a partial repair of the onboarding import graph for #3 (its body says "Pass 5" and "partial"). Merge state: unstable.
- PR #32 (draft, base `claude/relaxed-ride-p7km75`, head `fix/backup-preflight-health-20261109`). Adds migration `209_intake_media_tenant_integrity.sql` and authenticated intake photo retrieval. Its body says PostgreSQL-verified. It touches #5 and #6 by title; its body cites no issue numbers. Migration 209 is chosen to avoid 204, 205, 207 and 208 (PR body).
- PR #33 (draft, base `main`, head `feat/central-product-oidc-adapter-pass25`). Central issue Masterleeaus/Central#26 side: account identity mapping (migration `210`), company-to-account resolution, JWT handoff guard. Its body says no public SSO endpoint, no real Logto client, and production mapping not verified. Migration number was `202` and collided with `db/migrations/202_square_payment_link_match.sql`. Renumbered to `210` (next free after main 208 and open claims 209 on PRs #32 and #55). File is `docs/pending/210_central_account_identity_links.sql`, not in `db/migrations`.
- PR #43 (draft, base `claude/relaxed-ride-p7km75`, head `issue/runbook-cutover`, 2 commits). Adds `docs/working/web-role-cutover-runbook.md` (commit `af9f2f4`). The runbook is not on this branch. It also adds a general per-IP rate limit on auth and public paths (60 requests per minute for public paths, 10 for auth, webhooks exempt). The PR body cites no issue number. It relates to #20 and #6. Its runbook says the web cutover is NOT READY.

## C. Owner decisions still open

- #12 License and distribution boundary. No LICENSE file exists in the repo (checked). Owner decision needed.
- #4 Knip findings. `docs/working/knip-exclusions.md` lists two open decisions: delete the 202 unused files after review, or keep them excluded with a reason (`docs/working/knip-unused-review-list.txt`). Also: keep or remove the 10 `verticals/licensed-trades` modules, which only tests that no script builds can load.
- Titan known failures: each of the 18 entries needs one of three things: a missing module restored from a checksummed source, a product spec, or a decision to delete the test (`docs/working/titan-known-failures.md`, last section).
- #6 and #15 web cutover go or no-go. Owner decision once the blockers in group E are closed and verified on a staging copy (`docs/working/rls-web-tier-flip.md`, "Blockers" and "Verification").
- #5 Intake photos: retention length and the ROADMAP exception are open for the owner (`docs/working/intake-photo-attachments.md`, "Open decisions"). Commits `fa803f9` and `eaeec25` record the roadmap exception.
- #34 Remove the committed archive. 81 files are still tracked under `docs/archive/`. Owner approval needed after the secrets check the issue asks for.
- #28 and #29 Shared identity and brand (Sorted, Supercharged Desk, LMS). Owner direction needed. No decision record was found in the repo. Confirm.
- Central items #26 and #35 to #42: the Central side and its operator provisioning are owner decisions (PR #33 body lists Logto client and trusted operator provisioning as unverified).

## D. Host steps the owner must run (not run by this pass)

Each step below is in the repo's runbook. None has been run from here.

1. Take a backup before any deploy: `ssh garonhome 'cd /opt/business/ai-fsm/repo && bash scripts/backup-garonhome.sh'`, then check the dump is non-zero (`DEPLOY.md` section 3).
2. Create the backup passphrase file once, `/opt/business/ai-fsm/env/backup.passphrase` (chmod 600), and store a copy in the password manager (`docs/BACKUP_RUNBOOK.md`, "One-time setup" and "Encryption and key management"). The encrypted sets cannot be opened without it.
3. Set `BACKUP_ALERT_CMD` in `/opt/business/ai-fsm/env/.env`. Without it, an incomplete backup only prints to the log (`docs/BACKUP_RUNBOOK.md`, "Alert hook"). This closes the alert half of #24.
4. Confirm the nightly cron `0 2 * * *` runs `backup-garonhome.sh`, and the rclone remote `googledrive` works. Confirm on host (`DEPLOY.md` section 3; `docs/BACKUP_RUNBOOK.md`, "Offsite").
5. Run a restore drill and record a `DRILL-<date>` entry in `docs/DECISION_LOG.md` (`docs/BACKUP_RUNBOOK.md`, "Validation Drill"). `DEPLOY.md` section 7 says a recent drill is unverified.
6. Set the role variables in the host env file: `AI_FSM_WORKER_PASSWORD`, `WORKER_DATABASE_URL`, and `WEB_DATABASE_URL` (equal to `DATABASE_URL` until the cutover) (`DEPLOY.md` section 4a). Then run the role query and the worker grant query in the same section. Expect `ai_fsm_worker` with rolbypassrls true, and 30 tables with a worker privilege. Confirm on host.
7. Set `TRUSTED_PROXY_COUNT` to the number of proxies in front of the app on garonhome (`docs/working/trusted-proxy-client-ip.md`). Default 0 ignores forwarded headers. Confirm the right value on host.
8. Check the health path end to end: `curl -sf http://fsm.garonhome.local/api/health` through Nginx Proxy Manager, the public `APP_URL` through the Cloudflare Tunnel, and the 5-minute monitor `scripts/healthcheck-garonhome.sh` in cron with its ntfy topic (`DEPLOY.md` section 5). Confirm on host.
9. Retire the legacy path if it still runs: systemd unit `ai-fsm`, `start-production.sh`, and `/home/admin/apps/ai-fsm` (`DEPLOY.md` section 6b). Confirm on host.
10. Turn on branch protection for `main` with the required checks `lint`, `typecheck`, `build`, `test`, `e2e-smoke` (`docs/CI_GOVERNANCE.md`; issue #10). The API returned 403 from this session, so the current setting is unverified.
11. Check the host's applied migrations include 204, 205, 207 and 208 once the code is deployed (`DEPLOY.md` section 5, `schema_migrations`). Confirm on host.
12. Production deploy of this work: only after PR #31 merges and the owner says so. Use `bash scripts/deploy.sh main` after the backup in step 1 (`DEPLOY.md` section 4).

## E. Code still open

- #6 Least-privilege web role. The flip runbook lists these blockers (`docs/working/rls-web-tier-flip.md`, "Blockers"):
  - Blockers 1 to 3 (portal reads, Square lookup, estimate respond) have code in migration 204 and routes converted (per the doc's "Token resolvers" section). Verify under `ai_fsm_web` before calling them closed.
  - Blocker 4: about 102 non-test files in `apps/web` make DB calls with no account context (heuristic in the doc). Not done.
  - Blocker 5: verify every authenticated and token path under the web role. Not done.
  - Internal endpoints still open per the doc: `api/internal/sms`, `api/internal/sms/outbound`, `api/internal/push/day-review-reminder`, `api/internal/location`.
- #4 Knip. The 2026-11-09 pass says `pnpm knip` exits 0, and the 2026-11-08 pass reports 202 unused files and 0 unresolved imports (`docs/working/knip-exclusions.md`). Unused exports (201) and types (377) are warnings only. PR #31 says knip fails. See F.
- #25 CSP. `unsafe-eval` is now dev-only (`apps/web/middleware.ts` line 20), but `'unsafe-inline'` is still in `script-src` on every environment. The issue asks to reduce inline allowances too. Open. `docs/working/csp-inventory.md` lists the inline sources.
- #20 Rate limiting. Intake routes already call `apps/web/lib/rate-limit.ts`. PR #43 adds the general auth and public limits. Public intake-token submission limits are only partly covered. Confirm after PR #43 merges.
- #13 Workflow runtimes. Workflows use `actions/checkout@v5`, `actions/setup-node@v5`, `pnpm/action-setup@v5`, `actions/cache@v5`, `actions/upload-artifact@v6`, and `anthropics/claude-code-action@v1` (`.github/workflows/`). Whether each runs on the Node 24 runtime is not shown in the repo. Confirm in the Actions run logs.
- #2 Titan role mockups. PR #31 claims it closes this. A search of `apps/web/app` for "mockup" found no match. Not confirmed.
- #3 Onboarding import graph and typecheck. PR #30 repairs part of it (B). PR #31 claims the rest. Not confirmed here.
- #26 Shared company_id schema and Central migration chain. Migration `205_company_foundation.sql` exists on this branch. The rest of the chain is not verified.
- #27 Supercharged Desk Marketing and Inbox to shared company and customer records. No code evidence found in this pass.
- #28 Shared identity and company context across Sorted, Supercharged and LMS. Open, see C.
- #29 Sorted Field rebrand. Partial in PR #30 (B). Open.
- #34 Committed archive: 81 files still tracked under `docs/archive/`. Open.
- #35 to #42 Central integration (session adapter, link assertions, OIDC sign-in, service calls, feature flags and outbox, tenant model). None is implemented on this branch. PR #33 covers part of #35 and #36 (B). Others are open with no code in this branch.
- #44 Upgrade plan. Open. No file was checked.
- Migration numbering. `202` was used twice; PR #33 now uses `210`. Migration `206` is missing from the sequence on this branch. Per `ai/INVARIANTS.md`, claim the next number at merge time. Do not renumber applied files.
- Owner decision on backup recovery: the encryption code is in (A), but the runbook on PR #43 still says #22 and #24 are open. That is the issue state, not the code state. Close the issues after PR #31 merges and the host steps in D are done.

## F. Verification not run

- `pnpm knip` exit status on this branch. Not run here. Docs disagree: PR #31 says it fails, `docs/working/knip-exclusions.md` (2026-11-09) says it exits 0.
- Titan platform test baseline. Not run here. `docs/working/titan-known-failures.md` (2026-11-15) says 1580 tests, 18 fail. `docs/working/knip-exclusions.md` (2026-11-09) says 1174 tests, 76 fail. The newer doc should win after one run: `pnpm --filter @titan-zero/titan-platform test`.
- `pnpm gate:fast` and `pnpm gate` (`CLAUDE.md`). Not run here. Typecheck was not run on purpose (memory limits).
- Repo scripts that gate RLS, grants and migrations: `scripts/check-rls-coverage.mjs`, `scripts/check-worker-grants.mjs`, `scripts/check-migration-prefixes.mjs`. Not run here.
- Backup script simulation: `bash scripts/test-backup-garonhome.sh` (`docs/BACKUP_RUNBOOK.md`, "Integrity"). Not run here.
- Integration tests for RLS and tenant isolation (`apps/web/lib/__tests__/db-isolation.integration.test.ts`, `api-tenant-isolation.integration.test.ts`, `services/worker/src/worker-role.integration.test.ts`). Not run here (`docs/working/rls-web-tier-flip.md`, "Verification").
- Offsite backup contents and sha256 check on Drive. Confirm on host (`docs/BACKUP_RUNBOOK.md`, "Operator check").
- Issue #42: end-to-end integration against Central and shared PostgreSQL. Open P0. Not run.
- CI `e2e-smoke` on the current head. Not run.
- Production state (commit deployed, migrations applied, health). Confirm on host. The repo does not show it (`ai/INVARIANTS.md`, "Deploy lag").

---

## Source notes (conflicts found)

- `docs/working/web-role-cutover-runbook.md` is not on this branch. It is on PR #43 (`issue/runbook-cutover`).
- The PR #43 runbook says backup encryption and offsite verification are open (#22, #24). The code on this branch has both (A). The issues are still open because the work has not merged.
- PR #31 says the lint check is red because of knip. `docs/working/knip-exclusions.md` says knip exits 0 as of 2026-11-09. One run settles it (F).
- Two different Titan test baselines are on record (F).
- `docs/working/rls-web-tier-flip.md` says "NOT READY" as of 2026-11-08. Migration 204 and the converted routes were added later in the same doc. Blocker status needs a fresh check (E).
