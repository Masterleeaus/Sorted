import { assertTitanWorkforceCompanyId } from "./contract.js";
import type { TitanWorkforceAgentBinding } from "./agent-binding.js";
import type { TitanWorkforceManagerObjective } from "./manager-runtime.js";
import type { TitanWorkforceWorkerRuntime, TitanWorkforceWorkerTask } from "./worker-runtime.js";

export const TITAN_WORKFORCE_HIERARCHY_DELEGATION_SCHEMA = "titan.workforce.hierarchy-delegation-envelope.v1" as const;

export const TITAN_WORKFORCE_DELEGATION_AUTHORITY_CEILINGS = [
  "READ_ONLY",
  "PROPOSE",
  "WRITE_INTERNAL",
  "EXTERNAL_COMMUNICATION",
  "FINANCIAL",
  "DESTRUCTIVE",
] as const;
export type TitanWorkforceDelegationAuthorityCeiling = (typeof TITAN_WORKFORCE_DELEGATION_AUTHORITY_CEILINGS)[number];

export type TitanWorkforceHierarchyDelegationEnvelope = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_DELEGATION_SCHEMA;
  companyId: string;
  delegationId: string;
  managerId: string;
  supervisorId: string;
  domainId: string;
  agentKey: string;
  agentInstanceId: string;
  workerId: string | null;
  taskId: string | null;
  objectiveId: string | null;
  objective: string;
  operation: string;
  authorityCeiling: TitanWorkforceDelegationAuthorityCeiling;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  dueAt: string | null;
  idempotencyKey: string;
  causality: Readonly<{
    correlationId: string;
    rootDelegationId: string;
    parentDelegationId: string | null;
    sourceEventId: string | null;
  }>;
  authority: Readonly<{
    identityConfersAuthority: false;
    hierarchyConfersAuthority: false;
    delegationConfersAuthority: false;
    ceilingMayOnlyContract: true;
    executionRequiresAuthorityEvaluation: true;
    executionRequiresCapabilityResolution: true;
  }>;
  compatibility: Readonly<{
    targetDelegationSchema: "titan.workforce.delegation-task-envelope.v1";
    queueOwner: "existing_workflow_or_domain_runtime";
    businessOpsRouteRemainsAuthoritative: true;
  }>;
}>;

const AUTHORITY_RANK: Record<TitanWorkforceDelegationAuthorityCeiling, number> = {
  READ_ONLY: 0,
  PROPOSE: 1,
  WRITE_INTERNAL: 2,
  EXTERNAL_COMMUNICATION: 3,
  FINANCIAL: 4,
  DESTRUCTIVE: 5,
};
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
function normalizeDueAt(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("workforce-hierarchy-delegation-due-at-invalid");
  return new Date(ms).toISOString();
}

export function contractTitanWorkforceDelegationAuthority(
  originating: TitanWorkforceDelegationAuthorityCeiling,
  requested: TitanWorkforceDelegationAuthorityCeiling,
) {
  if (!TITAN_WORKFORCE_DELEGATION_AUTHORITY_CEILINGS.includes(originating)) throw new Error("workforce-hierarchy-delegation-origin-authority-invalid");
  if (!TITAN_WORKFORCE_DELEGATION_AUTHORITY_CEILINGS.includes(requested)) throw new Error("workforce-hierarchy-delegation-requested-authority-invalid");
  if (AUTHORITY_RANK[requested] > AUTHORITY_RANK[originating]) throw new Error("workforce-hierarchy-delegation-authority-expansion-rejected");
  return requested;
}

export function createTitanWorkforceHierarchyDelegationEnvelope(input: {
  companyId: string;
  delegationId: string;
  agentBinding: TitanWorkforceAgentBinding;
  worker?: TitanWorkforceWorkerRuntime | null;
  task?: TitanWorkforceWorkerTask | null;
  managerObjective?: TitanWorkforceManagerObjective | null;
  objective?: string;
  operation?: string;
  originatingAuthorityCeiling: TitanWorkforceDelegationAuthorityCeiling;
  requestedAuthorityCeiling?: TitanWorkforceDelegationAuthorityCeiling;
  priority?: TitanWorkforceHierarchyDelegationEnvelope["priority"];
  dueAt?: string | null;
  idempotencyKey: string;
  correlationId: string;
  rootDelegationId?: string | null;
  parentDelegationId?: string | null;
  sourceEventId?: string | null;
}): TitanWorkforceHierarchyDelegationEnvelope {
  const companyId = assertTitanWorkforceCompanyId(input.companyId);
  if (input.agentBinding.companyId !== companyId) throw new Error("workforce-hierarchy-delegation-cross-company-agent-rejected");
  if (input.agentBinding.state !== "active") throw new Error("workforce-hierarchy-delegation-agent-not-active");
  if (input.worker && input.worker.companyId !== companyId) throw new Error("workforce-hierarchy-delegation-cross-company-worker-rejected");
  if (input.worker && (input.worker.agentKey !== input.agentBinding.agentKey || input.worker.supervisorId !== input.agentBinding.supervisorId)) {
    throw new Error("workforce-hierarchy-delegation-worker-parentage-mismatch");
  }
  if (input.task && (!input.worker || input.task.workerId !== input.worker.workerId || input.task.companyId !== companyId)) {
    throw new Error("workforce-hierarchy-delegation-task-parentage-mismatch");
  }
  if (input.managerObjective && input.managerObjective.companyId !== companyId) throw new Error("workforce-hierarchy-delegation-cross-company-objective-rejected");

  const delegationId = requireId(input.delegationId, "workforce-hierarchy-delegation-id");
  const requested = input.requestedAuthorityCeiling ?? input.originatingAuthorityCeiling;
  const authorityCeiling = contractTitanWorkforceDelegationAuthority(input.originatingAuthorityCeiling, requested);
  const parentDelegationId = input.parentDelegationId ? requireId(input.parentDelegationId, "workforce-hierarchy-delegation-parent-id") : null;
  if (parentDelegationId === delegationId) throw new Error("workforce-hierarchy-delegation-self-parent-rejected");
  const rootDelegationId = input.rootDelegationId ? requireId(input.rootDelegationId, "workforce-hierarchy-delegation-root-id") : delegationId;
  const objective = requireText(input.objective ?? input.task?.objective ?? input.managerObjective?.title, "workforce-hierarchy-delegation-objective");
  const operation = requireText(input.operation ?? input.task?.operation ?? objective, "workforce-hierarchy-delegation-operation", 320);
  const priority = input.priority ?? (input.task?.priority === "critical" ? "URGENT" : input.task?.priority === "high" ? "HIGH" : input.task?.priority === "low" ? "LOW" : "NORMAL");

  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_DELEGATION_SCHEMA,
    companyId,
    delegationId,
    managerId: input.agentBinding.managerId,
    supervisorId: input.agentBinding.supervisorId,
    domainId: input.agentBinding.domainId,
    agentKey: input.agentBinding.agentKey,
    agentInstanceId: input.agentBinding.agentInstanceId,
    workerId: input.worker?.workerId ?? null,
    taskId: input.task?.taskId ?? null,
    objectiveId: input.managerObjective?.objectiveId ?? null,
    objective,
    operation,
    authorityCeiling,
    priority,
    dueAt: normalizeDueAt(input.dueAt),
    idempotencyKey: requireId(input.idempotencyKey, "workforce-hierarchy-delegation-idempotency-key"),
    causality: Object.freeze({
      correlationId: requireId(input.correlationId, "workforce-hierarchy-delegation-correlation-id"),
      rootDelegationId,
      parentDelegationId,
      sourceEventId: input.sourceEventId ? requireId(input.sourceEventId, "workforce-hierarchy-delegation-source-event-id") : null,
    }),
    authority: Object.freeze({
      identityConfersAuthority: false,
      hierarchyConfersAuthority: false,
      delegationConfersAuthority: false,
      ceilingMayOnlyContract: true,
      executionRequiresAuthorityEvaluation: true,
      executionRequiresCapabilityResolution: true,
    }),
    compatibility: Object.freeze({
      targetDelegationSchema: "titan.workforce.delegation-task-envelope.v1",
      queueOwner: "existing_workflow_or_domain_runtime",
      businessOpsRouteRemainsAuthoritative: true,
    }),
  });
}

export function toTitanDelegationTaskEnvelopeInput(envelope: TitanWorkforceHierarchyDelegationEnvelope) {
  return Object.freeze({
    company_id: envelope.companyId,
    delegation_id: envelope.delegationId,
    objective: envelope.objective,
    inputs: Object.freeze({
      hierarchy: Object.freeze({
        manager_id: envelope.managerId,
        supervisor_id: envelope.supervisorId,
        domain_id: envelope.domainId,
        agent_key: envelope.agentKey,
        agent_instance_id: envelope.agentInstanceId,
        worker_id: envelope.workerId,
        task_id: envelope.taskId,
        objective_id: envelope.objectiveId,
      }),
      operation: envelope.operation,
    }),
    authority_ceiling: envelope.authorityCeiling,
    priority: envelope.priority,
    due_at: envelope.dueAt,
    idempotency_key: envelope.idempotencyKey,
    causality: Object.freeze({
      correlation_id: envelope.causality.correlationId,
      root_delegation_id: envelope.causality.rootDelegationId,
      parent_delegation_id: envelope.causality.parentDelegationId,
      source_event_id: envelope.causality.sourceEventId,
    }),
    expected_outcome: Object.freeze({
      description: envelope.objective,
      evidence_required: Object.freeze(["authority_decision", "capability_resolution", "execution_receipt"]),
    }),
  });
}

export function validateTitanWorkforceHierarchyDelegationEnvelope(envelope: TitanWorkforceHierarchyDelegationEnvelope) {
  const errors: string[] = [];
  if (envelope.schema !== TITAN_WORKFORCE_HIERARCHY_DELEGATION_SCHEMA) errors.push("invalid-schema");
  if (!envelope.companyId || !envelope.managerId || !envelope.supervisorId || !envelope.agentKey) errors.push("incomplete-hierarchy");
  if (envelope.authority.identityConfersAuthority || envelope.authority.hierarchyConfersAuthority || envelope.authority.delegationConfersAuthority) errors.push("authority-expansion");
  if (!envelope.authority.executionRequiresAuthorityEvaluation || !envelope.authority.executionRequiresCapabilityResolution) errors.push("missing-execution-gates");
  return { ok: errors.length === 0, errors } as const;
}
