import { assertTitanWorkforceCompanyId } from "./contract.js";

export const TITAN_WORKFORCE_MANAGER_RUNTIME_SCHEMA = "titan.workforce.manager-runtime.v1" as const;
export const TITAN_WORKFORCE_MANAGER_OBJECTIVE_SCHEMA = "titan.workforce.manager-objective.v1" as const;

export type TitanWorkforceManagerPolicy = {
  policyId: string;
  kind: "allow" | "deny" | "require_approval" | "limit";
  scope: string;
  value?: string | number | boolean | null;
  reason?: string | null;
};

export type TitanWorkforceManagerObjective = {
  schema: typeof TITAN_WORKFORCE_MANAGER_OBJECTIVE_SCHEMA;
  companyId: string;
  objectiveId: string;
  title: string;
  outcome: string;
  state: "draft" | "active" | "blocked" | "completed" | "cancelled";
  priority: "low" | "normal" | "high" | "critical";
  ownerManagerId: string;
  supervisorIds: string[];
  sourceRef?: string | null;
  createdAt: string;
  updatedAt: string;
  objectiveOwnershipConfersExecutionAuthority: false;
};

export type TitanWorkforceManagerRuntime = {
  schema: typeof TITAN_WORKFORCE_MANAGER_RUNTIME_SCHEMA;
  companyId: string;
  managerId: string;
  displayName?: string | null;
  state: "active" | "paused" | "degraded";
  scope: {
    companyWide: true;
    businessObjectiveOwnership: true;
    supervisorCoordination: true;
    policyEvaluation: true;
    directToolExecution: false;
  };
  policies: TitanWorkforceManagerPolicy[];
  objectives: TitanWorkforceManagerObjective[];
  authority: {
    identityConfersAuthority: false;
    managerRoleConfersAuthority: false;
    objectiveOwnershipConfersAuthority: false;
    policyDecisionConfersExecutionAuthority: false;
    executionRequiresAuthorityEvaluation: true;
    executionRequiresCapabilityResolution: true;
  };
};

export type TitanWorkforceManagerPolicyDecision = {
  companyId: string;
  managerId: string;
  action: string;
  decision: "allow_proposal" | "deny" | "require_approval" | "limit";
  matchedPolicyIds: string[];
  reasons: string[];
  executionPermitted: false;
  requiresAuthorityEvaluation: true;
  requiresCapabilityResolution: true;
};

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,180}$/;

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function requireId(value: unknown, label: string) {
  const normalized = clean(value, 180);
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label}-required`);
  return normalized;
}

function uniqueIds(values: readonly string[] | undefined) {
  return [...new Set((values ?? []).map((value) => requireId(value, "workforce-manager-supervisor-id")))].sort();
}

export function createTitanWorkforceManagerRuntime(input: {
  companyId: string;
  managerId: string;
  displayName?: string | null;
  state?: TitanWorkforceManagerRuntime["state"];
  policies?: TitanWorkforceManagerPolicy[];
  objectives?: TitanWorkforceManagerObjective[];
}): TitanWorkforceManagerRuntime {
  const companyId = assertTitanWorkforceCompanyId(input.companyId);
  const managerId = requireId(input.managerId, "workforce-manager-id");
  const state = input.state ?? "active";
  if (!["active", "paused", "degraded"].includes(state)) throw new Error("workforce-manager-state-invalid");

  const policies = (input.policies ?? []).map((policy) => normalizeTitanWorkforceManagerPolicy(policy));
  const objectives = (input.objectives ?? []).map((objective) => {
    if (objective.companyId !== companyId) throw new Error("workforce-manager-objective-cross-company-rejected");
    if (objective.ownerManagerId !== managerId) throw new Error("workforce-manager-objective-owner-mismatch");
    return normalizeTitanWorkforceManagerObjective(objective);
  });

  return {
    schema: TITAN_WORKFORCE_MANAGER_RUNTIME_SCHEMA,
    companyId,
    managerId,
    displayName: clean(input.displayName, 180) || null,
    state,
    scope: {
      companyWide: true,
      businessObjectiveOwnership: true,
      supervisorCoordination: true,
      policyEvaluation: true,
      directToolExecution: false,
    },
    policies,
    objectives,
    authority: {
      identityConfersAuthority: false,
      managerRoleConfersAuthority: false,
      objectiveOwnershipConfersAuthority: false,
      policyDecisionConfersExecutionAuthority: false,
      executionRequiresAuthorityEvaluation: true,
      executionRequiresCapabilityResolution: true,
    },
  };
}

export function normalizeTitanWorkforceManagerPolicy(policy: TitanWorkforceManagerPolicy): TitanWorkforceManagerPolicy {
  const policyId = requireId(policy.policyId, "workforce-manager-policy-id");
  const scope = clean(policy.scope, 240);
  if (!scope) throw new Error("workforce-manager-policy-scope-required");
  if (!["allow", "deny", "require_approval", "limit"].includes(policy.kind)) {
    throw new Error("workforce-manager-policy-kind-invalid");
  }
  return {
    policyId,
    kind: policy.kind,
    scope,
    value: policy.value ?? null,
    reason: clean(policy.reason, 500) || null,
  };
}

export function normalizeTitanWorkforceManagerObjective(
  objective: TitanWorkforceManagerObjective,
): TitanWorkforceManagerObjective {
  const companyId = assertTitanWorkforceCompanyId(objective.companyId);
  const objectiveId = requireId(objective.objectiveId, "workforce-manager-objective-id");
  const ownerManagerId = requireId(objective.ownerManagerId, "workforce-manager-objective-owner");
  const title = clean(objective.title, 240);
  const outcome = clean(objective.outcome, 1200);
  if (!title) throw new Error("workforce-manager-objective-title-required");
  if (!outcome) throw new Error("workforce-manager-objective-outcome-required");
  if (!["draft", "active", "blocked", "completed", "cancelled"].includes(objective.state)) {
    throw new Error("workforce-manager-objective-state-invalid");
  }
  if (!["low", "normal", "high", "critical"].includes(objective.priority)) {
    throw new Error("workforce-manager-objective-priority-invalid");
  }
  const createdAt = clean(objective.createdAt, 80);
  const updatedAt = clean(objective.updatedAt, 80);
  if (!createdAt || !updatedAt) throw new Error("workforce-manager-objective-timestamps-required");

  return {
    schema: TITAN_WORKFORCE_MANAGER_OBJECTIVE_SCHEMA,
    companyId,
    objectiveId,
    title,
    outcome,
    state: objective.state,
    priority: objective.priority,
    ownerManagerId,
    supervisorIds: uniqueIds(objective.supervisorIds),
    sourceRef: clean(objective.sourceRef, 240) || null,
    createdAt,
    updatedAt,
    objectiveOwnershipConfersExecutionAuthority: false,
  };
}

export function upsertTitanWorkforceManagerObjective(
  runtime: TitanWorkforceManagerRuntime,
  objective: TitanWorkforceManagerObjective,
): TitanWorkforceManagerRuntime {
  if (runtime.schema !== TITAN_WORKFORCE_MANAGER_RUNTIME_SCHEMA) throw new Error("workforce-manager-runtime-invalid");
  if (objective.companyId !== runtime.companyId) throw new Error("workforce-manager-objective-cross-company-rejected");
  if (objective.ownerManagerId !== runtime.managerId) throw new Error("workforce-manager-objective-owner-mismatch");
  const normalized = normalizeTitanWorkforceManagerObjective(objective);
  const objectives = runtime.objectives.filter((item) => item.objectiveId !== normalized.objectiveId);
  objectives.push(normalized);
  objectives.sort((a, b) => a.objectiveId.localeCompare(b.objectiveId));
  return { ...runtime, objectives };
}

function scopeMatches(scope: string, action: string) {
  return scope === "*" || scope === action || (scope.endsWith(".*") && action.startsWith(scope.slice(0, -1)));
}

export function evaluateTitanWorkforceManagerPolicy(
  runtime: TitanWorkforceManagerRuntime,
  action: string,
): TitanWorkforceManagerPolicyDecision {
  if (runtime.schema !== TITAN_WORKFORCE_MANAGER_RUNTIME_SCHEMA) throw new Error("workforce-manager-runtime-invalid");
  const normalizedAction = clean(action, 240);
  if (!normalizedAction) throw new Error("workforce-manager-policy-action-required");

  const matched = runtime.policies.filter((policy) => scopeMatches(policy.scope, normalizedAction));
  const deny = matched.filter((policy) => policy.kind === "deny");
  const approvals = matched.filter((policy) => policy.kind === "require_approval");
  const limits = matched.filter((policy) => policy.kind === "limit");
  const allows = matched.filter((policy) => policy.kind === "allow");

  let decision: TitanWorkforceManagerPolicyDecision["decision"] = "require_approval";
  if (deny.length) decision = "deny";
  else if (approvals.length) decision = "require_approval";
  else if (limits.length) decision = "limit";
  else if (allows.length) decision = "allow_proposal";

  return {
    companyId: runtime.companyId,
    managerId: runtime.managerId,
    action: normalizedAction,
    decision,
    matchedPolicyIds: matched.map((policy) => policy.policyId).sort(),
    reasons: matched.map((policy) => policy.reason).filter((value): value is string => Boolean(value)),
    executionPermitted: false,
    requiresAuthorityEvaluation: true,
    requiresCapabilityResolution: true,
  };
}

export function summarizeTitanWorkforceManagerRuntime(runtime: TitanWorkforceManagerRuntime) {
  if (runtime.schema !== TITAN_WORKFORCE_MANAGER_RUNTIME_SCHEMA) throw new Error("workforce-manager-runtime-invalid");
  return {
    schema: runtime.schema,
    companyId: runtime.companyId,
    managerId: runtime.managerId,
    state: runtime.state,
    objectiveCount: runtime.objectives.length,
    activeObjectiveCount: runtime.objectives.filter((objective) => objective.state === "active").length,
    blockedObjectiveCount: runtime.objectives.filter((objective) => objective.state === "blocked").length,
    policyCount: runtime.policies.length,
    directToolExecution: false,
    grantsAuthority: false,
  } as const;
}
