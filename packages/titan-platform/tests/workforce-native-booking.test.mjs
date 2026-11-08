import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTitanBookingPlan,
  lookupTitanBookingAvailability,
  reconcileTitanBookingCalendarEvent,
} from "../.test-dist/workforce-native/index.js";

const fixedSource = {
  customer_id: "client-1",
  service_id: "service-1",
  site_id: "property-1",
  correlation_id: "corr-1",
  service: { company_id: "company-1", fixed_price: true, price: 125, currency: "AUD" },
};

test("Booking list/get/property plans use canonical Business Ops APIs", () => {
  const list = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "list_requests", status: "reviewed", limit: 25 });
  const get = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "get_request", requestId: "request-1" });
  const properties = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "list_properties", clientId: "client-1" });
  assert.equal(list.operation?.id, "booking_requests.list");
  assert.deepEqual(list.query, { status: "reviewed", limit: "25" });
  assert.equal(get.operation?.path, "/api/v1/booking-requests/:id");
  assert.equal(properties.operation?.path, "/api/v1/properties");
  assert.equal(properties.query.client_id, "client-1");
});

test("Booking source and intent reuse deterministic donor lifecycle with company boundary", () => {
  const plan = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "prepare_booking", requestId: "request-1", source: fixedSource, traceId: "trace-1" });
  assert.equal(plan.booking_source.schema, "titan.booking.source.v1");
  assert.equal(plan.booking_source.company_id, "company-1");
  assert.equal(plan.booking_intent.schema, "titan.booking.intent.v1");
  assert.equal(plan.booking_intent.state, "qualified");
  assert.equal(plan.booking_intent.grants_authority, false);
  assert.equal(plan.authority.execution_permitted, false);
});

test("Booking availability is provider-backed, fresh, and never synthetic", async () => {
  const plan = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "check_availability", payload: { provider: "calendar", service_id: "service-1", site_id: "property-1", correlation_id: "corr-1", timezone: "Australia/Melbourne" } });
  assert.equal(plan.operation, null);
  assert.equal(plan.authority.availability_authority_assumed, false);
  const result = await lookupTitanBookingAvailability(plan.availability_request, {
    fetchAvailability: async () => ({ ok: true, observed_at: "2026-09-13T00:00:00Z", timezone: "Australia/Melbourne", slots: [{ id: "slot-1", revision: "r1", start: "2026-09-20T00:00:00Z", end: "2026-09-20T02:00:00Z", bookable: true }] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.slots[0].synthetic, false);
  assert.equal(result.slots[0].company_id, "company-1");
});

test("Booking confirmation plan does not self-authorize execution", () => {
  const plan = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "prepare_confirmation", requestId: "request-1", payload: { correlation_id: "corr-1" }, traceId: "trace-1" });
  assert.equal(plan.operation, null);
  assert.equal(plan.confirmation_plan.schema, "titan.booking.execution-plan.v1");
  assert.equal(plan.confirmation_plan.direct_mutation, false);
  assert.equal(plan.confirmation_plan.grants_authority, false);
  assert.equal(plan.confirmation_plan.steps.find((step) => step.id === "confirm_booking").requires_authority_decision, true);
});

test("Booking confirmation executes only through canonical conversion workflow", () => {
  const plan = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "confirm_request", requestId: "request-1", payload: { preferred_date: "2026-09-20", preferred_time_slot: "morning", review_notes: "Customer confirmed" } });
  assert.equal(plan.operation?.id, "booking_requests.convert");
  assert.equal(plan.operation?.path, "/api/v1/booking-requests/:id/convert");
  assert.equal(plan.entity_id, "request-1");
  assert.equal(plan.authority.scheduling_authority_assumed, false);
});

test("Booking confirmation rejects unsupported mutation fields", () => {
  assert.throws(() => buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "confirm_request", requestId: "request-1", payload: { preferred_date: "2026-09-20", price: 1 } }), /booking-confirm-field-not-allowed/);
  assert.throws(() => buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "get_request", requestId: "../bad" }), /booking-request-id-required/);
});

test("Booking rejects legacy tenant aliases", () => {
  assert.throws(() => buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "prepare_booking", requestId: "request-1", source: { ...fixedSource, tenant_id: "legacy" } }), /legacy-company-boundary/);
});

test("Calendar reconciliation remains company-scoped and proposal-only", async () => {
  const result = await reconcileTitanBookingCalendarEvent({ company_id: "company-1", event_id: "event-1", provider: "calendar", provider_booking_id: "booking-1", provider_revision: "r2", kind: "rescheduled", starts_at: "2026-09-20T01:00:00Z", ends_at: "2026-09-20T03:00:00Z", correlation_id: "corr-1" }, {
    findBookingByProviderRef: async () => ({ company_id: "company-1", id: "local-1", provider_revision: "r1", state: "confirmed" }),
    recordReconciliation: async () => undefined,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reconciliation.grants_authority, false);
  assert.equal(result.reconciliation.direct_mutation, false);
  assert.equal(result.reconciliation.scheduling_review_required, true);
});

test("Booking handoffs preserve existing scheduling/jobs seams without authority transfer", () => {
  const scheduling = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "handoff_scheduling", handoff: { booking_id: "booking-1", correlation_id: "corr-1", booking_state: "confirmed" } });
  assert.equal(scheduling.handoff.to_worker, "scheduling");
  assert.equal(scheduling.handoff.grants_authority, false);
  const jobs = buildTitanBookingPlan({ companyId: "company-1", actorId: "user-1", action: "handoff_jobs", handoff: { booking_id: "booking-1", correlation_id: "corr-1", booking_state: "confirmed" } });
  assert.equal(jobs.handoff.packet.to_worker, "jobs");
  assert.equal(jobs.handoff.packet.grants_authority, false);
});
