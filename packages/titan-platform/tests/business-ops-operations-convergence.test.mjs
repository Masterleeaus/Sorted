import test from "node:test";
import assert from "node:assert/strict";

import {
  TITAN_BUSINESS_OPS_AGENT_COMMANDS,
  getTitanBusinessOpsAgentCommand,
  assessTitanBusinessOpsAgentCommand,
} from "../.test-dist/business-ops.js";

test("every declared Business Ops command id resolves to exactly one registered command", () => {
  const ids = TITAN_BUSINESS_OPS_AGENT_COMMANDS.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(getTitanBusinessOpsAgentCommand(id)?.id, id);
  assert.equal(getTitanBusinessOpsAgentCommand("people.list")?.path, "/api/v1/users");
});

test("all registered operations remain company-scoped at the Titan risk boundary", () => {
  for (const command of TITAN_BUSINESS_OPS_AGENT_COMMANDS) {
    const risk = assessTitanBusinessOpsAgentCommand({
      companyId: "company-a",
      commandId: command.id,
      entityId: command.path.includes(":id") ? "entity-1" : undefined,
    });
    assert.equal(risk.company_id, "company-a", command.id);
  }
});

test("only verified canonical operations are exposed", () => {
  for (const id of [
    "ledger.post",
    "payroll.run",
    "messages.send",
    "campaigns.send",
    "reach.execute",
    "people.create",
  ]) {
    assert.equal(getTitanBusinessOpsAgentCommand(id), null);
  }
});
