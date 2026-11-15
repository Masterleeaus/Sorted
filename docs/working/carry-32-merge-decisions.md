# Carry PR 32 onto main: merge decisions

Date: 2026-11-15
Branch: `issue/carry-32-backup-intake` (from `origin/main` at d8fac56)
Merged: `origin/fix/backup-preflight-health-20261109` (252 commits, merged with `--no-ff`, no rebase, no force push)

## Summary

- Textual conflicts: 0. Git auto-merged the branch. Eight files changed on both sides and merged without markers (listed below).
- Migration numbering: no renumbering. PR 32 adds only `210_intake_media_tenant_integrity.sql`. Main now contains `209_scheduled_booking_links.sql`; intake integrity was renumbered to 210 to eliminate the CI collision. The original 209 intake migration was not applied on main. `scripts/check-migration-prefixes.mjs` passes.
- Semantic fix: five production route files had account-only tenant predicates from PR 32. Main had already moved app code to `company_id`. These predicates were converted to `company_id`. Migration 205 keeps `account_id` as an equal copy during the dual-column period, so the old predicates still ran. The change is for convention and to keep one tenant key in code.

## Files changed on both sides (auto-merged)

| File | Decision |
| --- | --- |
| `DEPLOY.md` | Kept both sides. Docs only. |
| `docs/working/intake-photo-attachments.md` | Kept both sides. Docs only. |
| `infra/garonhome.env.example` | Kept both sides. Config example only. |
| `scripts/gate.sh` | Kept both sides. Not run in full (`pnpm gate` is out of scope for this carry). |
| `apps/web/app/api/intake/[token]/route.ts` | Kept PR 32 logic (claim, photo count, invite lock). Converted its `account_id = $N` predicates to `company_id = $N`, matching main's existing line that already used `company_id`. The `SELECT ... account_id` read and the `set_config` value stay on `account_id`, as on main. |
| `apps/web/app/api/intake/[token]/media/route.ts` | Kept PR 32 logic (locked upload, photo cap). Converted two `account_id = $N` predicates to `company_id`. |
| `apps/web/app/api/intake/[token]/media/[mediaId]/route.ts` | Kept PR 32 logic (invite lock and `ALREADY_USED` 409 before delete, private file helper). Converted the new `account_id` predicate to `company_id`. Main's `company_id = $3` delete predicate was already there and is unchanged. |
| `apps/web/app/api/intake/[token]/media/__tests__/media.unit.test.ts` | Kept both sides. Mock of the new private-file helper. |

## Other #32 code that carried account-only predicates (converted)

| File | Change |
| --- | --- |
| `apps/web/app/api/v1/booking-requests/[id]/media/route.ts` | `booking_requests` and `intake_media` lookups: `account_id = $2` to `company_id = $2`. |
| `apps/web/app/api/v1/booking-requests/[id]/media/[mediaId]/route.ts` | `im.account_id` and `br.account_id` to `company_id`, value still the session account. |

Tests whose assertions matched the old SQL text were updated to the same predicate: the list and download unit tests (`booking-requests/[id]/media`), and the intake-photo script tests (`intake-photo-delete-lock`, `intake-photo-upload-token`, `intake-photo-submit-association`). The submit-association assertion was already stale on main, since main's route used `company_id`.

## Type fixes in PR 32 test files

The narrow typecheck found seven errors, all in PR 32's new test files, none in production code:

- `media-restricted-rls.integration.test.ts`: the callback type was inferred from `Pool.connect`'s last overload (`void`). Changed to `PoolClient`.
- `media.integration.test.ts`: `upload()` took a `Uint8Array` that TypeScript 5.9 would not pass to `Blob`. Typed the parameter as `Uint8Array<ArrayBuffer>`.

## Deliberately not changed

- `db/migrations/210_intake_media_tenant_integrity.sql` keeps `account_id` in its constraints and checks. This is schema DDL, not app query code. `account_id` is the dual column that migration 205 keeps equal to `company_id`, and the FK is additive. Moving it to `company_id` is a later migration, not part of this carry.
- Pre-existing `account_id` predicates in worker code (`services/worker/src/vehicle-maintenance-reminder.ts`, `prune-location-events.ts`) were already on main. They are outside PR 32 and are not touched here.
- Migration 210 has no rollback note. It is additive (unique indexes and two FKs). A rollback would be `DROP CONSTRAINT fk_intake_media_invite_account, fk_intake_media_booking_account` and `DROP INDEX idx_intake_invites_id_account, idx_booking_requests_id_account_intake`. Not added here, and flagged for review.
- The titan manifest drift (`apps/web/lib/titan/interface-runtime/live-context.ts` and its test) is present on main too. Not caused by this carry.

## Checks

See the PR body for the results.
