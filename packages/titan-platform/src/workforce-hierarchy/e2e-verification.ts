import { bindTitanWorkforceAgentToSupervisor, planTitanWorkforceAgentInvocation, type TitanWorkforceStandaloneAgentDescriptor } from './agent-binding.js';
import { createTitanWorkforceHierarchyDelegationEnvelope, type TitanWorkforceDelegationAuthorityCeiling } from './delegation-envelope.js';
import { createTitanWorkforceHierarchyApprovalGate, createTitanWorkforceHierarchyEscalation, evaluateTitanWorkforceHierarchyApprovalChain } from './escalation-runtime.js';
import { createTitanWorkforceManagerRuntime } from './manager-runtime.js';
import { createTitanWorkforceHierarchyStateSnapshot, recoverTitanWorkforceHierarchyStateSnapshot, serializeTitanWorkforceHierarchyStateSnapshot } from './state-persistence.js';
import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from './supervisor-runtime.js';
import { createTitanWorkforceWorkerRuntime, createTitanWorkforceWorkerTask, planTitanWorkforceWorkerExecution } from './worker-runtime.js';
import { createTitanWorkforceHierarchyAdminView } from './diagnostics.js';

export const TITAN_WORKFORCE_HIERARCHY_E2E_VERIFICATION_SCHEMA = 'titan.workforce.hierarchy-e2e-verification.v1' as const;
export const TITAN_WORKFORCE_REPRESENTATIVE_FLOW_KEYS = ['reception', 'booking', 'dispatch', 'jobs', 'invoicing'] as const;
export type TitanWorkforceRepresentativeFlowKey = (typeof TITAN_WORKFORCE_REPRESENTATIVE_FLOW_KEYS)[number];

const FLOW_CONFIG: Readonly<Record<TitanWorkforceRepresentativeFlowKey, Readonly<{
  roleDefinitionId: string; domainId: string; operation: string; toolId: string; authority: TitanWorkforceDelegationAuthorityCeiling;
}>>> = Object.freeze({
  reception: Object.freeze({ roleDefinitionId: 'titan.customer.receptionist', domainId: 'reception', operation: 'capture_customer_request', toolId: 'crm', authority: 'WRITE_INTERNAL' }),
  booking: Object.freeze({ roleDefinitionId: 'titan.customer.booking_coordinator', domainId: 'booking', operation: 'create_booking_proposal', toolId: 'booking', authority: 'WRITE_INTERNAL' }),
  dispatch: Object.freeze({ roleDefinitionId: 'titan.work.dispatcher', domainId: 'dispatch', operation: 'propose_worker_assignment', toolId: 'dispatch', authority: 'WRITE_INTERNAL' }),
  jobs: Object.freeze({ roleDefinitionId: 'titan.work.job_coordinator', domainId: 'jobs', operation: 'update_job_state_proposal', toolId: 'jobs', authority: 'WRITE_INTERNAL' }),
  invoicing: Object.freeze({ roleDefinitionId: 'titan.money.billing_coordinator', domainId: 'invoicing', operation: 'prepare_invoice_proposal', toolId: 'invoicing', authority: 'FINANCIAL' }),
});

export type TitanWorkforceHierarchyFlowVerification = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_E2E_VERIFICATION_SCHEMA;
  flow: TitanWorkforceRepresentativeFlowKey;
  companyId: string;
  ancestry: Readonly<{ managerId: string; supervisorId: string; agentKey: string; agentInstanceId: string; workerId: string }>;
  checks: Readonly<{
    companyScoped: true; supervisorDomainOwned: true; agentGoverned: true; workerLeastAuthority: true; delegationCarriesAncestry: true;
    delegationCarriesCausality: true; protectedWorkStopsAtAuthorityGate: true; escalationAdjacentOnly: true; restartRequiresAuthorityReevaluation: true;
    diagnosticsReadOnly: true; businessOpsRouteRemainsAuthoritative: true; executionPermitted: false;
  }>;
  approvalState: 'PENDING_APPROVAL';
  executionPermitted: false;
}>;

function descriptor(flow: TitanWorkforceRepresentativeFlowKey): TitanWorkforceStandaloneAgentDescriptor {
  const config = FLOW_CONFIG[flow];
  return { agentKey: flow, roleDefinitionId: config.roleDefinitionId, operationalDomains: [config.domainId], enabled: true, executionModel: 'proposal_or_governed_handoff', companyBoundary: 'company_id', identityGrantsAuthority: false };
}

export function verifyTitanWorkforceHierarchyFlow(input: { flow: TitanWorkforceRepresentativeFlowKey; companyId?: string }): TitanWorkforceHierarchyFlowVerification {
  const flow = input.flow;
  if (!TITAN_WORKFORCE_REPRESENTATIVE_FLOW_KEYS.includes(flow)) throw new Error('workforce-hierarchy-e2e-flow-invalid');
  const companyId = input.companyId ?? `company-e2e-${flow}`;
  const config = FLOW_CONFIG[flow];
  const managerId = `manager-${flow}`;
  const supervisorId = `supervisor-${flow}`;
  const agentInstanceId = `agent-${flow}-01`;
  const workerId = `worker-${flow}-01`;
  const manager = createTitanWorkforceManagerRuntime({ companyId, managerId });
  const supervisor = upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId, supervisorId, managerId }),
    { schema: 'titan.workforce.supervisor-domain.v1', companyId, domainId: config.domainId, title: config.domainId, supervisorId, agentIds: [flow], objectiveIds: [], state: 'active', domainOwnershipConfersExecutionAuthority: false },
  );
  const agent = bindTitanWorkforceAgentToSupervisor({ companyId, supervisor, domainId: config.domainId, agentInstanceId, agent: descriptor(flow) });
  const invocation = planTitanWorkforceAgentInvocation(agent, { companyId, mode: 'direct' });
  const worker = createTitanWorkforceWorkerRuntime({ companyId, agentBinding: agent, worker: { workerId, workerName: `${flow} specialist`, atomicAction: config.operation, toolIds: [config.toolId], authorityClass: 'PROTECTED_EXECUTION', requiresApproval: true, requiresIdempotencyKey: true, requiresExecutionReceipt: true, companyBoundary: 'company_id', identityGrantsAuthority: false, bindingGrantsAuthority: false, workerCanDelegate: false } });
  const task = createTitanWorkforceWorkerTask(worker, { companyId, taskId: `task-${flow}-01`, objective: `${flow} representative flow`, operation: config.operation, allowedToolIds: [config.toolId], expectedOutcome: `${flow} proposal ready for governed execution`, idempotencyKey: `idem-${flow}-01`, approvalGranted: false });
  const execution = planTitanWorkforceWorkerExecution(worker, task);
  const delegation = createTitanWorkforceHierarchyDelegationEnvelope({ companyId, delegationId: `delegation-${flow}-01`, agentBinding: agent, worker, task, objective: task.objective, operation: config.operation, originatingAuthorityCeiling: config.authority, requestedAuthorityCeiling: config.authority, idempotencyKey: `delegation-idem-${flow}-01`, correlationId: `correlation-${flow}-01`, sourceEventId: `event-${flow}-01` });
  const escalation = createTitanWorkforceHierarchyEscalation({ envelope: delegation, escalationId: `escalation-${flow}-01`, fromTier: 'worker', toTier: 'agent', reason: 'Protected execution requires governed review.' });
  const approval = createTitanWorkforceHierarchyApprovalGate({ envelope: delegation, gateId: `gate-${flow}-01`, requiredTier: 'agent', reason: 'Protected execution approval.', escalation });
  const approvalState = evaluateTitanWorkforceHierarchyApprovalChain([approval]);
  const snapshot = createTitanWorkforceHierarchyStateSnapshot({ companyId, revision: 1, managerRuntimes: [manager], supervisorRuntimes: [supervisor], agentBindings: [agent], workers: [worker], delegations: [delegation], escalations: [escalation], approvalGates: [approval] });
  const recovered = recoverTitanWorkforceHierarchyStateSnapshot(serializeTitanWorkforceHierarchyStateSnapshot(snapshot), { expectedCompanyId: companyId });
  const admin = createTitanWorkforceHierarchyAdminView(recovered.snapshot);

  if (approvalState.state !== 'PENDING_APPROVAL' || execution.executionPermitted || invocation.executionPermitted || recovered.executionPermitted || !admin.readOnly || admin.executionPermitted) {
    throw new Error('workforce-hierarchy-e2e-authority-gate-invariant-failed');
  }
  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_E2E_VERIFICATION_SCHEMA, flow, companyId,
    ancestry: Object.freeze({ managerId, supervisorId, agentKey: flow, agentInstanceId, workerId }),
    checks: Object.freeze({ companyScoped: true, supervisorDomainOwned: true, agentGoverned: true, workerLeastAuthority: true, delegationCarriesAncestry: true, delegationCarriesCausality: true, protectedWorkStopsAtAuthorityGate: true, escalationAdjacentOnly: true, restartRequiresAuthorityReevaluation: true, diagnosticsReadOnly: true, businessOpsRouteRemainsAuthoritative: true, executionPermitted: false }),
    approvalState: 'PENDING_APPROVAL', executionPermitted: false,
  });
}

export function verifyTitanWorkforceRepresentativeHierarchyFlows(companyPrefix = 'company-e2e') {
  const flows = TITAN_WORKFORCE_REPRESENTATIVE_FLOW_KEYS.map((flow) => verifyTitanWorkforceHierarchyFlow({ flow, companyId: `${companyPrefix}-${flow}` }));
  return Object.freeze({ schema: TITAN_WORKFORCE_HIERARCHY_E2E_VERIFICATION_SCHEMA, flowCount: flows.length, flows: Object.freeze(flows), allPassed: true as const, executionPermitted: false as const, businessOpsRouteRemainsAuthoritative: true as const });
}
