import assert from "node:assert/strict";
import test from "node:test";
import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from "../.test-dist/workforce-hierarchy/supervisor-runtime.js";
import { bindTitanWorkforceAgentToSupervisor } from "../.test-dist/workforce-hierarchy/agent-binding.js";
import { createTitanWorkforceWorkerRuntime, createTitanWorkforceWorkerTask } from "../.test-dist/workforce-hierarchy/worker-runtime.js";
import { createTitanWorkforceHierarchyDelegationEnvelope } from "../.test-dist/workforce-hierarchy/delegation-envelope.js";
import {
  createTitanWorkforceHierarchyEscalation,
  escalateTitanWorkforceHierarchyCase,
  deEscalateTitanWorkforceHierarchyCase,
  setTitanWorkforceHierarchyEscalationState,
  createTitanWorkforceHierarchyApprovalGate,
  decideTitanWorkforceHierarchyApprovalGate,
  evaluateTitanWorkforceHierarchyApprovalChain,
} from "../.test-dist/workforce-hierarchy/escalation-runtime.js";

function envelope() {
  const supervisor = upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: "company-01", supervisorId: "supervisor-ops", managerId: "manager-01" }),
    { schema: "titan.workforce.supervisor-domain.v1", companyId: "company-01", domainId: "domain-operations", title: "Operations", supervisorId: "supervisor-ops", agentIds: ["dispatch"], objectiveIds: [], state: "active", domainOwnershipConfersExecutionAuthority: false },
  );
  const agentBinding = bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor, domainId: "domain-operations", agent: { agentKey: "dispatch", roleDefinitionId: "titan.work.dispatcher", operationalDomains: ["dispatch", "operations"], enabled: true, executionModel: "proposal_or_governed_handoff", companyBoundary: "company_id", identityGrantsAuthority: false } });
  const worker = createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding, worker: { workerId: "worker.assign", workerName: "Assign Worker", atomicAction: "Assign Cleaner", toolIds: ["custom_tools"], authorityClass: "PROTECTED_EXECUTION", requiresApproval: true, requiresIdempotencyKey: true, requiresExecutionReceipt: true, companyBoundary: "company_id", identityGrantsAuthority: false, bindingGrantsAuthority: false, workerCanDelegate: false } });
  const task = createTitanWorkforceWorkerTask(worker, { companyId: "company-01", taskId: "task-1", objective: "Assign cleaner", expectedOutcome: "Assignment ready", approvalGranted: true, idempotencyKey: "task-1-key" });
  return createTitanWorkforceHierarchyDelegationEnvelope({ companyId: "company-01", delegationId: "del-1", agentBinding, worker, task, originatingAuthorityCeiling: "WRITE_INTERNAL", requestedAuthorityCeiling: "PROPOSE", idempotencyKey: "del-1-key", correlationId: "corr-1" });
}

test("escalation moves only one tier upward at a time", () => {
  const e = createTitanWorkforceHierarchyEscalation({ envelope: envelope(), escalationId: "esc-1", fromTier: "worker", toTier: "agent", reason: "worker needs coordination" });
  assert.deepEqual(e.path, ["worker", "agent"]);
  const supervisor = escalateTitanWorkforceHierarchyCase(e, "supervisor");
  assert.deepEqual(supervisor.path, ["worker", "agent", "supervisor"]);
  assert.throws(() => escalateTitanWorkforceHierarchyCase(e, "manager"), /one-tier-up/);
  assert.equal(supervisor.executionPermitted, false);
});

test("de-escalation requires acknowledgement or resolution and moves one tier down", () => {
  let e = createTitanWorkforceHierarchyEscalation({ envelope: envelope(), escalationId: "esc-2", fromTier: "worker", toTier: "agent", reason: "needs review" });
  e = escalateTitanWorkforceHierarchyCase(e, "supervisor");
  assert.throws(() => deEscalateTitanWorkforceHierarchyCase(e, "agent"), /requires-acknowledged-or-resolved/);
  e = setTitanWorkforceHierarchyEscalationState(e, "acknowledged");
  const down = deEscalateTitanWorkforceHierarchyCase(e, "agent");
  assert.equal(down.targetTier, "agent");
  assert.equal(down.deEscalationConfersExecutionAuthority, false);
});

test("approval gate is bound to the expected hierarchy actor", () => {
  const env = envelope();
  const gate = createTitanWorkforceHierarchyApprovalGate({ envelope: env, gateId: "gate-1", requiredTier: "supervisor", reason: "protected write requires supervisor review" });
  assert.equal(gate.requiredApproverId, "supervisor-ops");
  assert.throws(() => decideTitanWorkforceHierarchyApprovalGate(gate, { companyId: "company-01", approverId: "dispatch", tier: "agent", decision: "approved" }), /tier-mismatch/);
  assert.throws(() => decideTitanWorkforceHierarchyApprovalGate(gate, { companyId: "company-01", approverId: "supervisor-other", tier: "supervisor", decision: "approved" }), /approver-mismatch/);
  const approved = decideTitanWorkforceHierarchyApprovalGate(gate, { companyId: "company-01", approverId: "supervisor-ops", tier: "supervisor", decision: "approved" });
  assert.equal(approved.state, "approved");
  assert.equal(approved.approvalConfersExecutionAuthority, false);
});

test("approved hierarchy chain stops at authority gate rather than executing", () => {
  const env = envelope();
  const agent = decideTitanWorkforceHierarchyApprovalGate(
    createTitanWorkforceHierarchyApprovalGate({ envelope: env, gateId: "gate-agent", requiredTier: "agent", reason: "agent review" }),
    { companyId: "company-01", approverId: "dispatch", tier: "agent", decision: "approved" },
  );
  const supervisor = decideTitanWorkforceHierarchyApprovalGate(
    createTitanWorkforceHierarchyApprovalGate({ envelope: env, gateId: "gate-supervisor", requiredTier: "supervisor", reason: "supervisor review" }),
    { companyId: "company-01", approverId: "supervisor-ops", tier: "supervisor", decision: "approved" },
  );
  const manager = decideTitanWorkforceHierarchyApprovalGate(
    createTitanWorkforceHierarchyApprovalGate({ envelope: env, gateId: "gate-manager", requiredTier: "manager", reason: "manager review" }),
    { companyId: "company-01", approverId: "manager-01", tier: "manager", decision: "approved" },
  );
  const result = evaluateTitanWorkforceHierarchyApprovalChain([agent, supervisor, manager]);
  assert.equal(result.state, "READY_FOR_AUTHORITY_GATE");
  assert.equal(result.executionPermitted, false);
  assert.equal(result.requiresAuthorityEvaluation, true);
  assert.equal(result.requiresCapabilityResolution, true);
});

test("denial blocks hierarchy chain and cross-company approval is rejected", () => {
  const env = envelope();
  const gate = createTitanWorkforceHierarchyApprovalGate({ envelope: env, gateId: "gate-deny", requiredTier: "manager", reason: "manager review" });
  assert.throws(() => decideTitanWorkforceHierarchyApprovalGate(gate, { companyId: "company-02", approverId: "manager-01", tier: "manager", decision: "approved" }), /cross-company/);
  const denied = decideTitanWorkforceHierarchyApprovalGate(gate, { companyId: "company-01", approverId: "manager-01", tier: "manager", decision: "denied", reason: "risk too high" });
  const result = evaluateTitanWorkforceHierarchyApprovalChain([denied]);
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.executionPermitted, false);
});
