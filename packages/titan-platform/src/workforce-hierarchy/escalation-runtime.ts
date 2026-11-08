import { assertTitanWorkforceCompanyId } from "./contract.js";
import type { TitanWorkforceHierarchyDelegationEnvelope } from "./delegation-envelope.js";

export const TITAN_WORKFORCE_HIERARCHY_ESCALATION_SCHEMA = "titan.workforce.hierarchy-escalation.v1" as const;
export const TITAN_WORKFORCE_HIERARCHY_APPROVAL_GATE_SCHEMA = "titan.workforce.hierarchy-approval-gate.v1" as const;

export const TITAN_WORKFORCE_ESCALATION_TIERS = Object.freeze(["worker", "agent", "supervisor", "manager"] as const);
export type TitanWorkforceEscalationTier = (typeof TITAN_WORKFORCE_ESCALATION_TIERS)[number];

export type TitanWorkforceHierarchyEscalation = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_ESCALATION_SCHEMA;
  companyId: string;
  escalationId: string;
  delegationId: string;
  currentTier: TitanWorkforceEscalationTier;
  targetTier: TitanWorkforceEscalationTier;
  reason: string;
  severity: "low" | "normal" | "high" | "critical";
  state: "open" | "acknowledged" | "resolved" | "cancelled";
  path: readonly TitanWorkforceEscalationTier[];
  ancestry: Readonly<{
    managerId: string;
    supervisorId: string;
    agentKey: string;
    workerId: string | null;
  }>;
  escalationConfersExecutionAuthority: false;
  deEscalationConfersExecutionAuthority: false;
  executionPermitted: false;
}>;

export type TitanWorkforceHierarchyApprovalGate = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_APPROVAL_GATE_SCHEMA;
  companyId: string;
  gateId: string;
  delegationId: string;
  escalationId: string | null;
  requiredTier: Exclude<TitanWorkforceEscalationTier, "worker">;
  requiredApproverId: string;
  reason: string;
  state: "pending" | "approved" | "denied" | "cancelled";
  decisionById: string | null;
  decisionReason: string | null;
  approvalConfersExecutionAuthority: false;
  executionPermitted: false;
  requiresAuthorityEvaluation: true;
  requiresCapabilityResolution: true;
}>;

const TIER_RANK: Readonly<Record<TitanWorkforceEscalationTier, number>> = Object.freeze({
  worker: 0,
  agent: 1,
  supervisor: 2,
  manager: 3,
});
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,180}$/;

function requireId(value: unknown, label: string) {
  const normalized = String(value ?? "").trim().slice(0, 180);
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label}-required`);
  return normalized;
}
function requireText(value: unknown, label: string, max = 1200) {
  const normalized = String(value ?? "").trim().slice(0, max);
  if (!normalized) throw new Error(`${label}-required`);
  return normalized;
}
function assertTier(value: unknown): TitanWorkforceEscalationTier {
  const tier = String(value ?? "") as TitanWorkforceEscalationTier;
  if (!TITAN_WORKFORCE_ESCALATION_TIERS.includes(tier)) throw new Error("workforce-hierarchy-escalation-tier-invalid");
  return tier;
}
function adjacent(from: TitanWorkforceEscalationTier, to: TitanWorkforceEscalationTier) {
  return Math.abs(TIER_RANK[from] - TIER_RANK[to]) === 1;
}
function approverIdForTier(envelope: TitanWorkforceHierarchyDelegationEnvelope, tier: Exclude<TitanWorkforceEscalationTier, "worker">) {
  if (tier === "agent") return envelope.agentKey;
  if (tier === "supervisor") return envelope.supervisorId;
  return envelope.managerId;
}

export function createTitanWorkforceHierarchyEscalation(input: {
  envelope: TitanWorkforceHierarchyDelegationEnvelope;
  escalationId: string;
  fromTier: TitanWorkforceEscalationTier;
  toTier: TitanWorkforceEscalationTier;
  reason: string;
  severity?: TitanWorkforceHierarchyEscalation["severity"];
}): TitanWorkforceHierarchyEscalation {
  const companyId = assertTitanWorkforceCompanyId(input.envelope.companyId);
  const fromTier = assertTier(input.fromTier);
  const toTier = assertTier(input.toTier);
  if (TIER_RANK[toTier] <= TIER_RANK[fromTier] || !adjacent(fromTier, toTier)) {
    throw new Error("workforce-hierarchy-escalation-must-move-one-tier-up");
  }
  if (fromTier === "worker" && !input.envelope.workerId) throw new Error("workforce-hierarchy-escalation-worker-context-required");
  const severity = input.severity ?? "normal";
  if (!["low", "normal", "high", "critical"].includes(severity)) throw new Error("workforce-hierarchy-escalation-severity-invalid");
  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_ESCALATION_SCHEMA,
    companyId,
    escalationId: requireId(input.escalationId, "workforce-hierarchy-escalation-id"),
    delegationId: input.envelope.delegationId,
    currentTier: fromTier,
    targetTier: toTier,
    reason: requireText(input.reason, "workforce-hierarchy-escalation-reason"),
    severity,
    state: "open",
    path: Object.freeze([fromTier, toTier]),
    ancestry: Object.freeze({
      managerId: input.envelope.managerId,
      supervisorId: input.envelope.supervisorId,
      agentKey: input.envelope.agentKey,
      workerId: input.envelope.workerId,
    }),
    escalationConfersExecutionAuthority: false,
    deEscalationConfersExecutionAuthority: false,
    executionPermitted: false,
  });
}

export function escalateTitanWorkforceHierarchyCase(
  escalation: TitanWorkforceHierarchyEscalation,
  toTier: TitanWorkforceEscalationTier,
): TitanWorkforceHierarchyEscalation {
  if (!["open", "acknowledged"].includes(escalation.state)) throw new Error("workforce-hierarchy-escalation-not-open");
  const next = assertTier(toTier);
  if (TIER_RANK[next] <= TIER_RANK[escalation.targetTier] || !adjacent(escalation.targetTier, next)) {
    throw new Error("workforce-hierarchy-escalation-must-move-one-tier-up");
  }
  return Object.freeze({ ...escalation, currentTier: escalation.targetTier, targetTier: next, path: Object.freeze([...escalation.path, next]) });
}

export function deEscalateTitanWorkforceHierarchyCase(
  escalation: TitanWorkforceHierarchyEscalation,
  toTier: TitanWorkforceEscalationTier,
): TitanWorkforceHierarchyEscalation {
  if (!['acknowledged', 'resolved'].includes(escalation.state)) throw new Error("workforce-hierarchy-deescalation-requires-acknowledged-or-resolved");
  const next = assertTier(toTier);
  if (TIER_RANK[next] >= TIER_RANK[escalation.targetTier] || !adjacent(escalation.targetTier, next)) {
    throw new Error("workforce-hierarchy-deescalation-must-move-one-tier-down");
  }
  return Object.freeze({ ...escalation, currentTier: escalation.targetTier, targetTier: next, path: Object.freeze([...escalation.path, next]) });
}

export function setTitanWorkforceHierarchyEscalationState(
  escalation: TitanWorkforceHierarchyEscalation,
  state: TitanWorkforceHierarchyEscalation["state"],
): TitanWorkforceHierarchyEscalation {
  if (!["open", "acknowledged", "resolved", "cancelled"].includes(state)) throw new Error("workforce-hierarchy-escalation-state-invalid");
  if (escalation.state === "cancelled" || escalation.state === "resolved") {
    if (state !== escalation.state) throw new Error("workforce-hierarchy-escalation-terminal-state");
  }
  return Object.freeze({ ...escalation, state });
}

export function createTitanWorkforceHierarchyApprovalGate(input: {
  envelope: TitanWorkforceHierarchyDelegationEnvelope;
  gateId: string;
  requiredTier: Exclude<TitanWorkforceEscalationTier, "worker">;
  reason: string;
  escalation?: TitanWorkforceHierarchyEscalation | null;
}): TitanWorkforceHierarchyApprovalGate {
  const companyId = assertTitanWorkforceCompanyId(input.envelope.companyId);
  if (input.escalation && (input.escalation.companyId !== companyId || input.escalation.delegationId !== input.envelope.delegationId)) {
    throw new Error("workforce-hierarchy-approval-escalation-context-mismatch");
  }
  if (!["agent", "supervisor", "manager"].includes(input.requiredTier)) throw new Error("workforce-hierarchy-approval-tier-invalid");
  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_APPROVAL_GATE_SCHEMA,
    companyId,
    gateId: requireId(input.gateId, "workforce-hierarchy-approval-gate-id"),
    delegationId: input.envelope.delegationId,
    escalationId: input.escalation?.escalationId ?? null,
    requiredTier: input.requiredTier,
    requiredApproverId: approverIdForTier(input.envelope, input.requiredTier),
    reason: requireText(input.reason, "workforce-hierarchy-approval-reason"),
    state: "pending",
    decisionById: null,
    decisionReason: null,
    approvalConfersExecutionAuthority: false,
    executionPermitted: false,
    requiresAuthorityEvaluation: true,
    requiresCapabilityResolution: true,
  });
}

export function decideTitanWorkforceHierarchyApprovalGate(
  gate: TitanWorkforceHierarchyApprovalGate,
  input: { companyId: string; approverId: string; tier: Exclude<TitanWorkforceEscalationTier, "worker">; decision: "approved" | "denied"; reason?: string },
): TitanWorkforceHierarchyApprovalGate {
  const companyId = assertTitanWorkforceCompanyId(input.companyId);
  if (gate.companyId !== companyId) throw new Error("workforce-hierarchy-approval-cross-company-rejected");
  if (gate.state !== "pending") throw new Error("workforce-hierarchy-approval-already-decided");
  if (input.tier !== gate.requiredTier) throw new Error("workforce-hierarchy-approval-tier-mismatch");
  const approverId = requireId(input.approverId, "workforce-hierarchy-approval-approver-id");
  if (approverId !== gate.requiredApproverId) throw new Error("workforce-hierarchy-approval-approver-mismatch");
  return Object.freeze({
    ...gate,
    state: input.decision,
    decisionById: approverId,
    decisionReason: input.reason ? requireText(input.reason, "workforce-hierarchy-approval-decision-reason") : null,
  });
}

export function evaluateTitanWorkforceHierarchyApprovalChain(gates: readonly TitanWorkforceHierarchyApprovalGate[]) {
  const denied = gates.filter((gate) => gate.state === "denied");
  const pending = gates.filter((gate) => gate.state === "pending");
  const cancelled = gates.filter((gate) => gate.state === "cancelled");
  const allApproved = gates.length > 0 && gates.every((gate) => gate.state === "approved");
  return Object.freeze({
    gateCount: gates.length,
    approvedCount: gates.filter((gate) => gate.state === "approved").length,
    pendingCount: pending.length,
    deniedCount: denied.length,
    cancelledCount: cancelled.length,
    state: denied.length || cancelled.length ? "BLOCKED" : allApproved ? "READY_FOR_AUTHORITY_GATE" : "PENDING_APPROVAL",
    executionPermitted: false as const,
    hierarchyApprovalConfersExecutionAuthority: false as const,
    requiresAuthorityEvaluation: true as const,
    requiresCapabilityResolution: true as const,
  });
}
