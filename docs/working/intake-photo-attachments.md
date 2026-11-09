# Intake photo attachments

Status: customer upload, storage, abandoned-upload cleanup, and a staff list are built (branch `issue/5-intake-followups`). Retention length and the ROADMAP exception are still **open for the owner** (see "Open decisions").
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
| GET | `/api/v1/booking-requests/[id]/photos` | Staff (owner, admin). Read-only list of the photos linked to one request: id, name, type, size, date. No filename, no URL. 404 for a request in another account. |

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
- Staff can **list** the photos on a request (`GET /api/v1/booking-requests/[id]/photos`). The query runs in one account-scoped DB session (`withDbSession`, `apps/web/lib/intake/request-photos.ts`) and keeps the account predicate on both tables.
- Staff cannot **view** the image files yet. No authenticated image route is built. That needs its own decision (open item 2).
- The request detail page shows the list in a "Customer photos" card (`apps/web/app/app/requests/[id]/page.tsx`). It is read-only and sits below the service request details, so it does not compete with the primary action (UX direction sections 9 and 23).

## Policy (proposal for the owner)

1. **Attached to the request.** Photos stay with the intake request for as long as the request record exists. They are not deleted automatically when the request is converted or closed.
2. **Customer removal.** A photo the customer removes before submit is deleted from the row and from disk at once.
3. **Abandoned uploads.** Built as a worker job, `services/worker/src/prune-abandoned-intake-media.ts`, run on each poll from `services/worker/src/index.ts`. It deletes rows where `booking_request_id IS NULL`, the invite was never used, and the invite expired more than 30 days ago. The file is removed first, then the row. A missing file counts as removed. A file that cannot be removed keeps its row for the next run. The worker's own copy of the path rules is in `services/worker/src/intake-media-storage.ts`, because the worker cannot import `apps/web`. A submit cannot claim these invites, since submit needs `expires_at > now()`.
4. **No public access.** Photos are never served without the staff session. The token-scoped preview is the customer's own file in the browser.

## Behaviour change

The submit body no longer carries `photo_count`. The old client sent the number `0`, which the schema (`z.record(z.string())`) rejects. So every submit from the old form returned 400. The server now sets `intake_metadata.photo_count` itself, as a string.

## Open decisions for the owner

1. **ROADMAP scope freeze.** ROADMAP Execution Principles say "No new EPICs, tables, or routes until Phase 0 and Phase 1 are boringly reliable." Phase 1 is still active. This change adds a table and three routes (customer upload, customer delete, staff list). Needs an explicit exception in `docs/canonical/ROADMAP.md`, or a decision that intake photos are part of the existing intake surface. Not decided here.
2. **Staff image viewing.** The list is built. Viewing the image needs an authenticated, account-scoped image route, modelled on `visit_media`. Not built. Decide whether staff need to see the pictures before this is built.
3. **Retention period.** The 30-day abandoned-upload period is built as a default in the worker (`ABANDONED_INTAKE_MEDIA_RETENTION_DAYS`). It is still a proposal for the owner to confirm.
4. **Proxy body limit.** Production needs 40 MB or more on the proxy in front of the app (see `docs/working/upload-body-limits.md`). The intake route needs 11 MB, so it is covered by the same setting. Not verified on garonhome.local.
5. **Requests with no booking request.** An invite with no `booking_request_id` is submitted without creating a request (existing behaviour). Its photos stay on the invite and are not linked to a request. Left as is.

## Decisions taken in this pass (2026-11-09)

- Abandoned cleanup runs on every worker poll, like the other prune jobs, with a batch cap of 200 rows per poll. A daily schedule would also be reasonable; it was not chosen to keep the job consistent with its neighbours.
- The staff list returns 404 (not an empty list) for a request in another account, to match the request detail page.
- Customer removal and abandoned cleanup both delete the file before the row, so a crash never leaves a file with no row.

## Still open after this pass

- The ROADMAP exception (open decision 1).
- Staff image viewing (open decision 2).
- Confirm the 30-day period (open decision 3).
- Requests with no booking request (open decision 5) remain as before. Their photos are not linked to a request and are not cleaned up after submit, so the cleanup job does not touch them.
- Proxy body limit on garonhome.local (open decision 4).
- A shared path-guard module between `apps/web` and `services/worker` would remove the duplicate in `services/worker/src/intake-media-storage.ts`. Not done.

## Tests

- `apps/web/lib/intake/__tests__/photos.unit.test.ts`: validation and byte sniffing.
- `apps/web/app/api/intake/[token]/media/__tests__/media.unit.test.ts`: upload success and association, unknown/used/expired tokens, bad type, text renamed to `.jpg`, empty file, over 10 MB, ninth photo, insert failure (file removed), write failure, remove success, remove of another invite's photo, remove after submit.
- `apps/web/app/api/intake/[token]/__tests__/route.unit.test.ts`: submit sets `photo_count` from the server, links photos, ignores a client count, rejects the old numeric placeholder.
- `apps/web/app/api/intake/[token]/media/__tests__/media.integration.test.ts`: real Postgres. Store, count, remove, ninth-photo refusal, refusal after submit. Runs only with `TEST_DATABASE_URL`.
- `services/worker/src/prune-abandoned-intake-media.test.ts`: selection rules, file-before-row order, missing file, unremovable file, unsafe path, row linked mid-sweep, DB failure.
- `apps/web/app/api/v1/booking-requests/__tests__/request-photos.unit.test.ts`: staff list shape, no filename or URL, tech refused, no session, malformed id, cross-account 404 from the helper.
- `apps/web/app/api/v1/booking-requests/__tests__/request-photos.integration.test.ts`: real Postgres as `ai_fsm_web`. Account A gets 404 for account B's request and does not see B's photos. A sees only its own linked photo.

## UX direction followed

- Section 8 (intake): photos supported at first capture, not added later.
- Section 22 steps 3, 6, 10, 12: no duplicate entry, progress kept per photo, phone-width layout with 44 px touch targets for the photo buttons.
- Section 23: the next action is still "Submit"; photo problems are shown on the photo that has them.
