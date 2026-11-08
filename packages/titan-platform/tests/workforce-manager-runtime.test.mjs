import assert from "node:assert/strict";
import test from "node:test";

import {
  createTitanWorkforceManagerRuntime,
  evaluateTitanWorkforceManagerPolicy,
  summarizeTitanWorkforceManagerRuntime,
  upsertTitanWorkforceManagerObjective,
} from "../.test-dist/workforce-hierarchy/manager-runtime.js";

const objective = {
  schema: "titan.workforce.manager-objective.v1",
  companyId: "company-01",
  objectiveId: "objective-growth-01",
  title: "Increase retained cleaning customers",
  outcome: "Improve repeat-booking conversion without bypassing customer consent or scheduling authority.",
  state: "active",
  priority: "high",
  ownerManagerId: "manager-01",
  supervisorIds: ["supervisor-care", "supervisor-sales"],
  sourceRef: "business-plan:q4",
  createdAt: "2026-09-13T03:00:00+10:00",
  updatedAt: "2026-09-13T03:00:00+10:00",
  objectiveOwnershipConfersExecutionAuthority: false,
};

test("manager runtime owns objectives without gaining execution authority", () => {
  let runtime = createTitanWorkforceManagerRuntime({
    companyId: "company-01",
    managerId: "manager-01",
    displayName: "Workforce Manager",
    policies: [
      { policyId: "allow-read", kind: "allow", scope: "business.read.*" },
      { policyId: "approve-write", kind: "require_approval", scope: "business.write.*", reason: "Business mutations require governed authority." },
      { policyId: "deny-delete", kind: "deny", scope: "business.write.delete", reason: "Destructive delete is outside this manager policy." },
    ],
  });

  runtime = upsertTitanWorkforceManagerObjective(runtime, objective);
  assert.equal(runtime.objectives.length, 1);
  assert.equal(runtime.objectives[0].objectiveOwnershipConfersExecutionAuthority, false);
  assert.equal(runtime.scope.directToolExecution, false);
  assert.equal(runtime.authority.identityConfersAuthority, false);

  const read = evaluateTitanWorkforceManagerPolicy(runtime, "business.read.jobs");
  assert.equal(read.decision, "allow_proposal");
  assert.equal(read.executionPermitted, false);
  assert.equal(read.requiresAuthorityEvaluation, true);
  assert.equal(read.requiresCapabilityResolution, true);

  const write = evaluateTitanWorkforceManagerPolicy(runtime, "business.write.job");
  assert.equal(write.decision, "require_approval");
  assert.equal(write.executionPermitted, false);

  const destructive = evaluateTitanWorkforceManagerPolicy(runtime, "business.write.delete");
  assert.equal(destructive.decision, "deny");
  assert.equal(destructive.executionPermitted, false);

  const summary = summarizeTitanWorkforceManagerRuntime(runtime);
  assert.equal(summary.activeObjectiveCount, 1);
  assert.equal(summary.directToolExecution, false);
  assert.equal(summary.grantsAuthority, false);
});

test("manager runtime rejects cross-company objective ownership", () => {
  const runtime = createTitanWorkforceManagerRuntime({ companyId: "company-01", managerId: "manager-01" });
  assert.throws(
    () => upsertTitanWorkforceManagerObjective(runtime, { ...objective, companyId: "company-02" }),
    /cross-company-rejected/,
  );
});

test("policy precedence is deny > approval > limit > proposal and unmatched actions fail closed", () => {
  const runtime = createTitanWorkforceManagerRuntime({
    companyId: "company-01",
    managerId: "manager-01",
    policies: [
      { policyId: "allow-all", kind: "allow", scope: "*" },
      { policyId: "limit-comms", kind: "limit", scope: "communications.*", value: 20 },
      { policyId: "approval-send", kind: "require_approval", scope: "communications.send" },
      { policyId: "deny-bulk", kind: "deny", scope: "communications.send.bulk" },
    ],
  });

  assert.equal(evaluateTitanWorkforceManagerPolicy(runtime, "communications.preview").decision, "limit");
  assert.equal(evaluateTitanWorkforceManagerPolicy(runtime, "communications.send").decision, "require_approval");
  assert.equal(evaluateTitanWorkforceManagerPolicy(runtime, "communications.send.bulk").decision, "deny");

  const failClosed = createTitanWorkforceManagerRuntime({ companyId: "company-01", managerId: "manager-01" });
  assert.equal(evaluateTitanWorkforceManagerPolicy(failClosed, "business.write.job").decision, "require_approval");
});
