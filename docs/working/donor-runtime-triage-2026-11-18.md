# Donor runtime triage — 18 November 2026

Tracking: #124. This is a **source inspection**, not a runtime verification or authorization to delete donor files.

## Baseline

The checked-in `docs/generated/titan-donor-manifest.json` lists 371 entries: 250 imported-identical, 78 imported-identical-relocated, and 43 not-integrated. Seven internal duplicate groups are declared. These counts are from the manifest; current-tree SHA-256 verification and `pnpm check:titan-manifest` have **not** been executed in this pass.

The existing `docs/working/titan-donor-provenance.md` identifies `packages/titan-platform/src/` and Titan `apps/web` paths as canonical runtime sources. `titan-donor/` is preserved evidence, not a production source tree.

## Direct source inspection

| Donor file | Observed dependencies / behavior | Decision / gate |
| --- | --- | --- |
| `titan-donor/workforce/services/workforce/src/index.ts` | Defines company-scoped work, worker and authenticated-session identity contracts; imports Titan security-boundary types through a donor-relative path. | Retain evidence; compare types and security invariants with canonical platform contracts before any port. |
| `titan-donor/workforce/services/workforce/src/production-dependencies.ts` | Imports SQLite company storage, schema attestation, session credential verification and native work orders. | **Do not port wholesale** into shared PostgreSQL architecture. Review tenancy, storage and migration strategy first. |
| `titan-donor/workforce/apps/web/lib/builder-projection-executors.ts` | Implements read-only, company-scoped Builder projection queries via portable SQL and Titan Builder contracts. | Review against active Builder projection ownership and account/company identity mapping; do not silently activate donor code. |
| `titan-donor/workforce/ui/WorkforceHierarchyPanel.tsx` | Renders manager/supervisor/agent/worker hierarchy; references a sibling hierarchy-data type. | Preserve pending comparison with active UI and accessibility/component imports. |
| `scripts/check-titan-manifest.mjs` | Node-only checker documents SHA-256/path checks and non-blocking warnings; not wired into CI. | Run in checked-out tree before any cleanup; no execution claimed here. |

## Remaining triage

The manifest's 43 not-integrated paths include 31 `services/workforce/` files and 12 other donor files. The five files inspected above are **not** a complete 43-file review. No source deletions, import rewrites, tests, DB migrations or production deployments were performed.

### Required acceptance

- [ ] Inspect remaining donor runtime, tests, storage adapters and UI files against canonical implementations.
- [ ] Validate all 371 manifest paths and hashes against current HEAD; attach checker output.
- [ ] Inventory live imports/exports, build/deploy entry points and migration dependencies.
- [ ] Establish Central vs Sorted vs Supercharged authority for workforce runtime and agent execution.
- [ ] Propose reversible archive/removal changes only after licensing, dependency and regression checks.

Keep all items unchecked until evidenced. See #124 for the complete consolidation gate.
