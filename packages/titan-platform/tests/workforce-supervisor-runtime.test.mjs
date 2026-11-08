import assert from "node:assert/strict";
import test from "node:test";

import {
  coordinateTitanWorkforceSupervisorAgents,
  createTitanWorkforceSupervisorRuntime,
  recordTitanWorkforceSupervisorEscalation,
  resolveTitanWorkforceSupervisorConflict,
  summarizeTitanWorkforceSupervisorRuntime,
  upsertTitanWorkforceSupervisorDomain,
} from "../.test-dist/workforce-hierarchy/supervisor-runtime.js";

const domain = {
  schema: "titan.workforce.supervisor-domain.v1",
  companyId: "company-01",
  domainId: "domain-field-ops",
  title: "Field Operations",
  supervisorId: "supervisor-field",
  agentIds: ["agent-dispatch", "agent-jobs", "agent-scheduling"],
  objectiveIds: ["objective-on-time-service"],
  state: "active",
  domainOwnershipConfersExecutionAuthority: false,
};

const escalation = {
  schema: "titan.workforce.supervisor-escalation.v1",
  companyId: "company-01",
  escalationId: "esc-01",
  supervisorId: "supervisor-field",
  domainId: "domain-field-ops",
  sourceAgentId: "agent-dispatch",
  targetTier: "manager",
  reason: "Dispatch capacity is exhausted and requires a business-level prioritization decision.",
  severity: "high",
  state: "open",
  createdAt: "2026-09-13T04:00:00+10:00",
  updatedAt: "2026-09-13T04:00:00+10:00",
  escalationConfersExecutionAuthority: false,
};

test("supervisor runtime owns bounded domains without gaining execution authority", () => {
  let runtime = createTitanWorkforceSupervisorRuntime({
    companyId: "company-01",
    supervisorId: "supervisor-field",
    managerId: "manager-01",
    displayName: "Field Operations Supervisor",
  });
  runtime = upsertTitanWorkforceSupervisorDomain(runtime, domain);
  runtime = recordTitanWorkforceSupervisorEscalation(runtime, escalation);

  assert.equal(runtime.domains.length, 1);
  assert.equal(runtime.scope.directToolExecution, false);
  assert.equal(runtime.authority.supervisorRoleConfersAuthority, false);
  assert.equal(runtime.domains[0].domainOwnershipConfersExecutionAuthority, false);
  assert.equal(runtime.escalations[0].escalationConfersExecutionAuthority, false);

  const coordination = coordinateTitanWorkforceSupervisorAgents(runtime, {
    domainId: "domain-field-ops",
    agentIds: ["agent-jobs", "agent-dispatch"],
  });
  assert.deepEqual(coordination.coordinatedAgentIds, ["agent-dispatch", "agent-jobs"]);
  assert.equal(coordination.executionPermitted, false);

  const summary = summarizeTitanWorkforceSupervisorRuntime(runtime);
  assert.equal(summary.domainCount, 1);
  assert.equal(summary.coordinatedAgentCount, 3);
  assert.equal(summary.openEscalationCount, 1);
  assert.equal(summary.grantsAuthority, false);
});

test("supervisor runtime rejects cross-company and out-of-domain coordination", () => {
  const runtime = upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: "company-01", supervisorId: "supervisor-field", managerId: "manager-01" }),
    domain,
  );
  assert.throws(
    () => upsertTitanWorkforceSupervisorDomain(runtime, { ...domain, companyId: "company-02" }),
    /cross-company-rejected/,
  );
  assert.throws(
    () => coordinateTitanWorkforceSupervisorAgents(runtime, { domainId: "domain-field-ops", agentIds: ["agent-finance"] }),
    /outside-domain/,
  );
});

test("conflict decisions are deterministic coordination proposals and authority conflicts escalate", () => {
  const runtime = upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: "company-01", supervisorId: "supervisor-field", managerId: "manager-01" }),
    domain,
  );

  const normal = resolveTitanWorkforceSupervisorConflict(runtime, {
    domainId: "domain-field-ops",
    conflictId: "conflict-priority-01",
    agentIds: ["agent-dispatch", "agent-scheduling"],
    kind: "priority",
    severity: "normal",
    facts: ["Two visits compete for the same window."],
  });
  assert.equal(normal.decision, "coordinate");
  assert.equal(normal.executionPermitted, false);

  const authority = resolveTitanWorkforceSupervisorConflict(runtime, {
    domainId: "domain-field-ops",
    conflictId: "conflict-authority-01",
    agentIds: ["agent-dispatch", "agent-jobs"],
    kind: "authority",
    severity: "high",
  });
  assert.equal(authority.decision, "hold_for_manager");
  assert.equal(authority.executionPermitted, false);
  assert.equal(authority.requiresAuthorityEvaluation, true);
});
