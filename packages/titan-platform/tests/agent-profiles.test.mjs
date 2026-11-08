import assert from "node:assert/strict";
import test from "node:test";

const businessOps = await import("../.test-dist/business-ops.js");

test("agent profiles expose focused command sets", () => {
  const dispatch = businessOps.getTitanBusinessOpsAgentProfile("dispatch");
  const invoicing = businessOps.getTitanBusinessOpsAgentProfile("invoicing");
  const crm = businessOps.getTitanBusinessOpsAgentProfile("crm");
  const rebooking = businessOps.getTitanBusinessOpsAgentProfile("rebooking");
  assert.ok(dispatch);
  assert.ok(invoicing);
  assert.ok(crm);
  assert.ok(rebooking);
  assert.ok(dispatch.commandIds.includes("visits.on_my_way"));
  assert.ok(!dispatch.commandIds.includes("invoices.send"));
  assert.ok(invoicing.commandIds.includes("invoices.send"));
  assert.ok(!invoicing.commandIds.includes("visits.on_my_way"));
  assert.ok(crm.commandIds.includes("clients.list"));
  assert.ok(rebooking.commandIds.includes("booking_requests.create"));
});

test("profile authorization fails closed", () => {
  assert.equal(businessOps.assertTitanBusinessOpsAgentCommandAllowed("dispatch", "visits.transition").agentKey, "dispatch");
  assert.throws(
    () => businessOps.assertTitanBusinessOpsAgentCommandAllowed("dispatch", "invoices.send"),
    /AGENT_COMMAND_NOT_AUTHORIZED/,
  );
  assert.throws(
    () => businessOps.assertTitanBusinessOpsAgentCommandAllowed("missing", "projects.list"),
    /UNKNOWN_AGENT_PROFILE/,
  );
});

test("CRM and booking commands target native standalone APIs", () => {
  assert.equal(businessOps.getTitanBusinessOpsAgentCommand("clients.list")?.path, "/api/v1/clients");
  assert.equal(businessOps.getTitanBusinessOpsAgentCommand("booking_requests.create")?.path, "/api/v1/booking-requests");
});
