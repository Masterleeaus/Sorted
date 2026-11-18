# Carry PR 32 onto main: merge decisions

Date: 2026-11-18 (reconciled against current main)
Branch: `issue/carry-32-backup-intake` (reconciled with current main)
Merged: `origin/fix/backup-preflight-health-20261109` (252 commits, merged with `--no-ff`, no rebase, no force push)

## Summary

- Textual conflicts: resolved by preserving the current main versions of `README.md` and `.github/workflows/central-oidc-adapter.yml`; the PR implementation is overlaid on current main.
- Migration numbering: this intake constraint migration is numbered 211 because main reserves prefix 210 for its existing migration pair. Migration 209 renames tenant columns to `company_id`; this migration follows that change and uses `company_id` throughout. Existing applied migration SQL remains untouched.
- Semantic fix: five production route files had account-only tenant predicates from PR 32. Main had already moved app code to `company_id`. These predicates were converted to `company_id`. Migration 205 keeps `account_id` as an equal copy during the dual-column period, so the old predicates still ran. The change is for convention and to keep one tenant key in code.

## Files changed on both sides (auto-merged)

| File | Decision |
| --- | --- |
| `DEPLOY.md` | Kept both sides. Docs only. |
| `docs/working/intake-photo-attachments.md` | Kept both sides. Docs only. |
| `infra/garonhome.env.example` | Kept both sides. Config example only. |
| `scripts/gate.sh` | Kept both sides. Not run in full (`pnpm gate` is out of scope for this carry). |
| `apps/web/app/api/intake/[token]/route.ts` | Kept PR 32 logic (claim, photo count, invite lock). Converted its `account_id = $N` predicates to `company_id = $N`, matching main's existing line that already used `company_id`. The tenant column reads use `company_id` after migration 209. The `app.current_account_id` transaction setting name remains unchanged for compatibility. |
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

- `db/migrations/211_intake_media_tenant_integrity.sql` uses `company_id` because migration 209 renames the tenant key on intake and booking tables before this constraint migration runs.
- Pre-existing `account_id` predicates in worker code (`services/worker/src/vehicle-maintenance-reminder.ts`, `prune-location-events.ts`) were already on main. They are outside PR 32 and are not touched here.
- Migration 211 (intake media tenant integrity) has no rollback note. It is additive (unique indexes and two FKs). A rollback would be `DROP CONSTRAINT fk_intake_media_invite_account, fk_intake_media_booking_account` and `DROP INDEX idx_intake_invites_id_account, idx_booking_requests_id_account_intake`. Not added here, and flagged for review.
- The titan manifest drift (`apps/web/lib/titan/interface-runtime/live-context.ts` and its test) is present on main too. Not caused by this carry.

## Checks

See the PR body for the results.
