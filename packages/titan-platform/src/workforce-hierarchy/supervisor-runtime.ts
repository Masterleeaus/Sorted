import { assertTitanWorkforceCompanyId } from "./contract.js";

export const TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA = "titan.workforce.supervisor-runtime.v1" as const;
export const TITAN_WORKFORCE_SUPERVISOR_DOMAIN_SCHEMA = "titan.workforce.supervisor-domain.v1" as const;
export const TITAN_WORKFORCE_SUPERVISOR_ESCALATION_SCHEMA = "titan.workforce.supervisor-escalation.v1" as const;

export type TitanWorkforceSupervisorDomain = {
  schema: typeof TITAN_WORKFORCE_SUPERVISOR_DOMAIN_SCHEMA;
  companyId: string;
  domainId: string;
  title: string;
  supervisorId: string;
  agentIds: string[];
  objectiveIds: string[];
  state: "active" | "paused" | "degraded";
  domainOwnershipConfersExecutionAuthority: false;
};

export type TitanWorkforceSupervisorEscalation = {
  schema: typeof TITAN_WORKFORCE_SUPERVISOR_ESCALATION_SCHEMA;
  companyId: string;
  escalationId: string;
  supervisorId: string;
  domainId: string;
  sourceAgentId?: string | null;
  targetTier: "manager" | "human";
  reason: string;
  severity: "low" | "normal" | "high" | "critical";
  state: "open" | "acknowledged" | "resolved" | "cancelled";
  createdAt: string;
  updatedAt: string;
  escalationConfersExecutionAuthority: false;
};

export type TitanWorkforceSupervisorRuntime = {
  schema: typeof TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA;
  companyId: string;
  supervisorId: string;
  managerId: string;
  displayName?: string | null;
  state: "active" | "paused" | "degraded";
  domains: TitanWorkforceSupervisorDomain[];
  escalations: TitanWorkforceSupervisorEscalation[];
  scope: {
    domainOwnership: true;
    agentCoordination: true;
    conflictResolutionProposal: true;
    escalationRouting: true;
    directToolExecution: false;
  };
  authority: {
    identityConfersAuthority: false;
    supervisorRoleConfersAuthority: false;
    domainOwnershipConfersAuthority: false;
    conflictDecisionConfersExecutionAuthority: false;
    escalationConfersExecutionAuthority: false;
    executionRequiresAuthorityEvaluation: true;
    executionRequiresCapabilityResolution: true;
  };
};

export type TitanWorkforceSupervisorConflictInput = {
  domainId: string;
  conflictId: string;
  agentIds: string[];
  kind: "ownership" | "priority" | "resource" | "state" | "authority" | "other";
  severity: "low" | "normal" | "high" | "critical";
  facts?: string[];
};

export type TitanWorkforceSupervisorConflictDecision = {
  companyId: string;
  supervisorId: string;
  domainId: string;
  conflictId: string;
  decision: "coordinate" | "hold_for_manager" | "hold_for_human";
  coordinatedAgentIds: string[];
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

function uniqueIds(values: readonly string[] | undefined, label: string) {
  return [...new Set((values ?? []).map((value) => requireId(value, label)))].sort();
}

export function normalizeTitanWorkforceSupervisorDomain(
  domain: TitanWorkforceSupervisorDomain,
): TitanWorkforceSupervisorDomain {
  const companyId = assertTitanWorkforceCompanyId(domain.companyId);
  const domainId = requireId(domain.domainId, "workforce-supervisor-domain-id");
  const supervisorId = requireId(domain.supervisorId, "workforce-supervisor-id");
  const title = clean(domain.title, 240);
  if (!title) throw new Error("workforce-supervisor-domain-title-required");
  if (!["active", "paused", "degraded"].includes(domain.state)) {
    throw new Error("workforce-supervisor-domain-state-invalid");
  }
  return {
    schema: TITAN_WORKFORCE_SUPERVISOR_DOMAIN_SCHEMA,
    companyId,
    domainId,
    title,
    supervisorId,
    agentIds: uniqueIds(domain.agentIds, "workforce-supervisor-agent-id"),
    objectiveIds: uniqueIds(domain.objectiveIds, "workforce-supervisor-objective-id"),
    state: domain.state,
    domainOwnershipConfersExecutionAuthority: false,
  };
}

export function normalizeTitanWorkforceSupervisorEscalation(
  escalation: TitanWorkforceSupervisorEscalation,
): TitanWorkforceSupervisorEscalation {
  const companyId = assertTitanWorkforceCompanyId(escalation.companyId);
  const escalationId = requireId(escalation.escalationId, "workforce-supervisor-escalation-id");
  const supervisorId = requireId(escalation.supervisorId, "workforce-supervisor-id");
  const domainId = requireId(escalation.domainId, "workforce-supervisor-domain-id");
  const sourceAgentId = clean(escalation.sourceAgentId, 180) || null;
  if (sourceAgentId) requireId(sourceAgentId, "workforce-supervisor-agent-id");
  const reason = clean(escalation.reason, 1200);
  if (!reason) throw new Error("workforce-supervisor-escalation-reason-required");
  if (!["manager", "human"].includes(escalation.targetTier)) {
    throw new Error("workforce-supervisor-escalation-target-invalid");
  }
  if (!["low", "normal", "high", "critical"].includes(escalation.severity)) {
    throw new Error("workforce-supervisor-escalation-severity-invalid");
  }
  if (!["open", "acknowledged", "resolved", "cancelled"].includes(escalation.state)) {
    throw new Error("workforce-supervisor-escalation-state-invalid");
  }
  const createdAt = clean(escalation.createdAt, 80);
  const updatedAt = clean(escalation.updatedAt, 80);
  if (!createdAt || !updatedAt) throw new Error("workforce-supervisor-escalation-timestamps-required");
  return {
    schema: TITAN_WORKFORCE_SUPERVISOR_ESCALATION_SCHEMA,
    companyId,
    escalationId,
    supervisorId,
    domainId,
    sourceAgentId,
    targetTier: escalation.targetTier,
    reason,
    severity: escalation.severity,
    state: escalation.state,
    createdAt,
    updatedAt,
    escalationConfersExecutionAuthority: false,
  };
}

export function createTitanWorkforceSupervisorRuntime(input: {
  companyId: string;
  supervisorId: string;
  managerId: string;
  displayName?: string | null;
  state?: TitanWorkforceSupervisorRuntime["state"];
  domains?: TitanWorkforceSupervisorDomain[];
  escalations?: TitanWorkforceSupervisorEscalation[];
}): TitanWorkforceSupervisorRuntime {
  const companyId = assertTitanWorkforceCompanyId(input.companyId);
  const supervisorId = requireId(input.supervisorId, "workforce-supervisor-id");
  const managerId = requireId(input.managerId, "workforce-manager-id");
  const state = input.state ?? "active";
  if (!["active", "paused", "degraded"].includes(state)) throw new Error("workforce-supervisor-state-invalid");

  const domains = (input.domains ?? []).map((domain) => {
    if (domain.companyId !== companyId) throw new Error("workforce-supervisor-domain-cross-company-rejected");
    if (domain.supervisorId !== supervisorId) throw new Error("workforce-supervisor-domain-owner-mismatch");
    return normalizeTitanWorkforceSupervisorDomain(domain);
  });
  const escalations = (input.escalations ?? []).map((escalation) => {
    if (escalation.companyId !== companyId) throw new Error("workforce-supervisor-escalation-cross-company-rejected");
    if (escalation.supervisorId !== supervisorId) throw new Error("workforce-supervisor-escalation-owner-mismatch");
    return normalizeTitanWorkforceSupervisorEscalation(escalation);
  });

  return {
    schema: TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA,
    companyId,
    supervisorId,
    managerId,
    displayName: clean(input.displayName, 180) || null,
    state,
    domains: domains.sort((a, b) => a.domainId.localeCompare(b.domainId)),
    escalations: escalations.sort((a, b) => a.escalationId.localeCompare(b.escalationId)),
    scope: {
      domainOwnership: true,
      agentCoordination: true,
      conflictResolutionProposal: true,
      escalationRouting: true,
      directToolExecution: false,
    },
    authority: {
      identityConfersAuthority: false,
      supervisorRoleConfersAuthority: false,
      domainOwnershipConfersAuthority: false,
      conflictDecisionConfersExecutionAuthority: false,
      escalationConfersExecutionAuthority: false,
      executionRequiresAuthorityEvaluation: true,
      executionRequiresCapabilityResolution: true,
    },
  };
}

export function upsertTitanWorkforceSupervisorDomain(
  runtime: TitanWorkforceSupervisorRuntime,
  domain: TitanWorkforceSupervisorDomain,
): TitanWorkforceSupervisorRuntime {
  if (runtime.schema !== TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA) throw new Error("workforce-supervisor-runtime-invalid");
  if (domain.companyId !== runtime.companyId) throw new Error("workforce-supervisor-domain-cross-company-rejected");
  if (domain.supervisorId !== runtime.supervisorId) throw new Error("workforce-supervisor-domain-owner-mismatch");
  const normalized = normalizeTitanWorkforceSupervisorDomain(domain);
  const domains = runtime.domains.filter((item) => item.domainId !== normalized.domainId);
  domains.push(normalized);
  domains.sort((a, b) => a.domainId.localeCompare(b.domainId));
  return { ...runtime, domains };
}

export function recordTitanWorkforceSupervisorEscalation(
  runtime: TitanWorkforceSupervisorRuntime,
  escalation: TitanWorkforceSupervisorEscalation,
): TitanWorkforceSupervisorRuntime {
  if (runtime.schema !== TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA) throw new Error("workforce-supervisor-runtime-invalid");
  if (escalation.companyId !== runtime.companyId) throw new Error("workforce-supervisor-escalation-cross-company-rejected");
  if (escalation.supervisorId !== runtime.supervisorId) throw new Error("workforce-supervisor-escalation-owner-mismatch");
  const normalized = normalizeTitanWorkforceSupervisorEscalation(escalation);
  const domain = runtime.domains.find((item) => item.domainId === normalized.domainId);
  if (!domain) throw new Error("workforce-supervisor-escalation-domain-not-owned");
  if (normalized.sourceAgentId && !domain.agentIds.includes(normalized.sourceAgentId)) {
    throw new Error("workforce-supervisor-escalation-agent-outside-domain");
  }
  const escalations = runtime.escalations.filter((item) => item.escalationId !== normalized.escalationId);
  escalations.push(normalized);
  escalations.sort((a, b) => a.escalationId.localeCompare(b.escalationId));
  return { ...runtime, escalations };
}

export function coordinateTitanWorkforceSupervisorAgents(
  runtime: TitanWorkforceSupervisorRuntime,
  input: { domainId: string; agentIds: string[] },
) {
  if (runtime.schema !== TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA) throw new Error("workforce-supervisor-runtime-invalid");
  const domainId = requireId(input.domainId, "workforce-supervisor-domain-id");
  const domain = runtime.domains.find((item) => item.domainId === domainId);
  if (!domain) throw new Error("workforce-supervisor-domain-not-owned");
  const agentIds = uniqueIds(input.agentIds, "workforce-supervisor-agent-id");
  const outside = agentIds.filter((agentId) => !domain.agentIds.includes(agentId));
  if (outside.length) throw new Error("workforce-supervisor-agent-outside-domain");
  return {
    companyId: runtime.companyId,
    supervisorId: runtime.supervisorId,
    domainId,
    coordinatedAgentIds: agentIds,
    coordinationOnly: true,
    executionPermitted: false,
    requiresAuthorityEvaluation: true,
    requiresCapabilityResolution: true,
  } as const;
}

export function resolveTitanWorkforceSupervisorConflict(
  runtime: TitanWorkforceSupervisorRuntime,
  conflict: TitanWorkforceSupervisorConflictInput,
): TitanWorkforceSupervisorConflictDecision {
  if (runtime.schema !== TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA) throw new Error("workforce-supervisor-runtime-invalid");
  const domainId = requireId(conflict.domainId, "workforce-supervisor-domain-id");
  const conflictId = requireId(conflict.conflictId, "workforce-supervisor-conflict-id");
  const domain = runtime.domains.find((item) => item.domainId === domainId);
  if (!domain) throw new Error("workforce-supervisor-domain-not-owned");
  const agentIds = uniqueIds(conflict.agentIds, "workforce-supervisor-agent-id");
  if (!agentIds.length) throw new Error("workforce-supervisor-conflict-agents-required");
  if (agentIds.some((agentId) => !domain.agentIds.includes(agentId))) {
    throw new Error("workforce-supervisor-agent-outside-domain");
  }
  if (!["ownership", "priority", "resource", "state", "authority", "other"].includes(conflict.kind)) {
    throw new Error("workforce-supervisor-conflict-kind-invalid");
  }
  if (!["low", "normal", "high", "critical"].includes(conflict.severity)) {
    throw new Error("workforce-supervisor-conflict-severity-invalid");
  }

  const reasons = (conflict.facts ?? []).map((fact) => clean(fact, 500)).filter(Boolean);
  let decision: TitanWorkforceSupervisorConflictDecision["decision"] = "coordinate";
  if (conflict.kind === "authority" || conflict.severity === "critical") decision = "hold_for_manager";
  else if (conflict.severity === "high" && conflict.kind === "other") decision = "hold_for_human";

  return {
    companyId: runtime.companyId,
    supervisorId: runtime.supervisorId,
    domainId,
    conflictId,
    decision,
    coordinatedAgentIds: agentIds,
    reasons,
    executionPermitted: false,
    requiresAuthorityEvaluation: true,
    requiresCapabilityResolution: true,
  };
}

export function summarizeTitanWorkforceSupervisorRuntime(runtime: TitanWorkforceSupervisorRuntime) {
  if (runtime.schema !== TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA) throw new Error("workforce-supervisor-runtime-invalid");
  return {
    schema: runtime.schema,
    companyId: runtime.companyId,
    supervisorId: runtime.supervisorId,
    managerId: runtime.managerId,
    state: runtime.state,
    domainCount: runtime.domains.length,
    activeDomainCount: runtime.domains.filter((domain) => domain.state === "active").length,
    coordinatedAgentCount: new Set(runtime.domains.flatMap((domain) => domain.agentIds)).size,
    openEscalationCount: runtime.escalations.filter((item) => ["open", "acknowledged"].includes(item.state)).length,
    directToolExecution: false,
    grantsAuthority: false,
  } as const;
}
