import assert from "node:assert/strict";
import test from "node:test";
import { createTitanWorkforceManagerRuntime } from "../.test-dist/workforce-hierarchy/manager-runtime.js";
import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from "../.test-dist/workforce-hierarchy/supervisor-runtime.js";
import { bindTitanWorkforceAgentToSupervisor } from "../.test-dist/workforce-hierarchy/agent-binding.js";
import { createTitanWorkforceWorkerRuntime, createTitanWorkforceWorkerTask } from "../.test-dist/workforce-hierarchy/worker-runtime.js";
import { createTitanWorkforceHierarchyDelegationEnvelope } from "../.test-dist/workforce-hierarchy/delegation-envelope.js";
import {
  appendTitanWorkforceHierarchyAuditEvent,
  applyTitanWorkforceHierarchyReparentProposal,
  createTitanWorkforceHierarchyAuditEvent,
  createTitanWorkforceHierarchyReparentProposal,
  createTitanWorkforceHierarchyStateSnapshot,
  recoverTitanWorkforceHierarchyStateSnapshot,
  serializeTitanWorkforceHierarchyStateSnapshot,
  summarizeTitanWorkforceHierarchyPersistence,
} from "../.test-dist/workforce-hierarchy/state-persistence.js";

function supervisor(supervisorId, managerId, domainId, agentIds = []) {
  return upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: "company-01", supervisorId, managerId }),
    { schema: "titan.workforce.supervisor-domain.v1", companyId: "company-01", domainId, title: domainId.replace(/-/g, " "), supervisorId, agentIds, objectiveIds: [], state: "active", domainOwnershipConfersExecutionAuthority: false },
  );
}

function fixture({ withDelegation = false } = {}) {
  const manager1 = createTitanWorkforceManagerRuntime({ companyId: "company-01", managerId: "manager-01" });
  const manager2 = createTitanWorkforceManagerRuntime({ companyId: "company-01", managerId: "manager-02" });
  const sup1 = supervisor("supervisor-01", "manager-01", "domain-dispatch", ["dispatch"]);
  const sup2 = supervisor("supervisor-02", "manager-02", "domain-operations", ["dispatch"]);
  const binding1 = bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor: sup1, domainId: "domain-dispatch", agentInstanceId: "agent-dispatch-01", agent: { agentKey: "dispatch", roleDefinitionId: "titan.work.dispatcher", operationalDomains: ["dispatch", "operations"], enabled: true, executionModel: "proposal_or_governed_handoff", companyBoundary: "company_id", identityGrantsAuthority: false } });
  const binding2 = bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor: sup2, domainId: "domain-operations", agentInstanceId: "agent-dispatch-02", agent: { agentKey: "dispatch", roleDefinitionId: "titan.work.dispatcher", operationalDomains: ["dispatch", "operations"], enabled: true, executionModel: "proposal_or_governed_handoff", companyBoundary: "company_id", identityGrantsAuthority: false } });
  const worker = createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding: binding1, worker: { workerId: "worker.assign", workerName: "Assign Worker", atomicAction: "Assign Cleaner", toolIds: ["custom_tools"], authorityClass: "PROTECTED_EXECUTION", requiresApproval: true, requiresIdempotencyKey: true, requiresExecutionReceipt: true, companyBoundary: "company_id", identityGrantsAuthority: false, bindingGrantsAuthority: false, workerCanDelegate: false } });
  const delegations = [];
  if (withDelegation) {
    const task = createTitanWorkforceWorkerTask(worker, { companyId: "company-01", taskId: "task-1", objective: "Assign cleaner", expectedOutcome: "Assignment ready", approvalGranted: true, idempotencyKey: "task-1-key" });
    delegations.push(createTitanWorkforceHierarchyDelegationEnvelope({ companyId: "company-01", delegationId: "del-1", agentBinding: binding1, worker, task, originatingAuthorityCeiling: "WRITE_INTERNAL", requestedAuthorityCeiling: "PROPOSE", idempotencyKey: "del-1-key", correlationId: "corr-1" }));
  }
  const snapshot = createTitanWorkforceHierarchyStateSnapshot({ companyId: "company-01", revision: 7, createdAt: "2026-09-13T05:00:00+10:00", managerRuntimes: [manager1, manager2], supervisorRuntimes: [sup1, sup2], agentBindings: [binding1, binding2], workers: [worker], delegations });
  return { snapshot, binding1, binding2, worker };
}

test("snapshot serializes and restart recovery revalidates hierarchy without execution authority", () => {
  const { snapshot } = fixture();
  const serialized = serializeTitanWorkforceHierarchyStateSnapshot(snapshot);
  const recovered = recoverTitanWorkforceHierarchyStateSnapshot(serialized, { expectedCompanyId: "company-01" });
  assert.equal(recovered.restartSafe, true);
  assert.equal(recovered.executionPermitted, false);
  assert.equal(recovered.requiresAuthorityReevaluationForExecution, true);
  assert.equal(recovered.snapshot.revision, 7);
  assert.equal(summarizeTitanWorkforceHierarchyPersistence(recovered.snapshot).workers, 1);
});

test("restart recovery rejects cross-company tampering", () => {
  const { snapshot } = fixture();
  const tampered = JSON.parse(serializeTitanWorkforceHierarchyStateSnapshot(snapshot));
  tampered.workers[0].companyId = "company-02";
  assert.throws(() => recoverTitanWorkforceHierarchyStateSnapshot(JSON.stringify(tampered)), /cross-company-worker-rejected/);
});

test("audit history is append-only and revision-aware", () => {
  const { snapshot } = fixture();
  const event = createTitanWorkforceHierarchyAuditEvent({ companyId: "company-01", eventId: "audit-1", eventType: "snapshot_created", actorId: "manager-01", targetTier: "hierarchy", targetId: "company-01", revision: 7, occurredAt: "2026-09-13T05:01:00+10:00" });
  const updated = appendTitanWorkforceHierarchyAuditEvent(snapshot, event);
  assert.equal(updated.auditHistory.length, 1);
  assert.equal(updated.auditHistory[0].eventConfersExecutionAuthority, false);
  assert.throws(() => appendTitanWorkforceHierarchyAuditEvent(updated, event), /duplicate/);
});

test("agent reparenting rebuilds parentage through supervisor/domain validation", () => {
  const { snapshot } = fixture();
  const proposal = createTitanWorkforceHierarchyReparentProposal({ snapshot, proposalId: "move-agent-1", targetTier: "agent", targetId: "agent-dispatch-01", newParentId: "supervisor-02", newDomainId: "domain-operations", requestedById: "manager-01", reason: "balance operations capacity", createdAt: "2026-09-13T05:02:00+10:00" });
  const updated = applyTitanWorkforceHierarchyReparentProposal(snapshot, proposal);
  const moved = updated.agentBindings.find((item) => item.agentInstanceId === "agent-dispatch-01");
  const worker = updated.workers.find((item) => item.workerId === "worker.assign");
  assert.equal(updated.revision, 8);
  assert.equal(moved.supervisorId, "supervisor-02");
  assert.equal(moved.managerId, "manager-02");
  assert.equal(worker.supervisorId, "supervisor-02");
  assert.equal(worker.managerId, "manager-02");
  assert.equal(moved.ownershipConfersExecutionAuthority, false);
  assert.equal(updated.auditHistory.at(-1).eventType, "reparent_applied");
  assert.equal(updated.auditHistory.at(-1).revision, 8);
});

test("reparenting refuses to change ancestry underneath active delegations", () => {
  const { snapshot } = fixture({ withDelegation: true });
  const proposal = createTitanWorkforceHierarchyReparentProposal({ snapshot, proposalId: "move-worker-1", targetTier: "worker", targetId: "worker.assign", newParentId: "agent-dispatch-02", requestedById: "supervisor-01", reason: "move specialist after handover" });
  assert.throws(() => applyTitanWorkforceHierarchyReparentProposal(snapshot, proposal), /active-delegations-must-drain/);
});
