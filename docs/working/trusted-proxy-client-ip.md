# Trusted proxy and client IP for rate limits

Status: working note, 2026-11-08. Issue #17 (and the rate limits in #20).
Code: `apps/web/lib/rate-limit.ts` (`getClientIp`, `getTrustedProxyCount`).

## What the code does now

- `TRUSTED_PROXY_COUNT` is the number of trusted hops in front of the app that
  each append an entry to `X-Forwarded-For`. The hop that connects to the app
  counts too.
- Default is `0`: forwarded headers are not trusted. Every request then uses
  the shared key `unknown`. Missing, non-integer, negative, or >10 values also
  become `0`.
- With `N >= 1`, the client address is the entry `N` positions from the right
  end of the header. Entries to its left came from the client and are ignored.
- If the header has fewer than `N` entries, or the chosen entry is not a valid
  IPv4/IPv6 address, the key is `unknown`.
- `X-Real-IP` is no longer read.

Example, `N = 1` (one proxy appends):

| Header sent to app | Client key |
| --- | --- |
| `5.6.7.8` | `5.6.7.8` |
| `6.6.6.6, 5.6.7.8` (client sent `6.6.6.6`) | `5.6.7.8` |
| `garbage` | `unknown` |

## Production path, as the repo documents it

From the repo only (not checked against the live box):

- `docs/working/pwa-https-deployment.md` (recommended path): browser ->
  Cloudflare edge -> `cloudflared` container on the `business_proxy` network ->
  `http://ai-fsm-web:3000`. Nothing else in front of the app.
- Same doc, older path: browser -> Nginx Proxy Manager (`:443`) ->
  `ai-fsm-web:3000`. It says the tunnel may route through NPM instead, so both
  are possible.
- `infra/compose.garonhome.yml`: the web service has no host ports and joins
  `business_proxy`.
- `DEPLOY.md`: no proxy or header details found.

## Unverified (cannot be confirmed from the repo)

- Whether Cloudflare's edge sets or appends `X-Forwarded-For`, and whether it
  sends `CF-Connecting-IP`. Not used by this code.
- Whether `cloudflared` appends to `X-Forwarded-For` or passes it through.
- Whether NPM's proxy host uses `$proxy_add_x_forwarded_for` (append) or
  overwrites the header. NPM's default config is not in this repo.
- Whether production sets `TRUSTED_PROXY_COUNT`. The repo does not set it.

Candidate values, to confirm before setting (not verified):

- Tunnel straight to the app, no NPM, one appending hop: `1`.
- Tunnel -> NPM -> app, both appending: `2`.

## Verify before setting the value in production

1. Deploy with `TRUSTED_PROXY_COUNT` unset (current behaviour is `unknown`).
2. Set the candidate value. Send 6 failed logins to `/api/v1/auth/login`
   from one client, each with a different made-up `X-Forwarded-For` value.
   The 6th should return 429. If it does not, the key is not tracking the real
   client, so try another count.
3. Repeat from a second client. The limits should not be shared.

## Risk at deploy

With `0`, every client shares the `unknown` bucket. The booking form allows
10 submissions per hour, so the whole site would share 10 per hour. Set the
value in the same deploy that removes the old behaviour, or accept the limit.
The e2e runs (`.github/workflows/ci.yml`, `scripts/gate.sh`) set
`E2E_DISABLE_LOGIN_RATE_LIMIT=1`. Integration tests that log in from many
made-up IPs need `TRUSTED_PROXY_COUNT=1` on the server under test.
