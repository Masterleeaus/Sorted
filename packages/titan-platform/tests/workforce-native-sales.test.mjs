import test from "node:test";
import assert from "node:assert/strict";
import { buildTitanSalesPlan } from "../.test-dist/workforce-native/index.js";

const qualifiedLead = {
  lead_id: "lead-1",
  crm_lead: { lead_id: "lead-1", customer_id: "customer-1", contactability: "contactable", service_interest: "cleaning", postcode: "3071" },
  observation: { service_needed: "cleaning", postcode: "3071", preferred_date: "2026-09-20", contactability: "contactable" },
  policy: { supported_services: ["cleaning"], territory_postcodes: ["3071"] },
  observed_intent: { quote: true, source: "interaction", evidence: "Customer requested a quote" },
};

test("Sales qualification reuses deterministic donor logic and remains authority-neutral", () => {
  const plan = buildTitanSalesPlan({ companyId: "company-1", actorId: "user-1", action: "next_best_action", qualification: qualifiedLead });
  assert.equal(plan.operation, null);
  assert.equal(plan.qualification.company_id, "company-1");
  assert.equal(plan.priority.company_id, "company-1");
  assert.equal(plan.recommendation.company_id, "company-1");
  assert.equal(plan.authority.identity_grants_authority, false);
  assert.equal(plan.authority.execution_permitted, false);
  assert.equal(plan.browser_extension_required, false);
});

test("Sales lead progression uses canonical booking request PATCH surface", () => {
  const plan = buildTitanSalesPlan({ companyId: "company-1", actorId: "user-1", action: "progress_lead", requestId: "request-1", payload: { status: "needs_info", review_notes: "Need access details" } });
  assert.equal(plan.operation?.id, "booking_requests.update");
  assert.equal(plan.operation?.path, "/api/v1/booking-requests/:id");
  assert.equal(plan.entity_id, "request-1");
  assert.equal(plan.operation?.mutating, true);
});

test("Sales progression rejects fields outside Business Ops booking request contract", () => {
  assert.throws(
    () => buildTitanSalesPlan({ companyId: "company-1", actorId: "user-1", action: "progress_lead", requestId: "request-1", payload: { discount: 99 } }),
    /sales-progress-field-not-allowed/,
  );
});

test("Sales quote handoff is deterministic, duplicate-checked and proposal-only", () => {
  const plan = buildTitanSalesPlan({
    companyId: "company-1", actorId: "user-1", action: "prepare_quote_handoff",
    handoff: {
      lead_id: "lead-1", customer_id: "customer-1", correlation_id: "corr-1",
      customer_context: { customer_id: "customer-1" }, service_context: { service: "cleaning" },
      duplicate_check: { checked: true, source_ref: "booking-request:request-1" },
      evidence: [{ kind: "qualification", summary: "Lead qualified", source_ref: "booking-request:request-1", confidence: 1 }],
      reasons: ["Customer requested quote"],
    },
  });
  assert.equal(plan.operation, null);
  assert.equal(plan.handoff.target, "quote");
  assert.equal(plan.handoff.restrictions.quote_creation_performed, false);
  assert.equal(plan.handoff.execution_authority, false);
});

test("Sales quote creation only targets canonical estimate API", () => {
  const plan = buildTitanSalesPlan({ companyId: "company-1", actorId: "user-1", action: "create_quote", payload: { client_id: "client-1", line_items: [] } });
  assert.equal(plan.operation?.path, "/api/v1/estimates");
  assert.equal(plan.operation?.id, "estimates.create");
  assert.equal(plan.authority.pricing_authority_assumed, false);
});

test("Sales governed escalation records human review on canonical intake record", () => {
  const plan = buildTitanSalesPlan({ companyId: "company-1", actorId: "user-1", action: "escalate", requestId: "request-1", payload: { reason: "Territory exception requires review" } });
  assert.equal(plan.operation?.id, "booking_requests.update");
  assert.deepEqual(plan.body, { status: "reviewed", routing_path: "pending", review_notes: "Territory exception requires review" });
  assert.equal(plan.escalation.required, true);
  assert.equal(plan.escalation.human_review, true);
});

test("Sales rejects legacy tenant aliases and malformed request ids", () => {
  assert.throws(() => buildTitanSalesPlan({ companyId: "company-1", actorId: "user-1", action: "progress_lead", requestId: "../bad", payload: { status: "reviewed" } }), /sales-request-id-required/);
  assert.throws(() => buildTitanSalesPlan({ companyId: "company-1", actorId: "user-1", action: "qualify_lead", qualification: { lead_id: "lead-1", tenant_id: "legacy" } }), /legacy-company-boundary/);
});
