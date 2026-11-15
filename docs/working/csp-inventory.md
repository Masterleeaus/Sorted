# Content Security Policy: inventory and status (issue #25)

Status: partial. `'unsafe-eval'` is removed from production. Inline scripts are
still allowed. The nonce strategy is blocked (see below).

Source of truth: `buildContentSecurityPolicy()` in `apps/web/middleware.ts`.
Unit tests: `apps/web/__tests__/middleware.unit.test.ts`.

## Current production policy

- `default-src 'self'`
- `script-src 'self' 'unsafe-inline'` (no `'unsafe-eval'`)
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: https://*.tile.openstreetmap.org`
- `font-src 'self'`
- `connect-src 'self'`
- `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` (unchanged)

Development (`NODE_ENV !== "production"`) adds `'unsafe-eval'` to `script-src`.
Next dev needs it for eval-based source maps and React dev call-stack
reconstruction. Nothing else differs between environments.

## Inventory of required origins

Scripts:
- `'self'`: Next.js chunks under `/_next/static`, and `/sw.js`
  (registered by `app/ServiceWorkerRegistrar.tsx`, production only).
- Inline: Next.js App Router emits inline bootstrap and flight-data scripts.
  No `next/script`, `<script>` tags or `dangerouslySetInnerHTML` exist in
  `apps/web` app or component code.
- No external script hosts. Fonts come from `next/font/google`, which Next
  downloads at build time and serves from `'self'`.

Styles:
- `'self'`: `app/globals.css` and its imports under `app/styles/`.
- Inline: about 290 component files use React `style={{...}}` props. This is
  why `style-src 'unsafe-inline'` stays.

Images:
- `'self'` and `data:`.
- `https://*.tile.openstreetmap.org`: Leaflet tiles in `app/app/DayMap.tsx`.
- No `blob:` URLs in the code.

Connections (`connect-src 'self'`):
- All client `fetch` calls are same-origin `/api/...` routes.
- External routing and geocoding calls run server-side only:
  `router.project-osrm.org` and `nominatim.openstreetmap.org` in
  `lib/travel/distance.ts`. The CSP does not apply to server fetches.
- Push subscriptions go to the browser push service, which the page does not
  fetch directly.

Other:
- No `iframe`, `embed`, `object`, `frame-src` or Web Worker use in the code.
  `frame-src` falls back to `default-src 'self'`.
- Service worker: `public/sw.js`, same origin.

## Nonce strategy (blocked for now)

Next.js 15.5.25 (the version pinned in `apps/web/package.json`) reads a nonce
from the `content-security-policy` request header. The middleware would
generate it, put the policy with `'nonce-...'` on the request, and set the
same header on the response. See
`next/dist/server/app-render/get-script-nonce-from-header.js` and the usage in
`app-render.js`.

Blocker: a per-request nonce means every App Router page is rendered on
demand. Static prerendering stops working for the whole app. That changes
caching and cold-start behaviour for all routes, which is not a small change.
It also needs a production build and browser checks to verify, and those were
not done in this pass.

Next step to unblock: decide whether dynamic rendering across the app is
acceptable. If yes, add the nonce to middleware and remove `'unsafe-inline'`
from `script-src`, then check the production build in a browser for console
CSP violations.

## Verification

- Unit tests: production policy has no `'unsafe-eval'`. Dev/test/unset
  `NODE_ENV` adds it. Other directives are the same in both.
- Production build and browser check: NOT DONE. `next build` runs a
  repo-wide type check, which this machine must not run. The build was
  started and then stopped, and the stop was denied, so a background build may
  still be running. Run the production check on a machine that can afford the
  build, then confirm the served header has no `'unsafe-eval'` and that pages
  load without CSP console violations.
