import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeDispatchProposal,
  buildNativeInvoiceDraft,
  planNativeCrm,
  planNativeEstimate,
  planNativeInvoice,
  planNativeRebooking,
  scoreNativeRebookingCandidate,
} from "../.test-dist/native-agents.js";

test("dispatch donor logic ranks same-company available skilled worker", () => {
  const result = buildNativeDispatchProposal({
    company_id: "co-1",
    job: { company_id: "co-1", job_id: "job-1", required_skills: ["cleaning"], urgent: true },
    workers: [
      { company_id: "co-1", worker_id: "w2", skills: ["cleaning"], active_jobs: 2, distance_km: 10 },
      { company_id: "co-1", worker_id: "w1", skills: ["cleaning"], urgent_ready: true, site_match: true, distance_km: 3 },
      { company_id: "other", worker_id: "bad", skills: ["cleaning"] },
    ],
  });
  assert.equal(result.recommended_worker_id, "w1");
  assert.equal(result.direct_assignment, false);
});

test("invoice donor logic blocks incomplete jobs", () => {
  assert.throws(() => buildNativeInvoiceDraft({
    company_id: "co-1", job_id: "job-1", job_completed: false, completion_evidence_verified: true,
    customer_id: "c-1", lines: [{ description: "Service", unit_price_cents: 10000 }],
  }), /job-not-complete/);
});

test("invoice donor logic creates governed Business Ops create command", () => {
  const result = planNativeInvoice({
    company_id: "co-1", job_id: "job-1", job_completed: true, completion_evidence_verified: true,
    customer_id: "c-1", lines: [{ description: "Service", quantity: 2, unit_price_cents: 10000 }], tax_rate: 0.1,
  });
  assert.equal(result.draft.total_cents, 22000);
  assert.equal(result.commands[0].agentKey, "invoicing");
  assert.equal(result.commands[0].commandId, "invoices.create");
});

test("rebooking logic remains suppressed without consent", () => {
  const result = scoreNativeRebookingCandidate({ priorCompletedServices: 5, consentKnown: false, consentPermitted: false });
  assert.equal(result.recommendation, "NONE");
  assert.deepEqual(result.reasons, ["CONSENT_BLOCK"]);
});

test("rebooking logic proposes native booking request when due", () => {
  const result = planNativeRebooking({ company_id: "co-1", customer_id: "c-1", priorCompletedServices: 3, daysSinceLastService: 100, cadenceDays: 90, consentKnown: true, consentPermitted: true });
  assert.equal(result.assessment.recommendation, "REBOOK");
  assert.equal(result.commands[0].commandId, "booking_requests.create");
});

test("estimating planner uses quote authority profile", () => {
  const result = planNativeEstimate({ customer_id: "c-1", lines: [{ description: "Clean", unit_price_cents: 15000 }] });
  assert.equal(result.commands[0].agentKey, "quote");
  assert.equal(result.commands[0].commandId, "estimates.create");
});

test("CRM planner searches before mutation", () => {
  const result = planNativeCrm({ mode: "search", query: "Jane" });
  assert.equal(result.commands[0].commandId, "clients.list");
  assert.equal(result.commands[0].requiresHumanApproval, false);
});
