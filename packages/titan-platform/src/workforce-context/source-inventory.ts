import type { WorkforceContextSourceKind } from "./contract.js";

export type WorkforceContextSourceInventoryEntry = Readonly<{
  kind: WorkforceContextSourceKind;
  canonical_owner: string;
  existing_sources: readonly string[];
  projection_rule: string;
}>;

/**
 * Pass 1 inventory only. This registry points at canonical business records and
 * existing bounded context helpers; it does not copy those records into a new store.
 */
export const WORKFORCE_CONTEXT_SOURCE_INVENTORY: readonly WorkforceContextSourceInventoryEntry[] = Object.freeze([
  Object.freeze({
    kind: "company",
    canonical_owner: "account/company boundary + Titan company execution context",
    existing_sources: Object.freeze([
      "packages/titan-platform/src/ported/titan-runtime/company-context.ts",
      "authenticated web session accountId/company_id mapping",
    ]),
    projection_rule: "project company_id only; legacy tenant aliases never become authority",
  }),
  Object.freeze({
    kind: "actor",
    canonical_owner: "authenticated session / workforce invocation actor",
    existing_sources: Object.freeze([
      "apps/web/lib/auth/session",
      "apps/web/lib/titan/workforce-command-gateway.ts",
    ]),
    projection_rule: "carry actor identity and role as provenance; identity alone grants no execution authority",
  }),
  Object.freeze({
    kind: "customer",
    canonical_owner: "CRM client/customer records",
    existing_sources: Object.freeze([
      "apps/web/lib/clients/**",
      "apps/web/lib/crm/**",
    ]),
    projection_rule: "reference canonical customer IDs and project only fields required by the bounded task",
  }),
  Object.freeze({
    kind: "location",
    canonical_owner: "property/service-location and field site records",
    existing_sources: Object.freeze([
      "apps/web/lib/field/site-context.ts",
      "property/service-location records",
    ]),
    projection_rule: "reference location/property IDs; ephemeral GPS inference is evidence, not durable business truth",
  }),
  Object.freeze({
    kind: "job",
    canonical_owner: "job/work-order/visit records",
    existing_sources: Object.freeze([
      "apps/web/lib/jobs/**",
      "apps/web/lib/work-orders/**",
      "apps/web/lib/estimates/job-tm-briefing.ts",
    ]),
    projection_rule: "preserve Job, WorkOrder and Visit identities; do not collapse them into a memory record",
  }),
  Object.freeze({
    kind: "workflow",
    canonical_owner: "workflow/domain event records",
    existing_sources: Object.freeze([
      "apps/web/lib/workflow-events.ts",
      "apps/web/lib/workflow/**",
    ]),
    projection_rule: "carry correlation/causality references and current workflow state, never a second workflow queue",
  }),
  Object.freeze({
    kind: "authority",
    canonical_owner: "governed workforce command + authority runtime",
    existing_sources: Object.freeze([
      "apps/web/lib/titan/workforce-command-gateway.ts",
      "packages/titan-platform/src/ported/titan-modules/authority.ts",
      "packages/titan-platform/src/ported/TITAN-ZERO-WORKFORCE-PASS36-WORKER-MEMORY-ARCHITECTURE.json",
    ]),
    projection_rule: "carry authority provenance/revision only; context and memory never grant authority",
  }),
]);

export function getWorkforceContextSourceInventory(kind: WorkforceContextSourceKind) {
  return WORKFORCE_CONTEXT_SOURCE_INVENTORY.find((entry) => entry.kind === kind) ?? null;
}
