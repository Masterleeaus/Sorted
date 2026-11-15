# Titan Go / Titan Zero Field — UI Redesign v3

## 2026-11-08 — Titan Go identity and deploy-target alignment (docs only)

- Decision: Titan Go is an imported UI layer and deployment surface inside Dovetails FSM, not a product identity change. Canonical docs in `docs/canonical/` remain authoritative. Record: `docs/working/titan-go-identity-decision-2026-11-08.md`.
- Root `package.json` description changed from "AI-first Field Service Management MVP" to "Dovetails FSM: residential handyman and home maintenance operating system", matching canonical product identity.
- Titan components under `apps/web/app/titan/` with no live route import are classed as prototypes. The list is in the decision record.
- Production deploy path is unified in `DEPLOY.md` on `/opt/business/ai-fsm` with `infra/compose.garonhome.yml`. Legacy `/home/admin/apps/ai-fsm` overlay is non-production. Record: `docs/working/deployment-target-decision-2026-11-08.md`.
- No code behaviour changed.

---

This patch is cumulative against the uploaded live `apps/` source. It includes the earlier Titan Go / Field redesign plus the new large v3 UI pass, so you do **not** need to install v2 first.

## Product architecture corrected

- **Titan Go is the single installable PWA.** Field is the active mode in this deployment; future Build, Desk and Pay modes can appear inside the same PWA according to subscription entitlements and role.
- The customer-facing workforce language is strictly **Manager → Specialist → Worker**.
- Titan Field has **one Operations Manager**. The five workforce groups are operational **portfolios**, not extra management tiers.
- Each portfolio can have a **Lead Specialist** without adding another Manager layer.

## Shell and navigation

- Rebuilt the desktop/iPad shell around Titan Zero Field rather than the old Dovetails all-in-one FSM navigation.
- Added Titan gold/black/silver visual language based on the supplied Field logo.
- Added a compact persistent Titan Zero chat bar in the desktop sidebar.
- Added a global desktop command bar with Field context, Find, notifications and **+ New**.
- Mobile is now Titan Go-first: hamburger + Field mode + attention + New; the owner Command page is Zero-first rather than a miniature desktop dashboard.
- Removed Desk/Pay destinations from the primary Field navigation and command palette while preserving underlying routes for interoperability.
- Field navigation now centres on Command, Operations, Workforce, Standards, Assets/Supply and Insight.

## Command / Zero experience

- Reworked Command into an operational cockpit.
- Mobile Command gives Titan Zero the main screen, with attention/job/active-work signals above it.
- Desktop Command combines the Zero console with a compact live operations rail.
- Added quick operational prompts and clearer connected/offline state.
- Reworded the PostgreSQL Zero-runtime limitation as a product status rather than a developer error.

## Workforce — major redesign

- Replaced the long donor-style agent dump with a product-organised Field workforce.
- Workforce structure is now:
  - 1 Operations Manager
  - 5 operational portfolios
  - 22 Specialists
  - 38 bounded Workers
  - human field team shown separately
- Portfolios:
  1. Operations & Delivery
  2. Quality & Evidence
  3. Assets & Supply
  4. Standards, Safety & Capability
  5. Operations Intelligence
- Lead Specialists:
  - Dispatch Specialist
  - Quality Specialist
  - Supply Specialist
  - Standards Specialist
  - Operations Analytics Specialist
- Added portfolio filters, Specialist/Worker search, collapsible portfolios and a dedicated Specialist detail pane.
- The human Field team has its own view.
- Live runtime has its own view and is filtered to Field-owned runtime connections only (`scheduling`, `dispatch`, `jobs`). Reception, sales, quoting, booking and other non-Field workforce no longer appear in the Field runtime UI.
- Removed visible Supervisor / Agent / Orchestrator / Atomic Worker terminology from the Field workforce experience.
- Governance remains explicit: hierarchy and prediction never grant execution authority.

## Work Orders

- Replaced the old `/app/work-orders` redirect with a real Work Orders operating surface.
- Added search and status filtering.
- Shows Job, client, Site, visit counts, open field days, scope/material value and created date.
- Added an execution-oriented summary and direct create/open actions.

## Titan Standards

- Expanded Standards into a real Field control surface instead of a basic checklist list.
- Added five control areas:
  - SOPs & Service Standards
  - Safety & Incidents
  - Compliance & Expiry
  - Training & Competency
  - Audit & Improvement
- Preserved and surfaced the real baseline checklist and service closeout templates.
- Reinforced that Titan Standards is permanently included with Field.

## Assets & supply

- Upgraded Assets into a Field readiness surface with live link counts, Jobs/Visits using equipment and status-review indicators.
- Equipment remains linked through the owning Job or Visit to preserve custody/evidence context.

## Settings

- Field Settings no longer foregrounds company billing/payment configuration.
- Added a clear Titan Go single-PWA explanation and current Field mode.
- Reworked Field Setup into visual operational cards for Schedule, Workforce, Standards, Materials, Assets, Tracking, Mileage/Vehicles and Operations Analytics.
- Preserved the working PostgreSQL/RLS Settings data-loading fix.

## Field terminology cleanup

- Renamed visible House/Houses language to **Site/Sites** on primary Field surfaces.
- Renamed Vehicle tracking to **Tracking**.
- Removed the old mobile `Desk` shortcut in favour of `Command`.
- Removed legacy Work/People/Money hub chips from primary Field routes.

## Operations analytics

- Added `/app/operations-analytics` backed by live visit/user data.
- Surfaces 30-day delivery, completion rate, next-seven-day workload, human Field team count and seven-day completion trends.

## Titan Go / PWA

- PWA name and Apple app title are **Titan Go**.
- Field is represented as a mode, not a separate PWA product.
- Updated install icons from the supplied Titan Field emblem.
- Updated service-worker registration to check for new versions on production loads and avoid stale worker-script HTTP caching.
- Titan Go login, metadata and 404 surfaces now use the new identity.

## Validation performed here

- Compared the final tree against the original uploaded live `apps/` source.
- Checked all modified/new TypeScript and TSX files with the TypeScript transpiler: **0 syntax diagnostics**.
- Verified braces in the cumulative Titan Go CSS layer are balanced.
- Verified all static `/app/...` links introduced in the shell, New menu, Command dashboard, command palette and Field Setup point to existing routes.
- Verified the customer-facing Field workforce surfaces no longer expose Supervisor / Agent / Orchestrator / Atomic Worker naming.

A full workspace-aware `tsc --noEmit` and Next production build still need to run on the VPS because the uploaded `apps/` archive does not contain the live root workspace packages/symlinks needed for full type resolution.
