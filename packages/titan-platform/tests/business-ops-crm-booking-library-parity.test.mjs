import test from "node:test";
import assert from "node:assert/strict";

import {
  getTitanBusinessOpsAgentCommand,
  assessTitanBusinessOpsAgentCommand,
} from "../.test-dist/business-ops.js";

test("CRM and booking donors converge onto canonical host routes", () => {
  assert.equal(getTitanBusinessOpsAgentCommand("clients.list")?.path, "/api/v1/clients");
  assert.equal(getTitanBusinessOpsAgentCommand("properties.create")?.path, "/api/v1/properties");
  assert.equal(getTitanBusinessOpsAgentCommand("booking_requests.create")?.path, "/api/v1/booking-requests");
  assert.equal(getTitanBusinessOpsAgentCommand("estimates.create")?.path, "/api/v1/estimates");
});

test("CRM and booking writes remain mutating governed operations", () => {
  for (const id of ["clients.create", "properties.create", "booking_requests.create", "estimates.create"]) {
    const command = getTitanBusinessOpsAgentCommand(id);
    assert.equal(command?.mutating, true);
    assert.deepEqual(command?.allowedRoles, ["owner", "admin"]);
  }
});

test("Titan risk assessment binds CRM and booking operations to company_id", () => {
  const crm = assessTitanBusinessOpsAgentCommand({ companyId: "company-a", commandId: "clients.create" });
  const booking = assessTitanBusinessOpsAgentCommand({ companyId: "company-a", commandId: "booking_requests.create" });
  assert.equal(crm.company_id, "company-a");
  assert.equal(booking.company_id, "company-a");
});
