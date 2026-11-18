# SortedAt.Work — field operations, jobs, quotes and invoicing

**Repository:** `Masterleeaus/Sorted` · **Documentation review:** 18 November 2026

Sorted is Titan Zero's field-operations product direction: customer/property records, job intake, estimates, service visits, staff/teams, job evidence, invoices, and an installable field-work PWA. The checked-in repository retains **Dovetails FSM** branding and a small-business residential-service product model. **That is an unresolved product-boundary decision, not permission to silently reinterpret existing data or rename compatibility-critical identifiers.**

## Product identity: resolve before migration

- The current root README calls the field PWA **Sorted** and the product **Dovetails FSM**; [canonical PRODUCT_VISION.md](docs/canonical/PRODUCT_VISION.md) still calls the installable field app **Titan Go** and explicitly excludes a generic multi-company SaaS platform. [Canonical ARCHITECTURE.md](docs/canonical/ARCHITECTURE.md) still describes the current single-business Dovetails model.
- Titan Zero's [Central ADR-009](https://github.com/Masterleeaus/Central/blob/main/TITAN_ARCHITECTURE_DECISIONS.md) instead specifies Sorted as the **jobs/field operations** application in a five-product, `company_id`-scoped shared PostgreSQL architecture.
- [#29](https://github.com/Masterleeaus/Sorted/issues/29), [#26](https://github.com/Masterleeaus/Sorted/issues/26) and [Central #140](https://github.com/Masterleeaus/Central/issues/140) must reconcile product identity, user-facing names, data migration and tenancy before production cutover. Do **not** rewrite the canonical product vision or silently drop existing Dovetails workflows as part of documentation cleanup.

## Capabilities and responsibility

| Workstream | Source direction | Verification / tracking |
| --- | --- | --- |
| Intake and customer/property history | Requests, clients, work orders, retained service history and images | [#87](https://github.com/Masterleeaus/Sorted/issues/87), [#99](https://github.com/Masterleeaus/Sorted/issues/99) |
| Field execution | Technician PWA, jobs, visits, notes, photos, material evidence, offline-friendly workflows | [#107](https://github.com/Masterleeaus/Sorted/issues/107) |
| Quotes and rate cards | Estimates, revisions, review/approval and quote-to-job handoff | [#103](https://github.com/Masterleeaus/Sorted/issues/103), [#106](https://github.com/Masterleeaus/Sorted/issues/106), [#108](https://github.com/Masterleeaus/Sorted/issues/108) |
| Invoices and teams | Keep canonical invoicing, staff/team, service agreements and payments functionality | [#109](https://github.com/Masterleeaus/Sorted/issues/109), [#87](https://github.com/Masterleeaus/Sorted/issues/87) |
| Shared Titan interfaces | Receive scheduled bookings and authorized front-desk handoffs, preserve company and customer identity | [#86](https://github.com/Masterleeaus/Sorted/issues/86), [#102](https://github.com/Masterleeaus/Sorted/issues/102), [#110](https://github.com/Masterleeaus/Sorted/issues/110) |

**Ownership:** Scheduled owns booking/calendar; Sorted owns **jobs, quotes, invoices and field-work execution**; Supercharged owns communications and agent workflows; Skilled owns competencies; Central owns shared identity, tenant company and migration coordination. AI estimates remain **draft recommendations** until deterministic pricing rules and owner approval accept them.

## Codebase and documentation hierarchy

- `apps/web/`: Next.js UI, API routes, owner/admin and field workflows.
- `services/worker/`: queue/notification and background operations.
- `packages/domain/`: reusable operational schemas and labels; `packages/titan-platform/` contains additional integrated/donor material with provenance obligations.
- `db/migrations/`: SQL migrations and row-level security; `infra/`: local/deployment Compose profiles.
- `docs/canonical/`: current Dovetails product documentation **until the owner resolves the five-product conflict**; `docs/working/`, `docs/contracts/` and `ai/`: technical support; `docs/archive/`, `docs/generated/`: history, not implementation authority.

[Product vision](docs/canonical/PRODUCT_VISION.md) · [Domain model](docs/canonical/DOMAIN_MODEL.md) · [Workflow](docs/canonical/WORKFLOW.md) · [Architecture](docs/canonical/ARCHITECTURE.md) · [Roadmap](docs/canonical/ROADMAP.md) · [Deployment](DEPLOY.md).

## Local development (existing environment)

Use the pinned pnpm 9.12.0 workspace manager, local PostgreSQL and Redis, and a **disposable database**:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f infra/compose.dev.yml up -d postgres redis
pnpm db:migrate
pnpm dev:web
# Required quality gate:
pnpm gate
# Faster feedback:
pnpm gate:fast
```

Check the actual environment variables before running migrations. The historical `garonhome.local` Compose target in [DEPLOY.md](DEPLOY.md) is **not** proof that Central's shared-database staging has been cut over; validate host and migration history before any deployment.

## Migration and security blockers

1. **[Migration collisions #100](https://github.com/Masterleeaus/Sorted/issues/100):** two 209 and two 210 migration prefixes and potentially applied migration content. Read environment `schema_migrations` ledgers first. Do not rename or edit already applied SQL; new reviewed migrations must have unique ordered identifiers and safe backfill/rollback.
2. **[Audit writer #95](https://github.com/Masterleeaus/Sorted/issues/95):** compare `audit_log.company_id` against an actually migrated PostgreSQL schema with tenant RLS/insert integration tests.
3. **[Shared tenancy #26](https://github.com/Masterleeaus/Sorted/issues/26) / [#42](https://github.com/Masterleeaus/Sorted/issues/42):** canonical `company_id`, membership and least-privilege RLS, Central OIDC, signed inter-app events.
4. **[CI/drift #88](https://github.com/Masterleeaus/Sorted/issues/88) / [#97](https://github.com/Masterleeaus/Sorted/issues/97) / [#98](https://github.com/Masterleeaus/Sorted/issues/98):** reconcile PRs, manifest checksums and migration reversal policy; do not suppress failing checks to turn a build green.
5. **[Navigation compatibility #94](https://github.com/Masterleeaus/Sorted/issues/94):** settle product vocabulary before rewriting tests or changing the PWA identity.

## Quality, handoffs and licensing

Run `pnpm gate`, migration guards, fresh-install and upgrade database fixtures, two-company access negatives, quote-to-invoice workflows, worker tests and browser/mobile checks. No production-ready claim without these results. Each [open issue](https://github.com/Masterleeaus/Sorted/issues?q=is%3Aissue+is%3Aopen) carries a task checklist; check only evidenced work.

The root [MIT licence](LICENSE) applies subject to retained third-party notices/provenance. Review [donor provenance](docs/working/titan-donor-provenance.md) before redistributing code imported under other terms.
