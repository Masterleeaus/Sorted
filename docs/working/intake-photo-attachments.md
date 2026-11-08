# Intake photo attachments

Status: implemented on branch `issue/5-intake-photos`. Retention and access policy is a **proposal for the owner** (see "Policy").
Issue: #5. Date of decision: 2026-11-08.

## Why

The public intake form posted `photo_count: 0` as a placeholder. Customers could not attach the photos that explain a home-maintenance request. UX direction section 8 says "Support photos immediately."

## What the customer does

On the "Your project" step, under the description:

1. Choose up to 8 photos. Each photo must be 10 MB or smaller. Allowed types: JPG, PNG, WebP, GIF, HEIC, HEIF.
2. Each photo uploads as soon as it is chosen. The customer sees a preview, a status ("Uploading…", "Added", "Upload failed"), and buttons to retry or remove it.
3. Submit is blocked while any photo is uploading or has failed. The customer must wait, retry, or remove it.

Previews use the browser's own object URL for the file the customer picked. No server URL is shown for a photo.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/intake/[token]/media` | Upload one photo (multipart, field `file`). Returns 201 with `{ data: { id, original_name, mime_type, size_bytes } }`. |
| DELETE | `/api/intake/[token]/media/[mediaId]` | Remove one photo. Only works while the invite is open. |
| POST | `/api/intake/[token]` (existing submit) | Server sets `photo_count` from the stored rows and links the invite's photos to the booking request. |

The token is the only credential. It resolves to the account and invite on the server before the body is read. A missing token gives 404, a submitted one 409, an expired one 410, the same as submit.

## Validation

Client (for feedback) and server (for enforcement) both check:

- Size: not empty, at most 10 MB (`MAX_INTAKE_PHOTO_BYTES`).
- Declared type: must be on the allowlist (`apps/web/lib/intake/photos.ts`).

The server also checks the file's first bytes (magic number). A text file renamed to `.jpg` is refused with 422. The stored MIME type is the one the bytes show, not the one the client declared.

Count: the server refuses a ninth photo on one invite with 422. The check and the insert run in one transaction, after `SELECT … FOR UPDATE` on the invite row. This also stops a photo from being added during submit.

Body cap: `UPLOAD_BODY_LIMITS.intakePhoto` is 11 MB, enforced before the form is parsed.

## Storage

- Files go through the existing upload boundary: `UPLOAD_ROOT` from `apps/web/lib/uploads/paths.ts`, in `intake/<invite id>/<uuid>.<ext>`. The client file name is never part of the stored path. It is kept only as display text, after `sanitizeDisplayName`.
- Every path is built by `resolveStoredUpload`, which blocks path escapes.
- Rows are in `intake_media` (migration `203_intake_media.sql`). It is additive. Rollback is `DROP TABLE intake_media;`. Row-level security is account-scoped, like `visit_media`.
- If the row insert fails, the file is deleted. If a delete removes the row but not the file, the file is logged, not returned as an error.

## Access

- No public URL serves intake photos. There is no route that returns a file by id.
- A photo can only be reached through the invite token, and only until submit.
- Staff access to these photos is **not built**. A staff viewer would be an authenticated route under `/api/v1/` that follows the existing `visit_media` pattern. This is an open decision (below).

## Policy (proposal for the owner)

1. **Attached to the request.** Photos stay with the intake request for as long as the request record exists. They are not deleted automatically when the request is converted or closed.
2. **Customer removal.** A photo the customer removes before submit is deleted from the row and from disk at once.
3. **Abandoned uploads.** Photos on an invite that is never submitted are not removed by any job yet. Proposed: a scheduled cleanup removes rows and files whose invite is unused and expired for more than 30 days. It is not built.
4. **No public access.** Photos are never served without the staff session. The token-scoped preview is the customer's own file in the browser.

## Behaviour change

The submit body no longer carries `photo_count`. The old client sent the number `0`, which the schema (`z.record(z.string())`) rejects. So every submit from the old form returned 400. The server now sets `intake_metadata.photo_count` itself, as a string.

## Open decisions for the owner

1. **ROADMAP scope freeze.** ROADMAP Execution Principles say "No new EPICs, tables, or routes until Phase 0 and Phase 1 are boringly reliable." Phase 1 is still active. This change adds a table and two routes. Needs an explicit exception in `docs/canonical/ROADMAP.md`, or a decision that intake photos are part of the existing intake surface. Not decided here.
2. **Staff viewing.** Are staff meant to see these photos from the request screen? If yes, a follow-up authenticated route is needed.
3. **Retention period.** The 30-day abandoned-upload period above is a proposal.
4. **Proxy body limit.** Production needs 40 MB or more on the proxy in front of the app (see `docs/working/upload-body-limits.md`). The intake route needs 11 MB, so it is covered by the same setting. Not verified on garonhome.local.
5. **Requests with no booking request.** An invite with no `booking_request_id` is submitted without creating a request (existing behaviour). Its photos stay on the invite and are not linked to a request. Left as is.

## Tests

- `apps/web/lib/intake/__tests__/photos.unit.test.ts`: validation and byte sniffing.
- `apps/web/app/api/intake/[token]/media/__tests__/media.unit.test.ts`: upload success and association, unknown/used/expired tokens, bad type, text renamed to `.jpg`, empty file, over 10 MB, ninth photo, insert failure (file removed), write failure, remove success, remove of another invite's photo, remove after submit.
- `apps/web/app/api/intake/[token]/__tests__/route.unit.test.ts`: submit sets `photo_count` from the server, links photos, ignores a client count, rejects the old numeric placeholder.
- `apps/web/app/api/intake/[token]/media/__tests__/media.integration.test.ts`: real Postgres. Store, count, remove, ninth-photo refusal, refusal after submit. Runs only with `TEST_DATABASE_URL`.

## UX direction followed

- Section 8 (intake): photos supported at first capture, not added later.
- Section 22 steps 3, 6, 10, 12: no duplicate entry, progress kept per photo, phone-width layout with 44 px touch targets for the photo buttons.
- Section 23: the next action is still "Submit"; photo problems are shown on the photo that has them.
