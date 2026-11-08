import assert from "node:assert/strict";
import test from "node:test";

import { createTitanWorkforceSupervisorRuntime, upsertTitanWorkforceSupervisorDomain } from "../.test-dist/workforce-hierarchy/supervisor-runtime.js";
import { bindTitanWorkforceAgentToSupervisor, planTitanWorkforceAgentInvocation, summarizeTitanWorkforceAgentBindings } from "../.test-dist/workforce-hierarchy/agent-binding.js";

const domain = {
  schema: "titan.workforce.supervisor-domain.v1",
  companyId: "company-01",
  domainId: "domain-operations",
  title: "Operations",
  supervisorId: "supervisor-ops",
  agentIds: ["dispatch", "jobs", "scheduling"],
  objectiveIds: [],
  state: "active",
  domainOwnershipConfersExecutionAuthority: false,
};

function supervisor() {
  return upsertTitanWorkforceSupervisorDomain(
    createTitanWorkforceSupervisorRuntime({ companyId: "company-01", supervisorId: "supervisor-ops", managerId: "manager-01" }),
    domain,
  );
}

const dispatch = {
  agentKey: "dispatch",
  name: "Dispatch Agent",
  roleDefinitionId: "titan.work.dispatcher",
  operationalDomains: ["dispatch", "operations"],
  enabled: true,
  executionModel: "proposal_or_governed_handoff",
  companyBoundary: "company_id",
  identityGrantsAuthority: false,
};

test("standalone agent binding records hierarchy ownership without authority expansion", () => {
  const binding = bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor: supervisor(), domainId: "domain-operations", agent: dispatch });
  assert.equal(binding.managerId, "manager-01");
  assert.equal(binding.supervisorId, "supervisor-ops");
  assert.equal(binding.agentKey, "dispatch");
  assert.equal(binding.directInvocationAllowed, true);
  assert.equal(binding.ownershipConfersExecutionAuthority, false);
  assert.equal(binding.directInvocationConfersExecutionAuthority, false);
});

test("direct invocation is preserved only as a governed plan", () => {
  const binding = bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor: supervisor(), domainId: "domain-operations", agent: dispatch });
  const direct = planTitanWorkforceAgentInvocation(binding, { companyId: "company-01", mode: "direct" });
  assert.equal(direct.invocationMode, "direct");
  assert.equal(direct.executionPermitted, false);
  assert.equal(direct.requiresAuthorityEvaluation, true);
  assert.equal(direct.requiresCapabilityResolution, true);
  assert.equal(direct.businessOpsRouteRemainsAuthoritative, true);
});

test("binding rejects cross-company, disabled, and unrelated agents", () => {
  assert.throws(() => bindTitanWorkforceAgentToSupervisor({ companyId: "company-02", supervisor: supervisor(), domainId: "domain-operations", agent: dispatch }), /cross-company/);
  assert.throws(() => bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor: supervisor(), domainId: "domain-operations", agent: { ...dispatch, enabled: false } }), /disabled/);
  assert.throws(() => bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor: supervisor(), domainId: "domain-operations", agent: { ...dispatch, agentKey: "invoicing", roleDefinitionId: "titan.money.billing_coordinator", operationalDomains: ["finance", "invoicing"] } }), /domain-mismatch/);
});

test("binding summaries stay non-authoritative", () => {
  const binding = bindTitanWorkforceAgentToSupervisor({ companyId: "company-01", supervisor: supervisor(), domainId: "domain-operations", agent: dispatch });
  const summary = summarizeTitanWorkforceAgentBindings([binding]);
  assert.equal(summary.bindingCount, 1);
  assert.equal(summary.directInvocationPreserved, true);
  assert.equal(summary.grantsAuthority, false);
});
