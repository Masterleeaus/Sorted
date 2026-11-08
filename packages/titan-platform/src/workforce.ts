import {
  routeOperationalRole as routeOperationalRoleRaw,
  serviceDomains as serviceDomainsRaw,
} from "./ported/titan-workforce/role-router.js";

export type TitanOperationalRole = {
  role_definition_id?: string;
  name?: string;
  purpose?: string;
  division_key?: string;
  company_boundary: "company_id";
  activation_confers_authority: false;
  operational_domains?: string[];
  [key: string]: unknown;
};

export type TitanRoleRouteResult = {
  role: TitanOperationalRole | null;
  score: number;
  service: string;
  domains: string[];
};

export const serviceDomains = serviceDomainsRaw as (service?: string) => string[];

export const routeOperationalRole = routeOperationalRoleRaw as (
  outcome?: string,
  service?: string,
  roles?: TitanOperationalRole[],
) => TitanRoleRouteResult;

export {
  STARTER_AGENT_REGISTRY,
  listStarterAgents,
  getStarterAgent,
  assertStarterAgentCompany,
} from "./ported/titan-workforce/starter-agents/starter-agent-registry.js";

export { routeOperationalRole as routeWorkforceRole } from "./ported/titan-workforce/role-router.js";

export {
  TITAN_WORKFORCE_HIERARCHY_CONTRACT,
  TITAN_WORKFORCE_HIERARCHY_SCHEMA,
  TITAN_WORKFORCE_HIERARCHY_TIERS,
  assertTitanWorkforceCompanyId,
  isTitanWorkforceHierarchyTier,
  validateTitanWorkforceHierarchyNode,
  type TitanWorkforceHierarchyContract,
  type TitanWorkforceHierarchyNode,
  type TitanWorkforceHierarchyTier,
} from "./workforce-hierarchy/contract.js";

export {
  TITAN_WORKFORCE_MANAGER_OBJECTIVE_SCHEMA,
  TITAN_WORKFORCE_MANAGER_RUNTIME_SCHEMA,
  createTitanWorkforceManagerRuntime,
  evaluateTitanWorkforceManagerPolicy,
  normalizeTitanWorkforceManagerObjective,
  normalizeTitanWorkforceManagerPolicy,
  summarizeTitanWorkforceManagerRuntime,
  upsertTitanWorkforceManagerObjective,
  type TitanWorkforceManagerObjective,
  type TitanWorkforceManagerPolicy,
  type TitanWorkforceManagerPolicyDecision,
  type TitanWorkforceManagerRuntime,
} from "./workforce-hierarchy/manager-runtime.js";

export {
  TITAN_WORKFORCE_SUPERVISOR_DOMAIN_SCHEMA,
  TITAN_WORKFORCE_SUPERVISOR_ESCALATION_SCHEMA,
  TITAN_WORKFORCE_SUPERVISOR_RUNTIME_SCHEMA,
  coordinateTitanWorkforceSupervisorAgents,
  createTitanWorkforceSupervisorRuntime,
  normalizeTitanWorkforceSupervisorDomain,
  normalizeTitanWorkforceSupervisorEscalation,
  recordTitanWorkforceSupervisorEscalation,
  resolveTitanWorkforceSupervisorConflict,
  summarizeTitanWorkforceSupervisorRuntime,
  upsertTitanWorkforceSupervisorDomain,
  type TitanWorkforceSupervisorConflictDecision,
  type TitanWorkforceSupervisorConflictInput,
  type TitanWorkforceSupervisorDomain,
  type TitanWorkforceSupervisorEscalation,
  type TitanWorkforceSupervisorRuntime,
} from "./workforce-hierarchy/supervisor-runtime.js";

export {
  TITAN_WORKFORCE_AGENT_BINDING_SCHEMA,
  TITAN_WORKFORCE_AGENT_INVOCATION_SCHEMA,
  assertTitanWorkforceAgentBinding,
  bindTitanWorkforceAgentToSupervisor,
  planTitanWorkforceAgentInvocation,
  summarizeTitanWorkforceAgentBindings,
  type TitanWorkforceAgentBinding,
  type TitanWorkforceAgentInvocationPlan,
  type TitanWorkforceStandaloneAgentDescriptor,
} from "./workforce-hierarchy/agent-binding.js";

export {
  TITAN_WORKFORCE_WORKER_EXECUTION_PLAN_SCHEMA,
  TITAN_WORKFORCE_WORKER_RUNTIME_SCHEMA,
  TITAN_WORKFORCE_WORKER_TASK_SCHEMA,
  createTitanWorkforceWorkerRuntime,
  createTitanWorkforceWorkerTask,
  planTitanWorkforceWorkerExecution,
  summarizeTitanWorkforceWorkers,
  type TitanWorkforceAtomicWorkerDescriptor,
  type TitanWorkforceWorkerAuthorityClass,
  type TitanWorkforceWorkerExecutionPlan,
  type TitanWorkforceWorkerRuntime,
  type TitanWorkforceWorkerState,
  type TitanWorkforceWorkerTask,
} from "./workforce-hierarchy/worker-runtime.js";

export {
  TITAN_WORKFORCE_DELEGATION_AUTHORITY_CEILINGS,
  TITAN_WORKFORCE_HIERARCHY_DELEGATION_SCHEMA,
  contractTitanWorkforceDelegationAuthority,
  createTitanWorkforceHierarchyDelegationEnvelope,
  toTitanDelegationTaskEnvelopeInput,
  validateTitanWorkforceHierarchyDelegationEnvelope,
  type TitanWorkforceDelegationAuthorityCeiling,
  type TitanWorkforceHierarchyDelegationEnvelope,
} from "./workforce-hierarchy/delegation-envelope.js";

export {
  TITAN_WORKFORCE_ESCALATION_TIERS,
  TITAN_WORKFORCE_HIERARCHY_APPROVAL_GATE_SCHEMA,
  TITAN_WORKFORCE_HIERARCHY_ESCALATION_SCHEMA,
  createTitanWorkforceHierarchyApprovalGate,
  createTitanWorkforceHierarchyEscalation,
  deEscalateTitanWorkforceHierarchyCase,
  decideTitanWorkforceHierarchyApprovalGate,
  escalateTitanWorkforceHierarchyCase,
  evaluateTitanWorkforceHierarchyApprovalChain,
  setTitanWorkforceHierarchyEscalationState,
  type TitanWorkforceEscalationTier,
  type TitanWorkforceHierarchyApprovalGate,
  type TitanWorkforceHierarchyEscalation,
} from "./workforce-hierarchy/escalation-runtime.js";

export {
  TITAN_WORKFORCE_HIERARCHY_AUDIT_EVENT_SCHEMA,
  TITAN_WORKFORCE_HIERARCHY_REPARENT_PROPOSAL_SCHEMA,
  TITAN_WORKFORCE_HIERARCHY_STATE_SNAPSHOT_SCHEMA,
  appendTitanWorkforceHierarchyAuditEvent,
  applyTitanWorkforceHierarchyReparentProposal,
  createTitanWorkforceHierarchyAuditEvent,
  createTitanWorkforceHierarchyReparentProposal,
  createTitanWorkforceHierarchyStateSnapshot,
  recoverTitanWorkforceHierarchyStateSnapshot,
  serializeTitanWorkforceHierarchyStateSnapshot,
  summarizeTitanWorkforceHierarchyPersistence,
  validateTitanWorkforceHierarchyStateSnapshot,
  type TitanWorkforceHierarchyAuditEvent,
  type TitanWorkforceHierarchyReparentProposal,
  type TitanWorkforceHierarchyStateSnapshot,
} from "./workforce-hierarchy/state-persistence.js";

export {
  buildWorkforceKnowledgeAuthorityPacket,
  evaluateWorkforceKnowledgeUse,
  buildWorkforceKnowledgeUseReceipt,
  summarizeWorkforceKnowledgeAuthority,
} from "./ported/titan-workforce/knowledge/workforce-knowledge-authority-runtime.js";
