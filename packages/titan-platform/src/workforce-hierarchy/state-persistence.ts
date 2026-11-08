import { assertTitanWorkforceCompanyId } from "./contract.js";
import {
  assertTitanWorkforceAgentBinding,
  bindTitanWorkforceAgentToSupervisor,
  type TitanWorkforceAgentBinding,
} from "./agent-binding.js";
import { validateTitanWorkforceHierarchyDelegationEnvelope, type TitanWorkforceHierarchyDelegationEnvelope } from "./delegation-envelope.js";
import {
  TITAN_WORKFORCE_HIERARCHY_APPROVAL_GATE_SCHEMA,
  TITAN_WORKFORCE_HIERARCHY_ESCALATION_SCHEMA,
  type TitanWorkforceHierarchyApprovalGate,
  type TitanWorkforceHierarchyEscalation,
} from "./escalation-runtime.js";
import { createTitanWorkforceManagerRuntime, type TitanWorkforceManagerRuntime } from "./manager-runtime.js";
import { createTitanWorkforceSupervisorRuntime, type TitanWorkforceSupervisorRuntime } from "./supervisor-runtime.js";
import { createTitanWorkforceWorkerRuntime, type TitanWorkforceWorkerRuntime } from "./worker-runtime.js";

export const TITAN_WORKFORCE_HIERARCHY_STATE_SNAPSHOT_SCHEMA = "titan.workforce.hierarchy-state-snapshot.v1" as const;
export const TITAN_WORKFORCE_HIERARCHY_AUDIT_EVENT_SCHEMA = "titan.workforce.hierarchy-audit-event.v1" as const;
export const TITAN_WORKFORCE_HIERARCHY_REPARENT_PROPOSAL_SCHEMA = "titan.workforce.hierarchy-reparent-proposal.v1" as const;

export type TitanWorkforceHierarchyAuditEvent = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_AUDIT_EVENT_SCHEMA;
  companyId: string;
  eventId: string;
  eventType: "snapshot_created" | "restart_recovered" | "reparent_proposed" | "reparent_applied";
  actorId: string;
  targetTier: "hierarchy" | "supervisor" | "agent" | "worker";
  targetId: string;
  revision: number;
  occurredAt: string;
  reason: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  eventConfersExecutionAuthority: false;
}>;

export type TitanWorkforceHierarchyStateSnapshot = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_STATE_SNAPSHOT_SCHEMA;
  companyId: string;
  revision: number;
  createdAt: string;
  managerRuntimes: readonly TitanWorkforceManagerRuntime[];
  supervisorRuntimes: readonly TitanWorkforceSupervisorRuntime[];
  agentBindings: readonly TitanWorkforceAgentBinding[];
  workers: readonly TitanWorkforceWorkerRuntime[];
  delegations: readonly TitanWorkforceHierarchyDelegationEnvelope[];
  escalations: readonly TitanWorkforceHierarchyEscalation[];
  approvalGates: readonly TitanWorkforceHierarchyApprovalGate[];
  auditHistory: readonly TitanWorkforceHierarchyAuditEvent[];
  persistence: Readonly<{
    format: "json";
    deviceFirst: true;
    validationRequiredOnRecovery: true;
    snapshotConfersExecutionAuthority: false;
    recoveredStateConfersExecutionAuthority: false;
  }>;
}>;

export type TitanWorkforceHierarchyReparentProposal = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_REPARENT_PROPOSAL_SCHEMA;
  companyId: string;
  proposalId: string;
  targetTier: "supervisor" | "agent" | "worker";
  targetId: string;
  oldParentId: string;
  newParentId: string;
  newDomainId: string | null;
  expectedRevision: number;
  requestedById: string;
  reason: string;
  createdAt: string;
  reparentingConfersExecutionAuthority: false;
  requiresDrainedDelegations: true;
}>;

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
function normalizeIso(value: string | undefined, label: string) {
  const ms = Date.parse(value ?? new Date().toISOString());
  if (!Number.isFinite(ms)) throw new Error(`${label}-invalid`);
  return new Date(ms).toISOString();
}
function normalizeRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("workforce-hierarchy-state-revision-invalid");
  return revision;
}
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function uniqueBy<T>(values: readonly T[], key: (value: T) => string, label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) throw new Error(`${label}-duplicate`);
    seen.add(id);
  }
}

export function createTitanWorkforceHierarchyAuditEvent(input: {
  companyId: string;
  eventId: string;
  eventType: TitanWorkforceHierarchyAuditEvent["eventType"];
  actorId: string;
  targetTier: TitanWorkforceHierarchyAuditEvent["targetTier"];
  targetId: string;
  revision: number;
  occurredAt?: string;
  reason?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}): TitanWorkforceHierarchyAuditEvent {
  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_AUDIT_EVENT_SCHEMA,
    companyId: assertTitanWorkforceCompanyId(input.companyId),
    eventId: requireId(input.eventId, "workforce-hierarchy-audit-event-id"),
    eventType: input.eventType,
    actorId: requireId(input.actorId, "workforce-hierarchy-audit-actor-id"),
    targetTier: input.targetTier,
    targetId: requireId(input.targetId, "workforce-hierarchy-audit-target-id"),
    revision: normalizeRevision(input.revision),
    occurredAt: normalizeIso(input.occurredAt, "workforce-hierarchy-audit-occurred-at"),
    reason: input.reason ? requireText(input.reason, "workforce-hierarchy-audit-reason") : null,
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    eventConfersExecutionAuthority: false,
  });
}

export function createTitanWorkforceHierarchyStateSnapshot(input: {
  companyId: string;
  revision?: number;
  createdAt?: string;
  managerRuntimes?: readonly TitanWorkforceManagerRuntime[];
  supervisorRuntimes?: readonly TitanWorkforceSupervisorRuntime[];
  agentBindings?: readonly TitanWorkforceAgentBinding[];
  workers?: readonly TitanWorkforceWorkerRuntime[];
  delegations?: readonly TitanWorkforceHierarchyDelegationEnvelope[];
  escalations?: readonly TitanWorkforceHierarchyEscalation[];
  approvalGates?: readonly TitanWorkforceHierarchyApprovalGate[];
  auditHistory?: readonly TitanWorkforceHierarchyAuditEvent[];
}): TitanWorkforceHierarchyStateSnapshot {
  const snapshot: TitanWorkforceHierarchyStateSnapshot = Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_STATE_SNAPSHOT_SCHEMA,
    companyId: assertTitanWorkforceCompanyId(input.companyId),
    revision: normalizeRevision(input.revision ?? 0),
    createdAt: normalizeIso(input.createdAt, "workforce-hierarchy-state-created-at"),
    managerRuntimes: Object.freeze(cloneJson(input.managerRuntimes ?? [])),
    supervisorRuntimes: Object.freeze(cloneJson(input.supervisorRuntimes ?? [])),
    agentBindings: Object.freeze(cloneJson(input.agentBindings ?? [])),
    workers: Object.freeze(cloneJson(input.workers ?? [])),
    delegations: Object.freeze(cloneJson(input.delegations ?? [])),
    escalations: Object.freeze(cloneJson(input.escalations ?? [])),
    approvalGates: Object.freeze(cloneJson(input.approvalGates ?? [])),
    auditHistory: Object.freeze(cloneJson(input.auditHistory ?? [])),
    persistence: Object.freeze({
      format: "json",
      deviceFirst: true,
      validationRequiredOnRecovery: true,
      snapshotConfersExecutionAuthority: false,
      recoveredStateConfersExecutionAuthority: false,
    }),
  });
  validateTitanWorkforceHierarchyStateSnapshot(snapshot);
  return snapshot;
}

export function validateTitanWorkforceHierarchyStateSnapshot(snapshot: TitanWorkforceHierarchyStateSnapshot) {
  const companyId = assertTitanWorkforceCompanyId(snapshot.companyId);
  if (snapshot.schema !== TITAN_WORKFORCE_HIERARCHY_STATE_SNAPSHOT_SCHEMA) throw new Error("workforce-hierarchy-state-schema-invalid");
  normalizeRevision(snapshot.revision);
  normalizeIso(snapshot.createdAt, "workforce-hierarchy-state-created-at");
  if (snapshot.persistence.snapshotConfersExecutionAuthority || snapshot.persistence.recoveredStateConfersExecutionAuthority) {
    throw new Error("workforce-hierarchy-state-authority-expansion-rejected");
  }

  uniqueBy(snapshot.managerRuntimes, (item) => item.managerId, "workforce-hierarchy-state-manager");
  uniqueBy(snapshot.supervisorRuntimes, (item) => item.supervisorId, "workforce-hierarchy-state-supervisor");
  uniqueBy(snapshot.agentBindings, (item) => item.agentInstanceId, "workforce-hierarchy-state-agent");
  uniqueBy(snapshot.workers, (item) => item.workerId, "workforce-hierarchy-state-worker");
  uniqueBy(snapshot.delegations, (item) => item.delegationId, "workforce-hierarchy-state-delegation");
  uniqueBy(snapshot.auditHistory, (item) => item.eventId, "workforce-hierarchy-state-audit-event");

  const managers = new Map(snapshot.managerRuntimes.map((item) => [item.managerId, item]));
  const supervisors = new Map(snapshot.supervisorRuntimes.map((item) => [item.supervisorId, item]));
  const agents = new Map(snapshot.agentBindings.map((item) => [item.agentInstanceId, item]));
  const workers = new Map(snapshot.workers.map((item) => [item.workerId, item]));
  const delegations = new Map(snapshot.delegations.map((item) => [item.delegationId, item]));

  for (const manager of snapshot.managerRuntimes) {
    if (manager.companyId !== companyId) throw new Error("workforce-hierarchy-state-cross-company-manager-rejected");
    createTitanWorkforceManagerRuntime(manager);
  }
  for (const supervisor of snapshot.supervisorRuntimes) {
    if (supervisor.companyId !== companyId) throw new Error("workforce-hierarchy-state-cross-company-supervisor-rejected");
    if (!managers.has(supervisor.managerId)) throw new Error("workforce-hierarchy-state-supervisor-manager-missing");
    createTitanWorkforceSupervisorRuntime(supervisor);
  }
  for (const binding of snapshot.agentBindings) {
    if (!supervisors.has(binding.supervisorId)) throw new Error("workforce-hierarchy-state-agent-supervisor-missing");
    assertTitanWorkforceAgentBinding(binding, { companyId, supervisorId: binding.supervisorId, managerId: binding.managerId });
    const supervisor = supervisors.get(binding.supervisorId)!;
    if (supervisor.managerId !== binding.managerId) throw new Error("workforce-hierarchy-state-agent-manager-mismatch");
  }
  for (const worker of snapshot.workers) {
    if (worker.companyId !== companyId) throw new Error("workforce-hierarchy-state-cross-company-worker-rejected");
    const binding = [...agents.values()].find((item) => item.agentKey === worker.agentKey && item.supervisorId === worker.supervisorId);
    if (!binding || binding.managerId !== worker.managerId || binding.domainId !== worker.domainId) {
      throw new Error("workforce-hierarchy-state-worker-parentage-mismatch");
    }
    if (worker.identityConfersExecutionAuthority || worker.parentageConfersExecutionAuthority || worker.bindingConfersExecutionAuthority || worker.mayDelegate) {
      throw new Error("workforce-hierarchy-state-worker-authority-expansion-rejected");
    }
  }
  for (const delegation of snapshot.delegations) {
    const result = validateTitanWorkforceHierarchyDelegationEnvelope(delegation);
    if (!result.ok) throw new Error(`workforce-hierarchy-state-delegation-invalid:${result.errors.join(",")}`);
    if (delegation.companyId !== companyId) throw new Error("workforce-hierarchy-state-cross-company-delegation-rejected");
    const binding = [...agents.values()].find((item) => item.agentKey === delegation.agentKey && item.agentInstanceId === delegation.agentInstanceId);
    if (!binding || binding.managerId !== delegation.managerId || binding.supervisorId !== delegation.supervisorId || binding.domainId !== delegation.domainId) {
      throw new Error("workforce-hierarchy-state-delegation-parentage-mismatch");
    }
    if (delegation.workerId && !workers.has(delegation.workerId)) throw new Error("workforce-hierarchy-state-delegation-worker-missing");
  }
  for (const escalation of snapshot.escalations) {
    if (escalation.schema !== TITAN_WORKFORCE_HIERARCHY_ESCALATION_SCHEMA || escalation.companyId !== companyId) {
      throw new Error("workforce-hierarchy-state-escalation-invalid");
    }
    if (!delegations.has(escalation.delegationId)) throw new Error("workforce-hierarchy-state-escalation-delegation-missing");
    if (escalation.executionPermitted || escalation.escalationConfersExecutionAuthority || escalation.deEscalationConfersExecutionAuthority) {
      throw new Error("workforce-hierarchy-state-escalation-authority-expansion-rejected");
    }
  }
  for (const gate of snapshot.approvalGates) {
    if (gate.schema !== TITAN_WORKFORCE_HIERARCHY_APPROVAL_GATE_SCHEMA || gate.companyId !== companyId) {
      throw new Error("workforce-hierarchy-state-approval-gate-invalid");
    }
    if (!delegations.has(gate.delegationId)) throw new Error("workforce-hierarchy-state-approval-delegation-missing");
    if (gate.executionPermitted || gate.approvalConfersExecutionAuthority) throw new Error("workforce-hierarchy-state-approval-authority-expansion-rejected");
  }
  for (const event of snapshot.auditHistory) {
    if (event.schema !== TITAN_WORKFORCE_HIERARCHY_AUDIT_EVENT_SCHEMA || event.companyId !== companyId || event.eventConfersExecutionAuthority) {
      throw new Error("workforce-hierarchy-state-audit-event-invalid");
    }
  }
  return Object.freeze({
    ok: true as const,
    companyId,
    revision: snapshot.revision,
    counts: Object.freeze({
      managers: snapshot.managerRuntimes.length,
      supervisors: snapshot.supervisorRuntimes.length,
      agents: snapshot.agentBindings.length,
      workers: snapshot.workers.length,
      delegations: snapshot.delegations.length,
      escalations: snapshot.escalations.length,
      approvalGates: snapshot.approvalGates.length,
      auditEvents: snapshot.auditHistory.length,
    }),
  });
}

export function serializeTitanWorkforceHierarchyStateSnapshot(snapshot: TitanWorkforceHierarchyStateSnapshot) {
  validateTitanWorkforceHierarchyStateSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function recoverTitanWorkforceHierarchyStateSnapshot(serialized: string, input?: { expectedCompanyId?: string }) {
  let parsed: TitanWorkforceHierarchyStateSnapshot;
  try {
    parsed = JSON.parse(serialized) as TitanWorkforceHierarchyStateSnapshot;
  } catch {
    throw new Error("workforce-hierarchy-state-recovery-json-invalid");
  }
  if (input?.expectedCompanyId && parsed.companyId !== assertTitanWorkforceCompanyId(input.expectedCompanyId)) {
    throw new Error("workforce-hierarchy-state-recovery-company-mismatch");
  }
  const validation = validateTitanWorkforceHierarchyStateSnapshot(parsed);
  const snapshot = createTitanWorkforceHierarchyStateSnapshot(parsed);
  return Object.freeze({
    snapshot,
    validation,
    restartSafe: true as const,
    executionPermitted: false as const,
    requiresAuthorityReevaluationForExecution: true as const,
  });
}

export function appendTitanWorkforceHierarchyAuditEvent(
  snapshot: TitanWorkforceHierarchyStateSnapshot,
  event: TitanWorkforceHierarchyAuditEvent,
): TitanWorkforceHierarchyStateSnapshot {
  validateTitanWorkforceHierarchyStateSnapshot(snapshot);
  if (event.companyId !== snapshot.companyId) throw new Error("workforce-hierarchy-audit-cross-company-rejected");
  if (event.revision < snapshot.revision) throw new Error("workforce-hierarchy-audit-revision-regression-rejected");
  if (snapshot.auditHistory.some((item) => item.eventId === event.eventId)) throw new Error("workforce-hierarchy-audit-event-duplicate");
  return createTitanWorkforceHierarchyStateSnapshot({ ...snapshot, auditHistory: [...snapshot.auditHistory, event] });
}

export function createTitanWorkforceHierarchyReparentProposal(input: {
  snapshot: TitanWorkforceHierarchyStateSnapshot;
  proposalId: string;
  targetTier: TitanWorkforceHierarchyReparentProposal["targetTier"];
  targetId: string;
  newParentId: string;
  newDomainId?: string | null;
  requestedById: string;
  reason: string;
  createdAt?: string;
}): TitanWorkforceHierarchyReparentProposal {
  validateTitanWorkforceHierarchyStateSnapshot(input.snapshot);
  const targetId = requireId(input.targetId, "workforce-hierarchy-reparent-target-id");
  let oldParentId: string;
  if (input.targetTier === "supervisor") {
    const target = input.snapshot.supervisorRuntimes.find((item) => item.supervisorId === targetId);
    if (!target) throw new Error("workforce-hierarchy-reparent-supervisor-missing");
    oldParentId = target.managerId;
  } else if (input.targetTier === "agent") {
    const target = input.snapshot.agentBindings.find((item) => item.agentInstanceId === targetId || item.agentKey === targetId);
    if (!target) throw new Error("workforce-hierarchy-reparent-agent-missing");
    oldParentId = target.supervisorId;
  } else {
    const target = input.snapshot.workers.find((item) => item.workerId === targetId);
    if (!target) throw new Error("workforce-hierarchy-reparent-worker-missing");
    oldParentId = target.agentInstanceId;
  }
  const newParentId = requireId(input.newParentId, "workforce-hierarchy-reparent-new-parent-id");
  if (newParentId === oldParentId) throw new Error("workforce-hierarchy-reparent-parent-unchanged");
  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_REPARENT_PROPOSAL_SCHEMA,
    companyId: input.snapshot.companyId,
    proposalId: requireId(input.proposalId, "workforce-hierarchy-reparent-proposal-id"),
    targetTier: input.targetTier,
    targetId,
    oldParentId,
    newParentId,
    newDomainId: input.newDomainId ? requireId(input.newDomainId, "workforce-hierarchy-reparent-new-domain-id") : null,
    expectedRevision: input.snapshot.revision,
    requestedById: requireId(input.requestedById, "workforce-hierarchy-reparent-requested-by-id"),
    reason: requireText(input.reason, "workforce-hierarchy-reparent-reason"),
    createdAt: normalizeIso(input.createdAt, "workforce-hierarchy-reparent-created-at"),
    reparentingConfersExecutionAuthority: false,
    requiresDrainedDelegations: true,
  });
}

function assertReparentTargetDrained(snapshot: TitanWorkforceHierarchyStateSnapshot, proposal: TitanWorkforceHierarchyReparentProposal) {
  const blocked = snapshot.delegations.some((delegation) => {
    if (proposal.targetTier === "supervisor") return delegation.supervisorId === proposal.targetId;
    if (proposal.targetTier === "agent") {
      const binding = snapshot.agentBindings.find((item) => item.agentInstanceId === proposal.targetId || item.agentKey === proposal.targetId);
      return !!binding && delegation.agentInstanceId === binding.agentInstanceId;
    }
    return delegation.workerId === proposal.targetId;
  });
  if (blocked) throw new Error("workforce-hierarchy-reparent-active-delegations-must-drain");
}

export function applyTitanWorkforceHierarchyReparentProposal(
  snapshot: TitanWorkforceHierarchyStateSnapshot,
  proposal: TitanWorkforceHierarchyReparentProposal,
): TitanWorkforceHierarchyStateSnapshot {
  validateTitanWorkforceHierarchyStateSnapshot(snapshot);
  if (proposal.schema !== TITAN_WORKFORCE_HIERARCHY_REPARENT_PROPOSAL_SCHEMA) throw new Error("workforce-hierarchy-reparent-proposal-invalid");
  if (proposal.companyId !== snapshot.companyId) throw new Error("workforce-hierarchy-reparent-cross-company-rejected");
  if (proposal.expectedRevision !== snapshot.revision) throw new Error("workforce-hierarchy-reparent-revision-conflict");
  if (proposal.reparentingConfersExecutionAuthority) throw new Error("workforce-hierarchy-reparent-authority-expansion-rejected");
  assertReparentTargetDrained(snapshot, proposal);

  let supervisorRuntimes = [...snapshot.supervisorRuntimes];
  let agentBindings = [...snapshot.agentBindings];
  let workers = [...snapshot.workers];

  if (proposal.targetTier === "supervisor") {
    const targetIndex = supervisorRuntimes.findIndex((item) => item.supervisorId === proposal.targetId);
    if (targetIndex < 0) throw new Error("workforce-hierarchy-reparent-supervisor-missing");
    const newManager = snapshot.managerRuntimes.find((item) => item.managerId === proposal.newParentId);
    if (!newManager) throw new Error("workforce-hierarchy-reparent-manager-missing");
    const current = supervisorRuntimes[targetIndex];
    if (current.managerId !== proposal.oldParentId) throw new Error("workforce-hierarchy-reparent-old-parent-mismatch");
    const updated = createTitanWorkforceSupervisorRuntime({ ...current, managerId: newManager.managerId });
    supervisorRuntimes[targetIndex] = updated;
    agentBindings = agentBindings.map((binding) => binding.supervisorId === current.supervisorId ? { ...binding, managerId: newManager.managerId } : binding);
    workers = workers.map((worker) => worker.supervisorId === current.supervisorId ? { ...worker, managerId: newManager.managerId } : worker);
  } else if (proposal.targetTier === "agent") {
    const targetIndex = agentBindings.findIndex((item) => item.agentInstanceId === proposal.targetId || item.agentKey === proposal.targetId);
    if (targetIndex < 0) throw new Error("workforce-hierarchy-reparent-agent-missing");
    const current = agentBindings[targetIndex];
    if (current.supervisorId !== proposal.oldParentId) throw new Error("workforce-hierarchy-reparent-old-parent-mismatch");
    const supervisor = supervisorRuntimes.find((item) => item.supervisorId === proposal.newParentId);
    if (!supervisor) throw new Error("workforce-hierarchy-reparent-supervisor-missing");
    const domainId = proposal.newDomainId ?? current.domainId;
    const updated = bindTitanWorkforceAgentToSupervisor({
      companyId: snapshot.companyId,
      supervisor,
      domainId,
      agentInstanceId: current.agentInstanceId,
      state: current.state,
      source: current.source,
      agent: {
        agentKey: current.agentKey,
        roleDefinitionId: current.roleDefinitionId,
        operationalDomains: [...current.operationalDomains],
        enabled: current.state !== "disabled",
        executionModel: "proposal_or_governed_handoff",
        companyBoundary: "company_id",
        identityGrantsAuthority: false,
      },
    });
    agentBindings[targetIndex] = updated;
    workers = workers.map((worker) => worker.agentInstanceId === current.agentInstanceId ? { ...worker, managerId: updated.managerId, supervisorId: updated.supervisorId, domainId: updated.domainId } : worker);
  } else {
    const targetIndex = workers.findIndex((item) => item.workerId === proposal.targetId);
    if (targetIndex < 0) throw new Error("workforce-hierarchy-reparent-worker-missing");
    const current = workers[targetIndex];
    if (current.agentInstanceId !== proposal.oldParentId) throw new Error("workforce-hierarchy-reparent-old-parent-mismatch");
    const binding = agentBindings.find((item) => item.agentInstanceId === proposal.newParentId);
    if (!binding) throw new Error("workforce-hierarchy-reparent-agent-missing");
    const updated = createTitanWorkforceWorkerRuntime({
      companyId: snapshot.companyId,
      agentBinding: binding,
      state: current.state,
      worker: {
        workerId: current.workerId,
        workerName: current.workerName,
        atomicAction: current.atomicAction,
        toolIds: [...current.toolIds],
        authorityClass: current.authorityClass,
        requiresApproval: current.requiresApproval,
        requiresIdempotencyKey: current.requiresIdempotencyKey,
        requiresExecutionReceipt: current.requiresExecutionReceipt,
        companyBoundary: "company_id",
        identityGrantsAuthority: false,
        bindingGrantsAuthority: false,
        workerCanDelegate: false,
      },
    });
    workers[targetIndex] = updated;
  }

  const nextRevision = snapshot.revision + 1;
  const auditEvent = createTitanWorkforceHierarchyAuditEvent({
    companyId: snapshot.companyId,
    eventId: `${proposal.proposalId}:applied:${nextRevision}`,
    eventType: "reparent_applied",
    actorId: proposal.requestedById,
    targetTier: proposal.targetTier,
    targetId: proposal.targetId,
    revision: nextRevision,
    occurredAt: proposal.createdAt,
    reason: proposal.reason,
    metadata: { oldParentId: proposal.oldParentId, newParentId: proposal.newParentId, newDomainId: proposal.newDomainId },
  });
  return createTitanWorkforceHierarchyStateSnapshot({
    ...snapshot,
    revision: nextRevision,
    createdAt: proposal.createdAt,
    supervisorRuntimes,
    agentBindings,
    workers,
    auditHistory: [...snapshot.auditHistory, auditEvent],
  });
}

export function summarizeTitanWorkforceHierarchyPersistence(snapshot: TitanWorkforceHierarchyStateSnapshot) {
  const validation = validateTitanWorkforceHierarchyStateSnapshot(snapshot);
  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_STATE_SNAPSHOT_SCHEMA,
    companyId: snapshot.companyId,
    revision: snapshot.revision,
    ...validation.counts,
    deviceFirst: true as const,
    restartRecoverable: true as const,
    auditAppendOnly: true as const,
    reparentingRequiresDrainedDelegations: true as const,
    executionPermitted: false as const,
  });
}
