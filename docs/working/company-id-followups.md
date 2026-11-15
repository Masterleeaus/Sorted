# company_id follow-ups after migration 205 (issue #26)

Status as of 2026-11-15, branch `claude/sorted-hygiene-issues-34-4-6-12-15-26`.

## Verified

- Migration `db/migrations/205_company_foundation.sql` is on `origin/main`.
- Applied to a scratch Postgres 16 with migrations through 208. Result:
  - `companies` exists (1:1 with `accounts`, same id), with RLS on.
  - 74 real tables have `company_id uuid` with an index and a NOT VALID foreign key. None is NOT NULL yet.
  - Two names with `account_id` are views, not tables: `property_timeline_v` and `vehicle_cost_summary`. They have no `company_id` by design. They need a company-aware rewrite when the tables move.
- `company-foundation.integration.test.ts` (4/4) and `db-company-context.unit.test.ts` (11/11) pass.
- Migration number 206 is absent from `db/migrations/`. Nothing references it. Confirm with the owner whether it was reserved for a step that was not merged.

## Done in this pass

- `apps/web/lib/db/audit.ts` (`appendAuditLog`) writes `company_id` explicitly, equal to `account_id`. Unit test: `apps/web/lib/db/__tests__/audit.unit.test.ts`. The SQL shape was also checked by hand on the scratch DB, in a rolled-back transaction.

## Remaining (not small; each needs its own change)

1. ON CONFLICT targets keyed on `account_id` (13 source files, 14 statements, excluding tests):
   - `apps/web/app/api/v1/expenses/import/commit/route.ts` (2)
   - `apps/web/app/api/v1/integrations/square/route.ts`
   - `apps/web/app/api/v1/materials/route.ts`
   - `apps/web/app/api/v1/materials/supplier-preferences/route.ts`
   - `apps/web/lib/attention/emit.ts`
   - `apps/web/lib/communications-log.ts`
   - `apps/web/lib/operations/business-day.ts`
   - `apps/web/lib/operations/time-clock.ts`
   - `apps/web/lib/pricing/settings.ts`
   - `apps/web/lib/push/subscriptions.ts`
   - `apps/web/lib/travel/settings.ts`
   - `services/worker/src/notification/enqueue.ts`
   - `services/worker/src/notification/governor.ts`

   These need matching unique indexes on `company_id` first. Today there are 35 unique indexes keyed on `account_id` and none on `company_id`. Changing a target without its index breaks the insert at runtime. Some targets are partial indexes (`WHERE ...`), and the index must match the predicate exactly.
2. Unique indexes and constraints keyed on `account_id`: 35 (for example `users (account_id, email)`, `invoices (account_id, invoice_number)`, `vehicles (id, account_id)`). Each needs a company-keyed twin before the ON CONFLICT changes above.
3. Session context: `app.company_id` is set by `withDbSession` (`apps/web/lib/db.ts`) and by the worker helper `services/worker/src/company-context.ts`. RLS policies still read `app.current_account_id`. Company-based policies are a later step.
4. Code that still queries by `account_id`: 61 lib files and 135 API route files reference `account_id`. Most filter with the same value as `company_id`. Converting them is a per-module change.
5. Later steps named in migration 205 and not started: NOT NULL on `company_id`, validating the NOT VALID foreign keys, company-based RLS policies, dropping `account_id`, and removing the dual-column trigger.
6. Central reconciliation (issue #26 tasks 1 and 3): the Central canonical table registry is not in this repository. The full table registry and the `companies`/identity mapping cannot be checked from here.

## Not changed by this pass

- No migration was added. Nothing was dropped or renamed.
- No RLS policy was changed.
