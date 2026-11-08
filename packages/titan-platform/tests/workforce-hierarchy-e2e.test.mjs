import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTitanWorkforceHierarchyFlow, verifyTitanWorkforceRepresentativeHierarchyFlows } from '../.test-dist/workforce-hierarchy/e2e-verification.js';
import { createTitanWorkforceManagerRuntime } from '../.test-dist/workforce-hierarchy/manager-runtime.js';
import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from '../.test-dist/workforce-hierarchy/supervisor-runtime.js';
import { bindTitanWorkforceAgentToSupervisor } from '../.test-dist/workforce-hierarchy/agent-binding.js';
import { createTitanWorkforceWorkerRuntime, createTitanWorkforceWorkerTask } from '../.test-dist/workforce-hierarchy/worker-runtime.js';
import { createTitanWorkforceHierarchyDelegationEnvelope, contractTitanWorkforceDelegationAuthority } from '../.test-dist/workforce-hierarchy/delegation-envelope.js';
import { createTitanWorkforceHierarchyEscalation } from '../.test-dist/workforce-hierarchy/escalation-runtime.js';

for (const flow of ['reception', 'booking', 'dispatch', 'jobs', 'invoicing']) {
  test(`${flow} representative hierarchy flow remains governed end to end`, () => {
    const result = verifyTitanWorkforceHierarchyFlow({ flow, companyId: `company-test-${flow}` });
    assert.equal(result.approvalState, 'PENDING_APPROVAL');
    assert.equal(result.executionPermitted, false);
    assert.equal(result.checks.businessOpsRouteRemainsAuthoritative, true);
    assert.equal(result.checks.restartRequiresAuthorityReevaluation, true);
  });
}

test('representative flow suite covers all five starter business flows', () => {
  const suite = verifyTitanWorkforceRepresentativeHierarchyFlows('company-suite');
  assert.equal(suite.flowCount, 5);
  assert.equal(suite.allPassed, true);
  assert.deepEqual(suite.flows.map((item) => item.flow), ['reception', 'booking', 'dispatch', 'jobs', 'invoicing']);
});

test('authority ceiling cannot expand during representative flow delegation', () => {
  assert.throws(() => contractTitanWorkforceDelegationAuthority('WRITE_INTERNAL', 'FINANCIAL'), /authority-expansion-rejected/);
});

test('cross-company task and delegation are rejected', () => {
  const companyId = 'company-a';
  const manager = createTitanWorkforceManagerRuntime({ companyId, managerId: 'manager-a' });
  assert.equal(manager.companyId, companyId);
  const supervisor = upsertTitanWorkforceSupervisorDomain(createTitanWorkforceSupervisorRuntime({ companyId, supervisorId: 'supervisor-a', managerId: 'manager-a' }), { schema: 'titan.workforce.supervisor-domain.v1', companyId, domainId: 'dispatch', title: 'dispatch', supervisorId: 'supervisor-a', agentIds: ['dispatch'], objectiveIds: [], state: 'active', domainOwnershipConfersExecutionAuthority: false });
  const agent = bindTitanWorkforceAgentToSupervisor({ companyId, supervisor, domainId: 'dispatch', agent: { agentKey: 'dispatch', roleDefinitionId: 'titan.work.dispatcher', operationalDomains: ['dispatch'], enabled: true, executionModel: 'proposal_or_governed_handoff', companyBoundary: 'company_id', identityGrantsAuthority: false } });
  const worker = createTitanWorkforceWorkerRuntime({ companyId, agentBinding: agent, worker: { workerId: 'worker-a', workerName: 'worker', atomicAction: 'assign', toolIds: ['dispatch'], authorityClass: 'PROTECTED_EXECUTION', requiresApproval: true, requiresIdempotencyKey: true, requiresExecutionReceipt: true, companyBoundary: 'company_id', identityGrantsAuthority: false, bindingGrantsAuthority: false, workerCanDelegate: false } });
  assert.throws(() => createTitanWorkforceWorkerTask(worker, { companyId: 'company-b', taskId: 'task-b', objective: 'x', expectedOutcome: 'x' }), /cross-company-rejected/);
  assert.throws(() => createTitanWorkforceHierarchyDelegationEnvelope({ companyId: 'company-b', delegationId: 'd-b', agentBinding: agent, worker, objective: 'x', originatingAuthorityCeiling: 'PROPOSE', idempotencyKey: 'i-b', correlationId: 'c-b' }), /cross-company-agent-rejected/);
});

test('escalation cannot skip hierarchy tiers', () => {
  // Build a valid dispatch envelope via the public verifier path is separately covered; this test targets the hardening invariant directly.
  const companyId = 'company-skip';
  const supervisor = upsertTitanWorkforceSupervisorDomain(createTitanWorkforceSupervisorRuntime({ companyId, supervisorId: 'supervisor-skip', managerId: 'manager-skip' }), { schema: 'titan.workforce.supervisor-domain.v1', companyId, domainId: 'dispatch', title: 'dispatch', supervisorId: 'supervisor-skip', agentIds: ['dispatch'], objectiveIds: [], state: 'active', domainOwnershipConfersExecutionAuthority: false });
  const agent = bindTitanWorkforceAgentToSupervisor({ companyId, supervisor, domainId: 'dispatch', agent: { agentKey: 'dispatch', roleDefinitionId: 'titan.work.dispatcher', operationalDomains: ['dispatch'], enabled: true, executionModel: 'proposal_or_governed_handoff', companyBoundary: 'company_id', identityGrantsAuthority: false } });
  const worker = createTitanWorkforceWorkerRuntime({ companyId, agentBinding: agent, worker: { workerId: 'worker-skip', workerName: 'worker', atomicAction: 'assign', toolIds: ['dispatch'], authorityClass: 'PROTECTED_EXECUTION', requiresApproval: false, requiresIdempotencyKey: false, requiresExecutionReceipt: true, companyBoundary: 'company_id', identityGrantsAuthority: false, bindingGrantsAuthority: false, workerCanDelegate: false } });
  const envelope = createTitanWorkforceHierarchyDelegationEnvelope({ companyId, delegationId: 'd-skip', agentBinding: agent, worker, objective: 'x', originatingAuthorityCeiling: 'PROPOSE', idempotencyKey: 'i-skip', correlationId: 'c-skip' });
  assert.throws(() => createTitanWorkforceHierarchyEscalation({ envelope, escalationId: 'e-skip', fromTier: 'worker', toTier: 'supervisor', reason: 'skip' }), /must-move-one-tier-up/);
});
