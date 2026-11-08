export type TitanBusinessWorkflowHierarchyTier = "manager" | "supervisor" | "agent" | "worker";
export type TitanBusinessWorkflowDelegationAuthorityCeiling =
  | "READ_ONLY"
  | "PROPOSE"
  | "WRITE_INTERNAL"
  | "EXTERNAL_COMMUNICATION"
  | "FINANCIAL"
  | "DESTRUCTIVE";

export type TitanBusinessWorkflowDelegationEvidence = Readonly<{
  companyId: string;
  delegationId: string;
  managerId: string;
  supervisorId: string;
  agentKey: string;
  agentInstanceId: string;
  workerId: string | null;
  authorityCeiling: TitanBusinessWorkflowDelegationAuthorityCeiling;
  causality: Readonly<{ correlationId: string }>;
}>;

export const TITAN_BUSINESS_WORKFLOW_WORKFORCE_PARTICIPANT_SCHEMA = "titan.zero.business.workflow-workforce-participant/v1" as const;

const TIER_RANK: Record<TitanBusinessWorkflowHierarchyTier, number> = {
  manager: 0,
  supervisor: 1,
  agent: 2,
  worker: 3,
};

const AUTHORITY_RANK: Record<TitanBusinessWorkflowDelegationAuthorityCeiling, number> = {
  READ_ONLY: 0,
  PROPOSE: 1,
  WRITE_INTERNAL: 2,
  EXTERNAL_COMMUNICATION: 3,
  FINANCIAL: 4,
  DESTRUCTIVE: 5,
};

export type TitanBusinessWorkflowParticipant = Readonly<{
  schema: typeof TITAN_BUSINESS_WORKFLOW_WORKFORCE_PARTICIPANT_SCHEMA;
  company_id: string;
  correlation_id: string;
  workflow_id: string;
  participant_id: string;
  tier: TitanBusinessWorkflowHierarchyTier;
  manager_id: string;
  supervisor_id: string | null;
  agent_id: string | null;
  worker_id: string | null;
  delegation_id: string | null;
  authority_ceiling: TitanBusinessWorkflowDelegationAuthorityCeiling;
  authority_decision_ref: string | null;
  capability_resolution_ref: string | null;
  can_execute: boolean;
  handoff_is_authority: false;
  hierarchy_is_authority: false;
  identity_is_authority: false;
}>;

export type TitanBusinessWorkflowParticipantHandoff = Readonly<{
  schema: "titan.zero.business.workflow-workforce-handoff/v1";
  company_id: string;
  correlation_id: string;
  workflow_id: string;
  handoff_id: string;
  from_participant_id: string;
  to_participant_id: string;
  from_tier: TitanBusinessWorkflowHierarchyTier;
  to_tier: TitanBusinessWorkflowHierarchyTier;
  delegation_id: string | null;
  authority_ceiling: TitanBusinessWorkflowDelegationAuthorityCeiling;
  summary: string;
  causal_ref: string | null;
  accepted: boolean;
  execution_permitted: boolean;
  reason_code: string;
  policies: Readonly<{
    adjacent_or_downstream_hierarchy_only: true;
    authority_may_only_contract: true;
    handoff_does_not_grant_authority: true;
    execution_requires_authority_decision: true;
    execution_requires_capability_resolution: true;
    canonical_domain_owner_remains_authoritative: true;
  }>;
}>;

function token(value: unknown, code: string, max = 180): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max || out.includes("/") || out.includes("\\") || out.includes("..")) throw new Error(code);
  return out;
}

function maybeToken(value: unknown, code: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return token(value, code);
}

export function createTitanBusinessWorkflowParticipant(input: Readonly<{
  companyId: string;
  correlationId: string;
  workflowId: string;
  participantId: string;
  tier: TitanBusinessWorkflowHierarchyTier;
  managerId: string;
  supervisorId?: string | null;
  agentId?: string | null;
  workerId?: string | null;
  delegation?: TitanBusinessWorkflowDelegationEvidence | null;
  authorityCeiling: TitanBusinessWorkflowDelegationAuthorityCeiling;
  authorityDecisionRef?: string | null;
  capabilityResolutionRef?: string | null;
}>): TitanBusinessWorkflowParticipant {
  const company_id = token(input.companyId, "workflow-participant-company-required");
  const correlation_id = token(input.correlationId, "workflow-participant-correlation-required");
  const workflow_id = token(input.workflowId, "workflow-participant-workflow-required");
  const participant_id = token(input.participantId, "workflow-participant-id-required");
  const manager_id = token(input.managerId, "workflow-participant-manager-required");
  const supervisor_id = maybeToken(input.supervisorId, "workflow-participant-supervisor-invalid");
  const agent_id = maybeToken(input.agentId, "workflow-participant-agent-invalid");
  const worker_id = maybeToken(input.workerId, "workflow-participant-worker-invalid");

  if (input.tier === "manager" && (supervisor_id || agent_id || worker_id)) throw new Error("workflow-participant-manager-parentage-invalid");
  if (input.tier === "supervisor" && (!supervisor_id || agent_id || worker_id)) throw new Error("workflow-participant-supervisor-parentage-invalid");
  if (input.tier === "agent" && (!supervisor_id || !agent_id || worker_id)) throw new Error("workflow-participant-agent-parentage-invalid");
  if (input.tier === "worker" && (!supervisor_id || !agent_id || !worker_id)) throw new Error("workflow-participant-worker-parentage-invalid");

  const delegation = input.delegation ?? null;
  if (delegation) {
    if (delegation.companyId !== company_id) throw new Error("workflow-participant-delegation-company-mismatch");
    if (delegation.causality.correlationId !== correlation_id) throw new Error("workflow-participant-delegation-correlation-mismatch");
    if (delegation.managerId !== manager_id) throw new Error("workflow-participant-delegation-manager-mismatch");
    if (supervisor_id && delegation.supervisorId !== supervisor_id) throw new Error("workflow-participant-delegation-supervisor-mismatch");
    if (agent_id && delegation.agentInstanceId !== agent_id && delegation.agentKey !== agent_id) throw new Error("workflow-participant-delegation-agent-mismatch");
    if (worker_id && delegation.workerId !== worker_id) throw new Error("workflow-participant-delegation-worker-mismatch");
    if (AUTHORITY_RANK[input.authorityCeiling] > AUTHORITY_RANK[delegation.authorityCeiling]) throw new Error("workflow-participant-authority-expansion-rejected");
  }

  const authority_decision_ref = maybeToken(input.authorityDecisionRef, "workflow-participant-authority-decision-invalid");
  const capability_resolution_ref = maybeToken(input.capabilityResolutionRef, "workflow-participant-capability-resolution-invalid");
  const can_execute = Boolean(authority_decision_ref && capability_resolution_ref);

  return Object.freeze({
    schema: TITAN_BUSINESS_WORKFLOW_WORKFORCE_PARTICIPANT_SCHEMA,
    company_id,
    correlation_id,
    workflow_id,
    participant_id,
    tier: input.tier,
    manager_id,
    supervisor_id,
    agent_id,
    worker_id,
    delegation_id: delegation?.delegationId ?? null,
    authority_ceiling: input.authorityCeiling,
    authority_decision_ref,
    capability_resolution_ref,
    can_execute,
    handoff_is_authority: false,
    hierarchy_is_authority: false,
    identity_is_authority: false,
  });
}

export function createTitanBusinessWorkflowParticipantHandoff(input: Readonly<{
  from: TitanBusinessWorkflowParticipant;
  to: TitanBusinessWorkflowParticipant;
  handoffId: string;
  summary: string;
  causalRef?: string | null;
}>): TitanBusinessWorkflowParticipantHandoff {
  const { from, to } = input;
  if (from.company_id !== to.company_id) throw new Error("workflow-handoff-company-mismatch");
  if (from.correlation_id !== to.correlation_id) throw new Error("workflow-handoff-correlation-mismatch");
  if (from.workflow_id !== to.workflow_id) throw new Error("workflow-handoff-workflow-mismatch");
  if (from.manager_id !== to.manager_id) throw new Error("workflow-handoff-manager-boundary-mismatch");
  if (TIER_RANK[to.tier] < TIER_RANK[from.tier]) throw new Error("workflow-handoff-upward-authority-shortcut-rejected");
  if (TIER_RANK[to.tier] - TIER_RANK[from.tier] > 1) throw new Error("workflow-handoff-hierarchy-skip-rejected");
  if (AUTHORITY_RANK[to.authority_ceiling] > AUTHORITY_RANK[from.authority_ceiling]) throw new Error("workflow-handoff-authority-expansion-rejected");

  const execution_permitted = to.can_execute === true;
  return Object.freeze({
    schema: "titan.zero.business.workflow-workforce-handoff/v1" as const,
    company_id: from.company_id,
    correlation_id: from.correlation_id,
    workflow_id: from.workflow_id,
    handoff_id: token(input.handoffId, "workflow-handoff-id-required"),
    from_participant_id: from.participant_id,
    to_participant_id: to.participant_id,
    from_tier: from.tier,
    to_tier: to.tier,
    delegation_id: to.delegation_id,
    authority_ceiling: to.authority_ceiling,
    summary: token(input.summary, "workflow-handoff-summary-required", 800),
    causal_ref: maybeToken(input.causalRef, "workflow-handoff-causal-ref-invalid"),
    accepted: true,
    execution_permitted,
    reason_code: execution_permitted ? "authority-and-capability-evidence-present" : "participant-only-authority-evidence-required",
    policies: Object.freeze({
      adjacent_or_downstream_hierarchy_only: true as const,
      authority_may_only_contract: true as const,
      handoff_does_not_grant_authority: true as const,
      execution_requires_authority_decision: true as const,
      execution_requires_capability_resolution: true as const,
      canonical_domain_owner_remains_authoritative: true as const,
    }),
  });
}
