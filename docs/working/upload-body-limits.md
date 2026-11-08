# Upload body limits

Status: working note. Owner review needed for the production proxy value (see "Production proxy").
Issue: #16. Date of decision: 2026-11-08.

## What the app enforces

Each multipart upload route checks the request body size before it buffers the form.
The check lives in `apps/web/lib/uploads/body-limit.ts`.

1. If `Content-Length` is present and above the route cap, the route returns 413 at once and does not read the body.
2. Otherwise the body is counted while it streams. Reading stops as soon as the cap is passed, so chunked bodies and a `Content-Length` that lies are also refused with 413.
3. Per-file MIME and size checks still run after parsing and return 422 as before.

The 413 response has this shape:

```json
{ "error": { "code": "PAYLOAD_TOO_LARGE", "message": "Upload is larger than the 11 MB limit for this request", "traceId": "..." } }
```

## Route caps

| Route | Per-file limit | Body cap |
| --- | --- | --- |
| `POST /api/v1/visits/[id]/media` | 10 MB | 11 MB |
| `POST /api/v1/vault-items/[itemId]/media` | 10 MB | 11 MB |
| `POST /api/v1/expenses/[id]/receipt` | 10 MB | 11 MB |
| `POST /api/v1/captures` | audio 25 MB, photo 10 MB | 40 MB |
| `POST /api/v1/expenses/import/preview` | 5 MB | 6 MB |
| `POST /api/intake/[token]/media` (public intake photo) | 10 MB | 11 MB |

The caps are the constants `UPLOAD_BODY_LIMITS` in `body-limit.ts`. Change them there and in this table together.

Not yet capped (see "Not covered" below): `POST /api/v1/account/logo` (2 MB file), `POST /api/v1/expenses/scan-receipt` (5 MB file), `POST /api/v1/materials/import`, `POST /api/v1/clients/import`.

## Production proxy

The reverse proxy or tunnel in front of garonhome.local is not in this repository, so its limit is not checked in.
Production needs a request body limit of at least **40 MB** on the routes above, otherwise the proxy returns its own error before the app can answer with 413.

Owner action: set the body size limit on the proxy or tunnel that fronts the app to 40 MB or more, then confirm with a request just over 40 MB that the app returns 413 and not a proxy error page.
Record the value and the date here once it is set: **not yet set (unverified)**.

## Not covered

- The four routes listed above with no cap yet. They keep the old behaviour (parse, then check the file size).
- The proxy limit is documented, not verified by a test.

## Decisions

- Chose a counting stream over relying on the framework. Next.js route handlers have no built-in body cap for `request.formData()`.
- The 413 is for the whole request. A file that fits under the body cap but is over its own limit still gets the existing 422.
