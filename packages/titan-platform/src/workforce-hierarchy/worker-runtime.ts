import { assertTitanWorkforceCompanyId } from "./contract.js";
import type { TitanWorkforceAgentBinding } from "./agent-binding.js";

export const TITAN_WORKFORCE_WORKER_RUNTIME_SCHEMA = "titan.workforce.worker-runtime.v1" as const;
export const TITAN_WORKFORCE_WORKER_TASK_SCHEMA = "titan.workforce.worker-task.v1" as const;
export const TITAN_WORKFORCE_WORKER_EXECUTION_PLAN_SCHEMA = "titan.workforce.worker-execution-plan.v1" as const;

export type TitanWorkforceWorkerState = "proposed" | "active" | "paused" | "retired";
export type TitanWorkforceWorkerAuthorityClass = "READ_OR_ANALYSIS" | "PROTECTED_EXECUTION" | string;

export type TitanWorkforceAtomicWorkerDescriptor = {
  workerId: string;
  workerName: string;
  atomicAction: string;
  toolIds: string[];
  authorityClass: TitanWorkforceWorkerAuthorityClass;
  requiresApproval: boolean;
  requiresIdempotencyKey: boolean;
  requiresExecutionReceipt: boolean;
  companyBoundary: "company_id";
  identityGrantsAuthority: false;
  bindingGrantsAuthority: false;
  workerCanDelegate: false;
};

export type TitanWorkforceWorkerRuntime = {
  schema: typeof TITAN_WORKFORCE_WORKER_RUNTIME_SCHEMA;
  companyId: string;
  managerId: string;
  supervisorId: string;
  domainId: string;
  agentKey: string;
  agentInstanceId: string;
  workerId: string;
  workerName: string;
  atomicAction: string;
  toolIds: string[];
  authorityClass: TitanWorkforceWorkerAuthorityClass;
  state: TitanWorkforceWorkerState;
  requiresApproval: boolean;
  requiresIdempotencyKey: boolean;
  requiresExecutionReceipt: boolean;
  identityConfersExecutionAuthority: false;
  parentageConfersExecutionAuthority: false;
  bindingConfersExecutionAuthority: false;
  mayDelegate: false;
  maySelfPromote: false;
  maySelfHire: false;
  leastAuthorityToolAccess: true;
  executionRequiresAuthorityEvaluation: true;
  executionRequiresCapabilityResolution: true;
  businessOpsRouteRemainsAuthoritative: true;
};

export type TitanWorkforceWorkerTask = {
  schema: typeof TITAN_WORKFORCE_WORKER_TASK_SCHEMA;
  companyId: string;
  taskId: string;
  workerId: string;
  agentKey: string;
  objective: string;
  operation: string;
  allowedToolIds: string[];
  contextRefs: string[];
  expectedOutcome: string;
  priority: "low" | "normal" | "high" | "critical";
  state: "proposed" | "ready_for_authority_gate" | "blocked" | "completed" | "cancelled";
  idempotencyKey: string | null;
  approvalGranted: boolean;
  constraints: string[];
  taskConfersExecutionAuthority: false;
  workerMayDelegate: false;
};

export type TitanWorkforceWorkerExecutionPlan = {
  schema: typeof TITAN_WORKFORCE_WORKER_EXECUTION_PLAN_SCHEMA;
  companyId: string;
  managerId: string;
  supervisorId: string;
  agentKey: string;
  workerId: string;
  taskId: string;
  operation: string;
  toolIds: string[];
  authorityClass: TitanWorkforceWorkerAuthorityClass;
  blockedReasons: string[];
  state: "BLOCKED" | "READY_FOR_AUTHORITY_GATE";
  executionPermitted: false;
  directMutation: false;
  requiresAuthorityEvaluation: true;
  requiresCapabilityResolution: true;
  requiresExecutionReceipt: boolean;
  businessOpsRouteRemainsAuthoritative: true;
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

function uniqueIds(values: readonly string[] | undefined, label: string, allowEmpty = false) {
  const result = [...new Set((values ?? []).map((value) => requireId(value, label)))].sort();
  if (!allowEmpty && !result.length) throw new Error(`${label}s-required`);
  return result;
}

export function createTitanWorkforceWorkerRuntime(input: {
  companyId: string;
  agentBinding: TitanWorkforceAgentBinding;
  worker: TitanWorkforceAtomicWorkerDescriptor;
  state?: TitanWorkforceWorkerState;
}): TitanWorkforceWorkerRuntime {
  const companyId = assertTitanWorkforceCompanyId(input.companyId);
  if (input.agentBinding.companyId !== companyId) throw new Error("workforce-worker-cross-company-rejected");
  if (input.agentBinding.state !== "active") throw new Error("workforce-worker-agent-not-active");
  if (input.worker.companyBoundary !== "company_id") throw new Error("workforce-worker-company-boundary-invalid");
  if (input.worker.identityGrantsAuthority !== false || input.worker.bindingGrantsAuthority !== false) {
    throw new Error("workforce-worker-authority-invariant-violation");
  }
  if (input.worker.workerCanDelegate !== false) throw new Error("workforce-worker-delegation-invariant-violation");

  const state = input.state ?? "active";
  if (!["proposed", "active", "paused", "retired"].includes(state)) throw new Error("workforce-worker-state-invalid");

  return {
    schema: TITAN_WORKFORCE_WORKER_RUNTIME_SCHEMA,
    companyId,
    managerId: input.agentBinding.managerId,
    supervisorId: input.agentBinding.supervisorId,
    domainId: input.agentBinding.domainId,
    agentKey: input.agentBinding.agentKey,
    agentInstanceId: input.agentBinding.agentInstanceId,
    workerId: requireId(input.worker.workerId, "workforce-worker-id"),
    workerName: requireText(input.worker.workerName, "workforce-worker-name", 240),
    atomicAction: requireText(input.worker.atomicAction, "workforce-worker-atomic-action", 320),
    toolIds: uniqueIds(input.worker.toolIds, "workforce-worker-tool-id"),
    authorityClass: requireText(input.worker.authorityClass, "workforce-worker-authority-class", 120),
    state,
    requiresApproval: input.worker.requiresApproval === true,
    requiresIdempotencyKey: input.worker.requiresIdempotencyKey === true,
    requiresExecutionReceipt: input.worker.requiresExecutionReceipt === true,
    identityConfersExecutionAuthority: false,
    parentageConfersExecutionAuthority: false,
    bindingConfersExecutionAuthority: false,
    mayDelegate: false,
    maySelfPromote: false,
    maySelfHire: false,
    leastAuthorityToolAccess: true,
    executionRequiresAuthorityEvaluation: true,
    executionRequiresCapabilityResolution: true,
    businessOpsRouteRemainsAuthoritative: true,
  };
}

export function createTitanWorkforceWorkerTask(
  worker: TitanWorkforceWorkerRuntime,
  input: {
    companyId: string;
    taskId: string;
    objective: string;
    operation?: string;
    allowedToolIds?: string[];
    contextRefs?: string[];
    expectedOutcome: string;
    priority?: TitanWorkforceWorkerTask["priority"];
    idempotencyKey?: string | null;
    approvalGranted?: boolean;
    constraints?: string[];
  },
): TitanWorkforceWorkerTask {
  const companyId = assertTitanWorkforceCompanyId(input.companyId);
  if (worker.companyId !== companyId) throw new Error("workforce-worker-task-cross-company-rejected");
  if (worker.state !== "active") throw new Error("workforce-worker-task-worker-not-active");

  const allowedToolIds = uniqueIds(input.allowedToolIds ?? worker.toolIds, "workforce-worker-task-tool-id");
  const workerToolSet = new Set(worker.toolIds);
  if (allowedToolIds.some((toolId) => !workerToolSet.has(toolId))) {
    throw new Error("workforce-worker-task-tool-authority-expansion-rejected");
  }

  const priority = input.priority ?? "normal";
  if (!["low", "normal", "high", "critical"].includes(priority)) throw new Error("workforce-worker-task-priority-invalid");
  const idempotencyKey = input.idempotencyKey == null || input.idempotencyKey === ""
    ? null
    : requireId(input.idempotencyKey, "workforce-worker-task-idempotency-key");
  const approvalGranted = input.approvalGranted === true;
  const blocked = (worker.requiresApproval && !approvalGranted) || (worker.requiresIdempotencyKey && !idempotencyKey);

  return {
    schema: TITAN_WORKFORCE_WORKER_TASK_SCHEMA,
    companyId,
    taskId: requireId(input.taskId, "workforce-worker-task-id"),
    workerId: worker.workerId,
    agentKey: worker.agentKey,
    objective: requireText(input.objective, "workforce-worker-task-objective"),
    operation: requireText(input.operation ?? worker.atomicAction, "workforce-worker-task-operation", 320),
    allowedToolIds,
    contextRefs: uniqueIds(input.contextRefs, "workforce-worker-task-context-ref", true),
    expectedOutcome: requireText(input.expectedOutcome, "workforce-worker-task-expected-outcome"),
    priority,
    state: blocked ? "blocked" : "ready_for_authority_gate",
    idempotencyKey,
    approvalGranted,
    constraints: [...new Set((input.constraints ?? []).map((value) => requireText(value, "workforce-worker-task-constraint", 320)))].sort(),
    taskConfersExecutionAuthority: false,
    workerMayDelegate: false,
  };
}

export function planTitanWorkforceWorkerExecution(
  worker: TitanWorkforceWorkerRuntime,
  task: TitanWorkforceWorkerTask,
): TitanWorkforceWorkerExecutionPlan {
  if (worker.companyId !== task.companyId) throw new Error("workforce-worker-execution-cross-company-rejected");
  if (worker.workerId !== task.workerId || worker.agentKey !== task.agentKey) throw new Error("workforce-worker-execution-parentage-mismatch");
  if (worker.state !== "active") throw new Error("workforce-worker-execution-worker-not-active");
  const workerToolSet = new Set(worker.toolIds);
  if (task.allowedToolIds.some((toolId) => !workerToolSet.has(toolId))) {
    throw new Error("workforce-worker-execution-tool-authority-expansion-rejected");
  }

  const blockedReasons: string[] = [];
  if (worker.requiresApproval && !task.approvalGranted) blockedReasons.push("APPROVAL_REQUIRED");
  if (worker.requiresIdempotencyKey && !task.idempotencyKey) blockedReasons.push("IDEMPOTENCY_KEY_REQUIRED");
  if (task.state === "cancelled" || task.state === "completed") blockedReasons.push("TASK_NOT_EXECUTABLE");

  return {
    schema: TITAN_WORKFORCE_WORKER_EXECUTION_PLAN_SCHEMA,
    companyId: worker.companyId,
    managerId: worker.managerId,
    supervisorId: worker.supervisorId,
    agentKey: worker.agentKey,
    workerId: worker.workerId,
    taskId: task.taskId,
    operation: task.operation,
    toolIds: [...task.allowedToolIds],
    authorityClass: worker.authorityClass,
    blockedReasons,
    state: blockedReasons.length ? "BLOCKED" : "READY_FOR_AUTHORITY_GATE",
    executionPermitted: false,
    directMutation: false,
    requiresAuthorityEvaluation: true,
    requiresCapabilityResolution: true,
    requiresExecutionReceipt: worker.requiresExecutionReceipt,
    businessOpsRouteRemainsAuthoritative: true,
  };
}

export function summarizeTitanWorkforceWorkers(workers: readonly TitanWorkforceWorkerRuntime[]) {
  return {
    schema: TITAN_WORKFORCE_WORKER_RUNTIME_SCHEMA,
    workerCount: workers.length,
    activeWorkerCount: workers.filter((worker) => worker.state === "active").length,
    agentCount: new Set(workers.map((worker) => worker.agentKey)).size,
    toolCount: new Set(workers.flatMap((worker) => worker.toolIds)).size,
    allLeastAuthority: workers.every((worker) => worker.leastAuthorityToolAccess),
    anyCanDelegate: workers.some((worker) => worker.mayDelegate),
    grantsAuthority: false,
  } as const;
}
