# Decision: Titan Go is a UI layer inside Dovetails FSM (2026-11-08)

Issue: #8. Docs and package description only. No code behaviour changed.

## Decision

- Titan Go (the installable PWA, "Titan Go Field" mode) is an imported UI layer and deployment surface inside this app.
- It is not a product identity change. The product is Dovetails FSM, a residential handyman and home maintenance operating system.
- `docs/canonical/` stays authoritative for product, domain and architecture. The canonical docs do not mention Titan as a product, and this decision does not add it.
- Titan-branded modes, Zero chat and workforce screens are presentation and runtime surfaces. They do not define scope.
- Root `package.json` description changed from "AI-first Field Service Management MVP" to the canonical product identity. The canonical "Product Boundaries" exclude AI-first and generic FSM positioning.

Owner to confirm: that Titan Go stays a UI layer and the prototype surfaces below are not promoted to production.

## Why

- `docs/canonical/PRODUCT_VISION.md` lists "A generic multi-company field service platform", "A SaaS subscription platform" and "An AI estimating product" as not current identity.
- `CHANGES.md` (v3 UI patch) already describes Titan Go as "a mode, not a separate PWA product", inside one PWA.
- `apps/web/app/titan/` has no `page.tsx`, and no live route imports from it.

## Titan-facing surfaces

### Prototype or not connected (no live route imports them)

Source: import scan of `apps/web` and `packages` on 2026-11-08. Nothing outside `apps/web/app/titan/` imports these files, except the unit test noted.

- `apps/web/app/titan/components/role-secondary-surfaces.tsx`: `RoleInbox`, `RoleMore`, `GoInbox`, `HubInbox`, `SimpleThread`. Hardcoded customer, dispatch and booking data. "Sent in demo mode" on sent messages. "Dispatch connected" and "data synced" style claims. `RoleInbox` is imported only by `components/__tests__/role-surfaces.unit.test.ts`.
- `apps/web/app/titan/components/role-chat.tsx`: role chat shell. Imports runtime modules below.
- `apps/web/app/titan/components/role-details.tsx`: role detail panes, imports `go-field-runtime` and `go-schedule-intelligence`.
- `apps/web/app/titan/components/titan-brand.tsx`
- `apps/web/app/titan/components/generated-ui/generated-ui-envelope.tsx`
- `apps/web/app/titan/runtime/demo-presentation-intent.ts`, `surface-contract.mjs` (demo projection), `go-field-runtime.mjs`, `go-schedule-intelligence.mjs`, `interaction-client.ts`, `conversation-store.ts`, `multimodal-input.ts`, `presentation-intent.ts`, `zero-http-transport.ts`: used only from the files above.

Action: treat as prototypes. Do not link them from navigation. Issue #2 covers the label or connect decision.

### Live-linked Titan surfaces (outside `app/titan`)

Linkage only. Behaviour was not verified in this change.

- `apps/web/components/TitanZeroChat.tsx`: used by `components/AppShell.tsx` and `app/app/OwnerDashboard.tsx`.
- `apps/web/components/AppShell.tsx`: Titan Go mode metadata from `lib/titan-go/modes`.
- `apps/web/app/(auth)/login/page.tsx`: "Enter Titan Go".
- `apps/web/app/app/workforce/page.tsx`, `app/app/standards/page.tsx`, `app/app/assets/page.tsx`.
- `apps/web/app/app/settings/` (WorkforceLifecyclePanel, WorkforceHierarchyPanel).
- `apps/web/app/api/v1/titan/workforce/*`.
- `apps/web/lib/titan-go/`, `apps/web/lib/titan/`.

## Unverified

- Whether the live-linked surfaces meet the canonical workflow scope. Not checked here.
- Whether `packages/titan-platform` and `titan-donor` need a separate decision. Out of scope.
