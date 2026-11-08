import assert from 'node:assert/strict';
import test from 'node:test';
import { createTitanWorkforceManagerRuntime } from '../.test-dist/workforce-hierarchy/manager-runtime.js';
import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from '../.test-dist/workforce-hierarchy/supervisor-runtime.js';
import { bindTitanWorkforceAgentToSupervisor } from '../.test-dist/workforce-hierarchy/agent-binding.js';
import { createTitanWorkforceWorkerRuntime } from '../.test-dist/workforce-hierarchy/worker-runtime.js';
import { createTitanWorkforceHierarchyStateSnapshot, createTitanWorkforceHierarchyAuditEvent } from '../.test-dist/workforce-hierarchy/state-persistence.js';
import { createTitanWorkforceHierarchyAdminView, diagnoseTitanWorkforceHierarchy } from '../.test-dist/workforce-hierarchy/diagnostics.js';

function fixture() {
  const manager = createTitanWorkforceManagerRuntime({ companyId: 'company-01', managerId: 'manager-01' });
  const supervisor = upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: 'company-01', supervisorId: 'supervisor-01', managerId: 'manager-01' }),
    { schema: 'titan.workforce.supervisor-domain.v1', companyId: 'company-01', domainId: 'dispatch', title: 'Dispatch', supervisorId: 'supervisor-01', agentIds: ['dispatch'], objectiveIds: [], state: 'active', domainOwnershipConfersExecutionAuthority: false },
  );
  const agent = bindTitanWorkforceAgentToSupervisor({ companyId: 'company-01', supervisor, domainId: 'dispatch', agentInstanceId: 'agent-dispatch-01', agent: { agentKey: 'dispatch', roleDefinitionId: 'titan.work.dispatcher', operationalDomains: ['dispatch'], enabled: true, executionModel: 'proposal_or_governed_handoff', companyBoundary: 'company_id', identityGrantsAuthority: false } });
  const worker = createTitanWorkforceWorkerRuntime({ companyId: 'company-01', agentBinding: agent, worker: { workerId: 'worker.assign', workerName: 'Assign Worker', atomicAction: 'Assign Cleaner', toolIds: ['custom_tools'], authorityClass: 'PROTECTED_EXECUTION', requiresApproval: true, requiresIdempotencyKey: true, requiresExecutionReceipt: true, companyBoundary: 'company_id', identityGrantsAuthority: false, bindingGrantsAuthority: false, workerCanDelegate: false } });
  const audit = createTitanWorkforceHierarchyAuditEvent({ companyId: 'company-01', eventId: 'audit-1', eventType: 'snapshot_created', actorId: 'manager-01', targetTier: 'hierarchy', targetId: 'company-01', revision: 3, occurredAt: '2026-09-13T06:00:00+10:00' });
  return createTitanWorkforceHierarchyStateSnapshot({ companyId: 'company-01', revision: 3, managerRuntimes: [manager], supervisorRuntimes: [supervisor], agentBindings: [agent], workers: [worker], auditHistory: [audit] });
}

test('healthy hierarchy diagnostics are read-only and authority neutral', () => {
  const diagnostics = diagnoseTitanWorkforceHierarchy(fixture(), { generatedAt: '2026-09-13T06:10:00+10:00' });
  assert.equal(diagnostics.health, 'healthy');
  assert.equal(diagnostics.counts.managers, 1);
  assert.equal(diagnostics.counts.workers, 1);
  assert.equal(diagnostics.authority.diagnosticsConfersExecutionAuthority, false);
  assert.equal(diagnostics.authority.businessOpsRouteRemainsAuthoritative, true);
});

test('paused/degraded hierarchy nodes surface attention without mutation', () => {
  const snapshot = fixture();
  const degraded = createTitanWorkforceHierarchyStateSnapshot({ ...snapshot, managerRuntimes: [{ ...snapshot.managerRuntimes[0], state: 'degraded' }] });
  const diagnostics = diagnoseTitanWorkforceHierarchy(degraded);
  assert.equal(diagnostics.health, 'critical');
  assert.ok(diagnostics.issues.some((item) => item.code === 'manager_degraded'));
  assert.equal(snapshot.managerRuntimes[0].state, 'active');
});

test('admin projection exposes hierarchy rows and recent audit without execution controls', () => {
  const view = createTitanWorkforceHierarchyAdminView(fixture(), { auditLimit: 5, generatedAt: '2026-09-13T06:11:00+10:00' });
  assert.equal(view.readOnly, true);
  assert.equal(view.executionPermitted, false);
  assert.equal(view.hierarchyRows.length, 4);
  assert.equal(view.recentAudit.length, 1);
  assert.ok(view.summaryCards.some((card) => card.key === 'revision' && card.value === 3));
});
