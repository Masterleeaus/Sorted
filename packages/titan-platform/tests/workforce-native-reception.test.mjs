import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTitanReceptionHandoffEvent,
  buildTitanReceptionHandoffDispatchCommand,
  buildTitanReceptionPlan,
  recoverTitanReceptionHandoff,
} from "../.test-dist/workforce-native/index.js";

test("Reception customer search plans the canonical clients route without execution authority", () => {
  const plan = buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "search_customer", query: "  Ada  " });
  assert.equal(plan.operation?.id, "clients.list");
  assert.equal(plan.operation?.path, "/api/v1/clients");
  assert.deepEqual(plan.query, { q: "Ada" });
  assert.equal(plan.authority.identity_grants_authority, false);
  assert.equal(plan.authority.execution_permitted, false);
  assert.equal(plan.authority.native_route_authoritative, true);
  assert.equal(plan.browser_extension_required, false);
});

test("Reception customer and service-request capture reuse Business Ops APIs", () => {
  const customer = buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "capture_customer", payload: { name: "Ada Lovelace", email: "ada@example.com" } });
  const request = buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "capture_service_request", payload: { name: "Ada Lovelace", phone: "0400000000", service_description: "Window cleaning" } });
  assert.equal(customer.operation?.path, "/api/v1/clients");
  assert.equal(request.operation?.path, "/api/v1/booking-requests");
  assert.equal(customer.operation?.mutating, true);
  assert.equal(request.operation?.mutating, true);
});

test("Reception capture fails closed when required intake context is absent", () => {
  assert.throws(() => buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "capture_customer", payload: {} }), /reception-customer-name-required/);
  assert.throws(() => buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "capture_service_request", payload: { name: "Ada" } }), /reception-request-contact-required/);
  assert.throws(() => buildTitanReceptionPlan({ companyId: "", actorId: "user-1", action: "search_customer" }), /company_id-required/);
});

test("Reception rejects legacy tenant boundary aliases", () => {
  assert.throws(
    () => buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "capture_customer", payload: { name: "Ada", tenant_id: "legacy" } }),
    /legacy-company-boundary/,
  );
});

test("Reception handoff creates deterministic pending state with no authority grant", () => {
  const plan = buildTitanReceptionPlan({
    companyId: "company-1",
    actorId: "user-1",
    action: "handoff",
    interactionId: "interaction-1",
    target: "booking",
    payload: { summary: "Needs booking", contact: { phone: "0400000000" } },
  });
  assert.equal(plan.operation, null);
  assert.equal(plan.handoff.company_id, "company-1");
  assert.equal(plan.handoff.target_worker, "booking");
  assert.equal(plan.handoff.grants_authority, false);
  assert.equal(plan.pendingHandoff.status, "pending");
  assert.equal(plan.pendingHandoff.execution_permitted, false);
});

test("Reception handoff state requires authoritative dispatch receipt before acknowledgement", () => {
  const plan = buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "handoff", interactionId: "interaction-2", target: "sales" });
  const submitted = applyTitanReceptionHandoffEvent(plan.pendingHandoff, { company_id: "company-1", handoff_id: plan.handoff.handoff_id, event_id: "evt-1", type: "dispatch_submitted" });
  assert.equal(submitted.status, "dispatching");
  assert.equal(submitted.automatic_replay_allowed, false);
  assert.throws(() => applyTitanReceptionHandoffEvent(submitted, { company_id: "company-1", event_id: "evt-2", type: "target_ack" }), /accepted-dispatch-receipt/);

  const accepted = applyTitanReceptionHandoffEvent(submitted, { company_id: "company-1", event_id: "evt-2", type: "dispatch_receipt", status: "accepted", receipt_ref: "receipt-1" });
  const acknowledged = applyTitanReceptionHandoffEvent(accepted, { company_id: "company-1", event_id: "evt-3", type: "target_ack", ack_ref: "ack-1" });
  assert.equal(acknowledged.status, "acknowledged");
  assert.equal(acknowledged.execution_permitted, false);
});

test("Reception recovery blocks unsafe replay after unknown or accepted dispatch", () => {
  const plan = buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "handoff", interactionId: "interaction-3", target: "customer_care" });
  const submitted = applyTitanReceptionHandoffEvent(plan.pendingHandoff, { company_id: "company-1", event_id: "evt-1", type: "dispatch_submitted" });
  const unknown = applyTitanReceptionHandoffEvent(submitted, { company_id: "company-1", event_id: "evt-2", type: "dispatch_unknown" });
  const recovery = recoverTitanReceptionHandoff(unknown);
  assert.equal(recovery.authority_granted, false);
  assert.equal(recovery.execution_permitted, false);
  assert.match(recovery.action, /reconcile|hold|review/i);
});

test("Reception dispatch command remains authority-neutral and tied to the handoff dedupe key", () => {
  const plan = buildTitanReceptionPlan({ companyId: "company-1", actorId: "user-1", action: "handoff", interactionId: "interaction-4", target: "booking" });
  const command = buildTitanReceptionHandoffDispatchCommand(plan.pendingHandoff);
  assert.equal(command.company_id, "company-1");
  assert.equal(command.grants_authority, false);
  assert.equal(command.execution_permitted, false);
  assert.equal(command.idempotency_key, plan.handoff.dedupe_key);
});
