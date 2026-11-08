import test from "node:test";
import assert from "node:assert/strict";

import {
  getTitanBusinessOpsAgentCommand,
  assessTitanBusinessOpsAgentCommand,
} from "../.test-dist/business-ops.js";

test("People convergence reuses canonical human workforce identities", () => {
  const people = getTitanBusinessOpsAgentCommand("people.list");
  assert.equal(people?.path, "/api/v1/users");
  assert.equal(people?.mutating, false);
  assert.deepEqual(people?.allowedRoles, ["owner", "admin"]);
});

test("People context remains company-scoped and does not confer execution authority", () => {
  const risk = assessTitanBusinessOpsAgentCommand({ companyId: "company-a", commandId: "people.list" });
  assert.equal(risk.company_id, "company-a");
  assert.equal(getTitanBusinessOpsAgentCommand("people.create"), null);
});

test("Reach/omnichannel donor semantics are not exposed as ungoverned outbound commands", () => {
  for (const id of ["messages.send", "campaigns.send", "reach.execute", "communications.send"]) {
    assert.equal(getTitanBusinessOpsAgentCommand(id), null);
  }
  assert.equal(getTitanBusinessOpsAgentCommand("invoices.send")?.mutating, true);
});
