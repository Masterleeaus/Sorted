# Migration prefix audit (grandfathered duplicates)

Scope: the seven `db/migrations/NNN_` prefixes that `scripts/check-migration-prefixes.mjs` grandfathers
(100, 137, 141, 142, 153, 162, 175). This is a read-only audit. No migration was renamed, edited, or merged.

## How the runner orders files

`DEPLOY.md` (section 4, step 3) says `scripts/deploy-garonhome.sh` applies each `db/migrations/*.sql` not yet
recorded in `schema_migrations`, "in filename order", with `ON_ERROR_STOP=1`. Tracking is by full filename.
Two consequences for this audit:

- Two files that share a prefix run in the order of their suffixes. Lexical order is therefore the only
  ordering a pair gets from the runner.
- Renaming an applied file makes the runner treat it as new and re-run it. `ai/INVARIANTS.md` gives the
  consequence: an unconditional `CREATE TRIGGER` would then fail.

## Method

For each pair:

1. Listed the tables, columns, indexes, policies, triggers and functions each file creates or alters.
2. Checked whether either file references an object that only its sibling creates (column, index, policy,
   trigger, function, table). A scripted check over the `ADD COLUMN`, `CREATE INDEX`, `CREATE TABLE`,
   `CREATE POLICY`, `CREATE TRIGGER` and `CREATE FUNCTION` names found no sibling reference in any pair.
3. Checked each file's external dependencies (helpers and tables) against earlier-numbered files.
4. Checked whether any file outside the pair touches the same tables, to judge the cost of a rename.
5. Checked for references to the filenames elsewhere in the repo.

## Findings per prefix

| Prefix | Files | Tables touched | Depend on each other? | Does lexical order matter? |
|---|---|---|---|---|
| 100 | `100_booking_request_pricing_mode.sql`, `100_comms_log_dedup.sql` | `booking_requests` / `communications_log` | No | No. The files touch different tables. |
| 137 | `137_accounts_day_review_settings.sql`, `137_project_work_order_visit_schema.sql` | `accounts` / `work_orders`, `visits` | No | No. The project file is internally ordered (constraints before backfill), which does not involve the sibling. |
| 141 | `141_invoice_source_visit.sql`, `141_vehicle_session_capture_method.sql` | `invoices`, `audit_log` / `vehicle_sessions` | No | No. |
| 142 | `142_client_square_customer_fields.sql`, `142_invoice_line_item_source_expense.sql` | `clients` / `invoice_line_items` (refs `expenses`) | No | No. |
| 153 | `153_booking_request_funnel.sql`, `153_communications_outcome_received.sql` | `booking_requests` (reads `estimates`) / `communications_log` | No | No. |
| 162 | `162_expense_commercial_tag.sql`, `162_materials_catalog_stats.sql` | `expenses` / `materials_price_book` | No | No. |
| 175 | `175_capture_evidence.sql`, `175_push_subscriptions.sql` | `capture_evidence` / `push_subscriptions` (both new) | No | No. Both use helpers defined in `003_rls_policies.sql` and `update_updated_at_column` from `001_core_schema.sql`. |

Notes:

- The first differing character inside each pair is a letter (`a`/`p`, `i`/`v`, `c`/`i`, `b`/`c`, `b`/`c`,
  `e`/`m`, `c`/`p`). Any sort collation therefore gives the same order, so the runner's result does not
  depend on locale.
- Helper functions used by the 175 pair are defined in `003_rls_policies.sql` (`app_user_id`, `app_account_id`,
  `app_role`) and `001_core_schema.sql` (`update_updated_at_column`), so both files depend only on earlier
  numbers.
- `175_push_subscriptions.sql` creates `trg_push_subscriptions_updated_at` without `IF NOT EXISTS`. Renaming
  that file would make a re-run fail, as `ai/INVARIANTS.md` warns.
- Later files touch some of the same tables (for example `invoices`, `accounts`, `work_orders`, `visits`).
  Those files are numbered higher, so they run after both siblings under any ordering. They do not depend on
  the order of the pair.
- The git history cannot show which files were applied in production. All fourteen files were added in one
  commit (`685401b`, "Initial import of ai-fsm app"), so creation order is not recoverable from git.
  Applied state lives only in each environment's `schema_migrations` table.
- Filename references outside `db/migrations/`: `scripts/check-migration-prefixes.mjs` (the allowlist), and
  several `docs/superpowers` and `docs/archive` pages (plans, specs, task records). A rename would leave those
  references stale. The docs themselves are not affected at runtime.

## Recommendation per prefix

| Prefix | Recommendation | Reason |
|---|---|---|
| 100 | **Keep** both | Independent. Renaming an applied file re-runs it. |
| 137 | **Keep** both | Independent. Both are referenced by specs and plans. |
| 141 | **Keep** both | Independent. |
| 142 | **Keep** both | Independent. |
| 153 | **Keep** both | Independent. |
| 162 | **Keep** both | Independent. Both are referenced by archived task records. |
| 175 | **Keep** both | Independent. `175_push_subscriptions.sql` has an unconditional `CREATE TRIGGER`, so a rename would fail a re-run. |

Merge: not recommended for any prefix. The pairs share no dependency, so merging gains nothing and would
rewrite applied filenames.

Rename: not recommended in this pass. Applied state is not visible in the repo, so a file cannot be shown to
be unapplied in every environment. If an environment ever shows a grandfathered file as unapplied, rename that
file in its own PR and only after confirming its `schema_migrations` row is absent everywhere.

Going forward, the existing rule applies: claim the next free number at merge time. The highest existing
prefix is `208` (`208_notification_queue_account_idempotency.sql`). Do not add a file to a grandfathered prefix.
The checker in `scripts/check-migration-prefixes.mjs` enforces that.

## Verification

- `node scripts/check-migration-prefixes.mjs` on this branch: `migration prefixes: ok`.
- No `.sql` file was changed. Only this record was added.

## Open items for the Sorted lead

1. Confirm `schema_migrations` in each environment includes all fourteen grandfathered filenames. The query in
   `DEPLOY.md` (section 5, "SELECT filename, applied_at FROM schema_migrations ...") works for this.
2. The recommendation holds only if every file is applied or none of its filenames is ever renamed.
