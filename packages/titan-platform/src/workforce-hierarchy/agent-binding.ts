import { assertTitanWorkforceCompanyId } from "./contract.js";
import type { TitanWorkforceSupervisorRuntime } from "./supervisor-runtime.js";

export const TITAN_WORKFORCE_AGENT_BINDING_SCHEMA = "titan.workforce.agent-binding.v1" as const;
export const TITAN_WORKFORCE_AGENT_INVOCATION_SCHEMA = "titan.workforce.agent-invocation.v1" as const;

export type TitanWorkforceStandaloneAgentDescriptor = {
  agentKey: string;
  roleDefinitionId: string;
  name?: string | null;
  operationalDomains: string[];
  enabled: boolean;
  executionModel: "proposal_or_governed_handoff" | string;
  companyBoundary: "company_id";
  identityGrantsAuthority: false;
};

export type TitanWorkforceAgentBinding = {
  schema: typeof TITAN_WORKFORCE_AGENT_BINDING_SCHEMA;
  companyId: string;
  managerId: string;
  supervisorId: string;
  domainId: string;
  agentKey: string;
  agentInstanceId: string;
  roleDefinitionId: string;
  operationalDomains: string[];
  state: "active" | "paused" | "disabled";
  source: "starter_agent_registry" | "native_agent_registry";
  directInvocationAllowed: true;
  ownershipConfersExecutionAuthority: false;
  directInvocationConfersExecutionAuthority: false;
  executionRequiresAuthorityEvaluation: true;
  executionRequiresCapabilityResolution: true;
  businessOpsRouteRemainsAuthoritative: true;
};

export type TitanWorkforceAgentInvocationPlan = {
  schema: typeof TITAN_WORKFORCE_AGENT_INVOCATION_SCHEMA;
  companyId: string;
  managerId: string;
  supervisorId: string;
  domainId: string;
  agentKey: string;
  agentInstanceId: string;
  invocationMode: "direct" | "manager_delegated" | "supervisor_delegated";
  executionPermitted: false;
  requiresAuthorityEvaluation: true;
  requiresCapabilityResolution: true;
  businessOpsRouteRemainsAuthoritative: true;
  ownershipContextOnly: true;
};

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,180}$/;

function requireId(value: unknown, label: string) {
  const normalized = String(value ?? "").trim().slice(0, 180);
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label}-required`);
  return normalized;
}

function uniqueStrings(values: readonly string[] | undefined, label: string) {
  const result = [...new Set((values ?? []).map((value) => requireId(value, label)))].sort();
  if (!result.length) throw new Error(`${label}s-required`);
  return result;
}

export function bindTitanWorkforceAgentToSupervisor(input: {
  companyId: string;
  supervisor: TitanWorkforceSupervisorRuntime;
  domainId: string;
  agent: TitanWorkforceStandaloneAgentDescriptor;
  agentInstanceId?: string;
  source?: TitanWorkforceAgentBinding["source"];
  state?: TitanWorkforceAgentBinding["state"];
}): TitanWorkforceAgentBinding {
  const companyId = assertTitanWorkforceCompanyId(input.companyId);
  if (input.supervisor.companyId !== companyId) throw new Error("workforce-agent-binding-cross-company-rejected");
  const domainId = requireId(input.domainId, "workforce-agent-binding-domain-id");
  const domain = input.supervisor.domains.find((item) => item.domainId === domainId);
  if (!domain) throw new Error("workforce-agent-binding-domain-not-owned");

  const agentKey = requireId(input.agent.agentKey, "workforce-agent-binding-agent-key");
  const roleDefinitionId = requireId(input.agent.roleDefinitionId, "workforce-agent-binding-role-definition-id");
  if (input.agent.companyBoundary !== "company_id") throw new Error("workforce-agent-binding-company-boundary-invalid");
  if (input.agent.identityGrantsAuthority !== false) throw new Error("workforce-agent-binding-identity-authority-invalid");
  if (!input.agent.enabled) throw new Error("workforce-agent-binding-agent-disabled");

  const operationalDomains = uniqueStrings(input.agent.operationalDomains, "workforce-agent-binding-operational-domain");
  const ownsCompatibleDomain = operationalDomains.some((candidate) =>
    domain.domainId === candidate || domain.domainId.endsWith(`-${candidate}`) || domain.title.toLowerCase().includes(candidate.replace(/_/g, " ")),
  );
  if (!ownsCompatibleDomain && !domain.agentIds.includes(agentKey)) {
    throw new Error("workforce-agent-binding-domain-mismatch");
  }

  const agentInstanceId = requireId(input.agentInstanceId ?? `${companyId}:${agentKey}`, "workforce-agent-binding-instance-id");
  const state = input.state ?? "active";
  if (!["active", "paused", "disabled"].includes(state)) throw new Error("workforce-agent-binding-state-invalid");

  return {
    schema: TITAN_WORKFORCE_AGENT_BINDING_SCHEMA,
    companyId,
    managerId: input.supervisor.managerId,
    supervisorId: input.supervisor.supervisorId,
    domainId,
    agentKey,
    agentInstanceId,
    roleDefinitionId,
    operationalDomains,
    state,
    source: input.source ?? "starter_agent_registry",
    directInvocationAllowed: true,
    ownershipConfersExecutionAuthority: false,
    directInvocationConfersExecutionAuthority: false,
    executionRequiresAuthorityEvaluation: true,
    executionRequiresCapabilityResolution: true,
    businessOpsRouteRemainsAuthoritative: true,
  };
}

export function assertTitanWorkforceAgentBinding(
  binding: TitanWorkforceAgentBinding,
  context: { companyId: string; supervisorId?: string; managerId?: string },
) {
  const companyId = assertTitanWorkforceCompanyId(context.companyId);
  if (binding.schema !== TITAN_WORKFORCE_AGENT_BINDING_SCHEMA) throw new Error("workforce-agent-binding-schema-invalid");
  if (binding.companyId !== companyId) throw new Error("workforce-agent-binding-cross-company-rejected");
  if (context.supervisorId && binding.supervisorId !== context.supervisorId) throw new Error("workforce-agent-binding-supervisor-mismatch");
  if (context.managerId && binding.managerId !== context.managerId) throw new Error("workforce-agent-binding-manager-mismatch");
  if (binding.ownershipConfersExecutionAuthority || binding.directInvocationConfersExecutionAuthority) {
    throw new Error("workforce-agent-binding-authority-expansion-rejected");
  }
  return binding;
}

export function planTitanWorkforceAgentInvocation(
  binding: TitanWorkforceAgentBinding,
  input: { companyId: string; mode?: TitanWorkforceAgentInvocationPlan["invocationMode"] },
): TitanWorkforceAgentInvocationPlan {
  assertTitanWorkforceAgentBinding(binding, { companyId: input.companyId });
  if (binding.state !== "active") throw new Error("workforce-agent-binding-agent-not-active");
  const invocationMode = input.mode ?? "direct";
  if (!["direct", "manager_delegated", "supervisor_delegated"].includes(invocationMode)) {
    throw new Error("workforce-agent-invocation-mode-invalid");
  }
  return {
    schema: TITAN_WORKFORCE_AGENT_INVOCATION_SCHEMA,
    companyId: binding.companyId,
    managerId: binding.managerId,
    supervisorId: binding.supervisorId,
    domainId: binding.domainId,
    agentKey: binding.agentKey,
    agentInstanceId: binding.agentInstanceId,
    invocationMode,
    executionPermitted: false,
    requiresAuthorityEvaluation: true,
    requiresCapabilityResolution: true,
    businessOpsRouteRemainsAuthoritative: true,
    ownershipContextOnly: true,
  };
}

export function summarizeTitanWorkforceAgentBindings(bindings: readonly TitanWorkforceAgentBinding[]) {
  const active = bindings.filter((binding) => binding.state === "active");
  return {
    schema: TITAN_WORKFORCE_AGENT_BINDING_SCHEMA,
    bindingCount: bindings.length,
    activeBindingCount: active.length,
    managerCount: new Set(bindings.map((binding) => binding.managerId)).size,
    supervisorCount: new Set(bindings.map((binding) => binding.supervisorId)).size,
    agentCount: new Set(bindings.map((binding) => binding.agentKey)).size,
    directInvocationPreserved: bindings.every((binding) => binding.directInvocationAllowed),
    grantsAuthority: false,
  } as const;
}
