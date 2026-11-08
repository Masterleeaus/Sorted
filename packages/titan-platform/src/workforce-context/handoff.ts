import type { WorkforceContextProjection } from "./projection.js";
import type { WorkforceTaskCheckpoint } from "./checkpoint.js";

export const WORKFORCE_CONTEXT_HANDOFF_SCHEMA = "titan.workforce.context-handoff/v1" as const;

export type WorkforceContextHandoffDecision = Readonly<{
  id: string;
  summary: string;
  decided_by: string;
  authority_source: string;
  authority_revision?: string | number | null;
}>;

export type WorkforceContextHandoffUnresolvedItem = Readonly<{
  id: string;
  summary: string;
  owner_hint?: string | null;
  blocker?: string | null;
}>;

export type WorkforceContextHandoff = Readonly<{
  schema: typeof WORKFORCE_CONTEXT_HANDOFF_SCHEMA;
  company_id: string;
  objective_id: string;
  task_id: string;
  correlation_id: string | null;
  from_actor_id: string;
  from_actor_role: string;
  to_agent_id: string;
  summary: string;
  causal_links: readonly string[];
  decisions: readonly WorkforceContextHandoffDecision[];
  unresolved_items: readonly WorkforceContextHandoffUnresolvedItem[];
  checkpoint_revision: number | null;
  authority: WorkforceContextProjection["authority"];
  created_at: string;
  policies: Readonly<{
    summary_only: true;
    canonical_records_remain_source_of_truth: true;
    handoff_is_not_authority: true;
    no_implicit_identity_access: true;
    company_boundary_fail_closed: true;
  }>;
}>;

export type CreateWorkforceContextHandoffInput = Readonly<{
  projection: WorkforceContextProjection;
  to_agent_id: string;
  summary: string;
  causal_links?: readonly string[];
  decisions?: readonly WorkforceContextHandoffDecision[];
  unresolved_items?: readonly WorkforceContextHandoffUnresolvedItem[];
  checkpoint?: WorkforceTaskCheckpoint | null;
  created_at?: string;
  business_payload?: never;
  tenant_id?: never;
  tenant_company_id?: never;
}>;

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function normalizeUnique(values: readonly string[] | undefined, field: string): readonly string[] {
  return Object.freeze([...new Set((values ?? []).map((value) => requireNonEmpty(value, field)))]);
}

function requireIsoTimestamp(value: string | undefined): string {
  const timestamp = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError("created_at must be a valid timestamp");
  return timestamp;
}

function assertNoForbiddenKeys(input: object): void {
  for (const key of ["business_payload", "tenant_id", "tenant_company_id"]) {
    if (key in input) throw new TypeError(`${key} is not allowed in a workforce context handoff`);
  }
}

/**
 * Create a compact cross-agent handoff. It carries only causal/decision/progress
 * summaries and authority provenance; canonical business records remain external.
 */
export function createWorkforceContextHandoff(
  input: CreateWorkforceContextHandoffInput,
): WorkforceContextHandoff {
  if (!input || typeof input !== "object") throw new TypeError("handoff input is required");
  assertNoForbiddenKeys(input);
  const projection = input.projection;
  if (!projection || typeof projection !== "object") throw new TypeError("projection is required");

  if (input.checkpoint) {
    if (input.checkpoint.company_id !== projection.company_id) throw new TypeError("checkpoint company_id mismatch");
    if (input.checkpoint.task_id !== projection.task_id) throw new TypeError("checkpoint task_id mismatch");
    if (input.checkpoint.worker_id !== projection.worker_id) throw new TypeError("checkpoint worker_id mismatch");
  }

  const decisions = Object.freeze((input.decisions ?? []).map((decision) => Object.freeze({
    id: requireNonEmpty(decision.id, "decision.id"),
    summary: requireNonEmpty(decision.summary, "decision.summary"),
    decided_by: requireNonEmpty(decision.decided_by, "decision.decided_by"),
    authority_source: requireNonEmpty(decision.authority_source, "decision.authority_source"),
    authority_revision: decision.authority_revision ?? null,
  })));

  const decisionIds = new Set(decisions.map((decision) => decision.id));
  if (decisionIds.size !== decisions.length) throw new TypeError("duplicate handoff decision id");

  const unresolvedItems = Object.freeze((input.unresolved_items ?? []).map((item) => Object.freeze({
    id: requireNonEmpty(item.id, "unresolved_item.id"),
    summary: requireNonEmpty(item.summary, "unresolved_item.summary"),
    owner_hint: item.owner_hint ? requireNonEmpty(item.owner_hint, "unresolved_item.owner_hint") : null,
    blocker: item.blocker ? requireNonEmpty(item.blocker, "unresolved_item.blocker") : null,
  })));
  const unresolvedIds = new Set(unresolvedItems.map((item) => item.id));
  if (unresolvedIds.size !== unresolvedItems.length) throw new TypeError("duplicate unresolved item id");

  return Object.freeze({
    schema: WORKFORCE_CONTEXT_HANDOFF_SCHEMA,
    company_id: requireNonEmpty(projection.company_id, "projection.company_id"),
    objective_id: requireNonEmpty(projection.objective_id, "projection.objective_id"),
    task_id: requireNonEmpty(projection.task_id, "projection.task_id"),
    correlation_id: projection.correlation_id ?? null,
    from_actor_id: requireNonEmpty(projection.authority.actor_id, "authority.actor_id"),
    from_actor_role: requireNonEmpty(projection.authority.actor_role, "authority.actor_role"),
    to_agent_id: requireNonEmpty(input.to_agent_id, "to_agent_id"),
    summary: requireNonEmpty(input.summary, "summary"),
    causal_links: normalizeUnique(input.causal_links, "causal_links entry"),
    decisions,
    unresolved_items: unresolvedItems,
    checkpoint_revision: input.checkpoint?.checkpoint_revision ?? null,
    authority: projection.authority,
    created_at: requireIsoTimestamp(input.created_at),
    policies: Object.freeze({
      summary_only: true,
      canonical_records_remain_source_of_truth: true,
      handoff_is_not_authority: true,
      no_implicit_identity_access: true,
      company_boundary_fail_closed: true,
    }),
  });
}
