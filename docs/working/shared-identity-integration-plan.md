# Shared identity and company context: integration plan (issue #28)

Date: 2026-11-15
Issue: #28 (Sorted, Supercharged and LMS on shared identity and company context)
Scope of this note: what main has now, and the gaps left. It is a plan, not a build.
No cross-app code is part of this change.

## What main has (checked on 2026-11-15, commit d8fac56)

- Only one app in the repo: `apps/web` (Sorted Field). There is no `apps/desk` and no LMS code. Supercharged source is not on main.
- Company key (issue #26, partly done): migration `db/migrations/205_company_foundation.sql` adds `companies` (same id as `accounts`) and a `company_id` column on every table that has `account_id`. A trigger keeps the two columns equal. Foreign keys are NOT VALID. Nothing is renamed or dropped.
- Query context: `apps/web/lib/db.ts` sets `app.company_id` next to `app.current_account_id` (`withDbSession`). `assertCompanyId` fails closed on a missing or malformed company id.
- Local sign-in only: `apps/web/lib/auth/session.ts` creates and reads Sorted's own session cookie. There is no OIDC client, no Central token check and no Logto code on main.
- Central work (PR #33, draft) is not on main. It carries an account-to-company mapping (its migration is numbered `202`, which clashes with the Square migration `202_square_payment_link_match.sql`). Its body says no real Logto client exists and production mapping is not verified.
- Canonical docs (`docs/canonical/`) do not mention Supercharged or LMS. Product scope for those apps is therefore not yet written down.

## Remaining gaps (in order)

1. Scope decision (owner). Write the Supercharged and LMS roles into `docs/canonical/PRODUCT_VISION.md` and `ROADMAP.md`, or record a decision that they stay outside this repo. Nothing else should start before this, because the docs rule says scope changes update canonical docs first.
2. Central contract (owner plus Central repo). Agree the claims Central issues: user id, company id, membership role, and the signed link assertion. Central issues #26 and #35 to #42 are the open items. Until they close, Sorted cannot verify identity from Central.
3. Migration chain. Renumber the PR #33 migration when it is rebased (do not renumber applied files). Then run the company-foundation steps in order: NOT NULL, FK validation, company-based policies, and only then drop `account_id`. Each step is a separate migration and needs a rollback.
4. Code conversion. Move raw queries from `account_id` to `company_id`. The web role cutover (#6) also blocks on about 102 files that lack account context. Do these two together to avoid double work.
5. Session adapter. Map a verified Central session to the local session payload. Do not link existing Sorted accounts by email alone. Use an explicit, owner-approved mapping step.
6. Supercharged source. Bring `apps/desk` onto main only after its own identity and company checks pass (lane: Supercharged). Keep its name and identity; do not rename it to Sorted.
7. LMS. Out of this repo. Only the identity contract (steps 2 and 5) applies here.
8. Config and deploy. Centralise shared config, root build and test commands, and the rollback path. No production host or domain change in this step.

## Owners

- Scope and identity decisions: owner (Jason).
- Central contract and Central issues #26, #35 to #42: owner plus Central repo.
- Migration chain and company conversion: Sorted engineering lane.
- Supercharged source and checks: Supercharged lane.
- Production host steps: owner, on garonhome.local.

## Not done here

- No code, migration or route was added.
- No Central call was tested. Central is not reachable from this change.
- Issue #28 stays open until steps 1 to 5 are done and tested.
