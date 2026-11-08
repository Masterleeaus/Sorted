import test from "node:test";
import assert from "node:assert/strict";

import {
  getTitanBusinessOpsAgentCommand,
  assessTitanBusinessOpsAgentCommand,
} from "../.test-dist/business-ops.js";

test("Commerce and financial context reuse canonical invoice, expense and material seams", () => {
  assert.equal(getTitanBusinessOpsAgentCommand("invoices.list")?.path, "/api/v1/invoices");
  assert.equal(getTitanBusinessOpsAgentCommand("invoices.send")?.path, "/api/v1/invoices/:id/send");
  assert.equal(getTitanBusinessOpsAgentCommand("expenses.list")?.path, "/api/v1/expenses");
  assert.equal(getTitanBusinessOpsAgentCommand("materials.list")?.path, "/api/v1/materials");
});

test("Financial context is read-only unless an existing governed invoice command is explicitly invoked", () => {
  assert.equal(getTitanBusinessOpsAgentCommand("expenses.list")?.mutating, false);
  assert.equal(getTitanBusinessOpsAgentCommand("materials.list")?.mutating, false);
  assert.equal(getTitanBusinessOpsAgentCommand("invoices.send")?.mutating, true);
});

test("Financial/commerce operations remain company-scoped risk inputs", () => {
  for (const id of ["invoices.list", "expenses.list", "materials.list", "invoices.send"]) {
    const risk = assessTitanBusinessOpsAgentCommand({ companyId: "company-a", commandId: id });
    assert.equal(risk.company_id, "company-a");
  }
});
