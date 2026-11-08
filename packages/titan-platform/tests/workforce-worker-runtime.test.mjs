import assert from "node:assert/strict";
import test from "node:test";

import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from "../.test-dist/workforce-hierarchy/supervisor-runtime.js";
import { bindTitanWorkforceAgentToSupervisor } from "../.test-dist/workforce-hierarchy/agent-binding.js";
import { createTitanWorkforceWorkerRuntime, createTitanWorkforceWorkerTask, planTitanWorkforceWorkerExecution, summarizeTitanWorkforceWorkers } from "../.test-dist/workforce-hierarchy/worker-runtime.js";

const domain = {
  schema: "titan.workforce.supervisor-domain.v1",
  companyId: "company-01",
  domainId: "domain-operations",
  title: "Operations",
  supervisorId: "supervisor-ops",
  agentIds: ["dispatch"],
  objectiveIds: [],
  state: "active",
  domainOwnershipConfersExecutionAuthority: false,
};

function agentBinding() {
  const supervisor = upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: "company-01", supervisorId: "supervisor-ops", managerId: "manager-01" }),
    domain,
  );
  return bindTitanWorkforceAgentToSupervisor({
    companyId: "company-01",
    supervisor,
    domainId: "domain-operations",
    agent: {
      agentKey: "dispatch",
      roleDefinitionId: "titan.work.dispatcher",
      operationalDomains: ["dispatch", "operations"],
      enabled: true,
      executionModel: "proposal_or_governed_handoff",
      companyBoundary: "company_id",
      identityGrantsAuthority: false,
    },
  });
}

const protectedWorker = {
  workerId: "titan.worker.assign_cleaner_agent",
  workerName: "Assign Cleaner Agent",
  atomicAction: "Assign Cleaner",
  toolIds: ["custom_tools"],
  authorityClass: "PROTECTED_EXECUTION",
  requiresApproval: true,
  requiresIdempotencyKey: true,
  requiresExecutionReceipt: true,
  companyBoundary: "company_id",
  identityGrantsAuthority: false,
  bindingGrantsAuthority: false,
  workerCanDelegate: false,
};

test("worker binds beneath agent with least-authority invariants", () => {
  const worker = createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding: agentBinding(), worker: protectedWorker });
  assert.equal(worker.agentKey, "dispatch");
  assert.equal(worker.mayDelegate, false);
  assert.equal(worker.identityConfersExecutionAuthority, false);
  assert.equal(worker.bindingConfersExecutionAuthority, false);
  assert.equal(worker.leastAuthorityToolAccess, true);
});

test("bounded worker task cannot expand tool access", () => {
  const worker = createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding: agentBinding(), worker: protectedWorker });
  assert.throws(() => createTitanWorkforceWorkerTask(worker, {
    companyId: "company-01",
    taskId: "task-01",
    objective: "Assign the correct cleaner",
    expectedOutcome: "Assignment proposal ready",
    allowedToolIds: ["custom_tools", "sheets"],
  }), /tool-authority-expansion/);
});

test("protected worker task remains blocked without approval and idempotency", () => {
  const worker = createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding: agentBinding(), worker: protectedWorker });
  const task = createTitanWorkforceWorkerTask(worker, {
    companyId: "company-01",
    taskId: "task-02",
    objective: "Assign cleaner",
    expectedOutcome: "Cleaner assigned",
  });
  assert.equal(task.state, "blocked");
  const plan = planTitanWorkforceWorkerExecution(worker, task);
  assert.deepEqual(plan.blockedReasons, ["APPROVAL_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED"]);
  assert.equal(plan.executionPermitted, false);
});

test("approved protected task reaches authority gate but still cannot self-execute", () => {
  const worker = createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding: agentBinding(), worker: protectedWorker });
  const task = createTitanWorkforceWorkerTask(worker, {
    companyId: "company-01",
    taskId: "task-03",
    objective: "Assign cleaner",
    expectedOutcome: "Cleaner assigned",
    approvalGranted: true,
    idempotencyKey: "assign-001",
  });
  const plan = planTitanWorkforceWorkerExecution(worker, task);
  assert.equal(task.state, "ready_for_authority_gate");
  assert.equal(plan.state, "READY_FOR_AUTHORITY_GATE");
  assert.equal(plan.executionPermitted, false);
  assert.equal(plan.requiresAuthorityEvaluation, true);
  assert.equal(plan.requiresCapabilityResolution, true);
  assert.equal(plan.requiresExecutionReceipt, true);
});

test("worker hierarchy rejects cross-company construction and stays non-authoritative in summaries", () => {
  assert.throws(() => createTitanWorkforceWorkerRuntime({ companyId: "company-02", agentBinding: agentBinding(), worker: protectedWorker }), /cross-company/);
  const worker = createTitanWorkforceWorkerRuntime({ companyId: "company-01", agentBinding: agentBinding(), worker: protectedWorker });
  const summary = summarizeTitanWorkforceWorkers([worker]);
  assert.equal(summary.workerCount, 1);
  assert.equal(summary.anyCanDelegate, false);
  assert.equal(summary.grantsAuthority, false);
});
