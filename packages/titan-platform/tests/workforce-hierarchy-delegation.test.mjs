import assert from "node:assert/strict";
import test from "node:test";
import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from "../.test-dist/workforce-hierarchy/supervisor-runtime.js";
import { bindTitanWorkforceAgentToSupervisor } from "../.test-dist/workforce-hierarchy/agent-binding.js";
import { createTitanWorkforceWorkerRuntime, createTitanWorkforceWorkerTask } from "../.test-dist/workforce-hierarchy/worker-runtime.js";
import { createTitanWorkforceHierarchyDelegationEnvelope, contractTitanWorkforceDelegationAuthority, toTitanDelegationTaskEnvelopeInput, validateTitanWorkforceHierarchyDelegationEnvelope } from "../.test-dist/workforce-hierarchy/delegation-envelope.js";

function binding() {
  const supervisor = upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: "company-01", supervisorId: "supervisor-ops", managerId: "manager-01" }),
    { schema: "titan.workforce.supervisor-domain.v1", companyId: "company-01", domainId: "domain-operations", title: "Operations", supervisorId: "supervisor-ops", agentIds: ["dispatch"], objectiveIds: [], state: "active", domainOwnershipConfersExecutionAuthority: false },
  );
  return bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor, domainId: "domain-operations", agent: { agentKey: "dispatch", roleDefinitionId: "titan.work.dispatcher", operationalDomains: ["dispatch", "operations"], enabled: true, executionModel: "proposal_or_governed_handoff", companyBoundary: "company_id", identityGrantsAuthority: false } });
}
function worker() {
  return createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding: binding(), worker: { workerId: "worker.assign", workerName: "Assign Worker", atomicAction: "Assign Cleaner", toolIds: ["custom_tools"], authorityClass: "PROTECTED_EXECUTION", requiresApproval: true, requiresIdempotencyKey: true, requiresExecutionReceipt: true, companyBoundary: "company_id", identityGrantsAuthority: false, bindingGrantsAuthority: false, workerCanDelegate: false } });
}

test("hierarchy delegation carries full ancestry and stays non-authoritative", () => {
  const w = worker();
  const task = createTitanWorkforceWorkerTask(w, { companyId: "company-01", taskId: "task-1", objective: "Assign cleaner", expectedOutcome: "Assignment ready", approvalGranted: true, idempotencyKey: "task-1-key" });
  const envelope = createTitanWorkforceHierarchyDelegationEnvelope({ companyId: "company-01", delegationId: "del-1", agentBinding: binding(), worker: w, task, originatingAuthorityCeiling: "WRITE_INTERNAL", requestedAuthorityCeiling: "PROPOSE", idempotencyKey: "del-1-key", correlationId: "corr-1" });
  assert.equal(envelope.managerId, "manager-01");
  assert.equal(envelope.supervisorId, "supervisor-ops");
  assert.equal(envelope.workerId, "worker.assign");
  assert.equal(envelope.authorityCeiling, "PROPOSE");
  assert.equal(envelope.authority.delegationConfersAuthority, false);
  assert.deepEqual(validateTitanWorkforceHierarchyDelegationEnvelope(envelope), { ok: true, errors: [] });
});

test("delegation authority ceiling can contract but never expand", () => {
  assert.equal(contractTitanWorkforceDelegationAuthority("FINANCIAL", "WRITE_INTERNAL"), "WRITE_INTERNAL");
  assert.throws(() => contractTitanWorkforceDelegationAuthority("PROPOSE", "FINANCIAL"), /authority-expansion-rejected/);
});

test("delegation bridge is compatible with delegation-task-envelope v1 shape", () => {
  const envelope = createTitanWorkforceHierarchyDelegationEnvelope({ companyId: "company-01", delegationId: "del-2", agentBinding: binding(), originatingAuthorityCeiling: "PROPOSE", idempotencyKey: "del-2-key", correlationId: "corr-2", objective: "Prepare dispatch proposal", operation: "dispatch.propose" });
  const generic = toTitanDelegationTaskEnvelopeInput(envelope);
  assert.equal(generic.company_id, "company-01");
  assert.equal(generic.authority_ceiling, "PROPOSE");
  assert.equal(generic.inputs.hierarchy.agent_key, "dispatch");
  assert.deepEqual(generic.expected_outcome.evidence_required, ["authority_decision", "capability_resolution", "execution_receipt"]);
});

test("hierarchy delegation rejects cross-company worker ancestry", () => {
  const w = { ...worker(), companyId: "company-02" };
  assert.throws(() => createTitanWorkforceHierarchyDelegationEnvelope({ companyId: "company-01", delegationId: "del-3", agentBinding: binding(), worker: w, originatingAuthorityCeiling: "PROPOSE", idempotencyKey: "del-3-key", correlationId: "corr-3", objective: "Test" }), /cross-company-worker/);
});
