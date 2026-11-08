import test from "node:test";
import assert from "node:assert/strict";
import {
  createFieldServiceLifecycle,
  advanceFieldServiceLifecycle,
  recordVerifiedOutcome,
  assertFieldServiceLifecycleScope,
} from "../.test-dist/field-service-lifecycle.js";

const base = {
  lifecycle_id: "l1",
  company_id: "co1",
  customer_ref: "customer:1",
};
const mutation = (id, next, expected_revision, extra = {}) => ({
  company_id: "co1",
  transition_id: id,
  idempotency_key: `idem:${id}`,
  next_stage: next,
  expected_revision,
  authority_decision_ref: `authority:${id}`,
  execution_receipt_ref: `receipt:${id}`,
  ...extra,
});

function progressToInProgress() {
  let item = createFieldServiceLifecycle(base);
  for (const [i, stage] of ["QUOTED", "APPROVED", "SCHEDULED", "IN_PROGRESS"].entries()) {
    item = advanceFieldServiceLifecycle(item, mutation(`t${i + 1}`, stage, item.revision));
  }
  return item;
}

test("creates and advances a governed company-scoped lifecycle", () => {
  const item = progressToInProgress();
  assert.equal(item.stage, "IN_PROGRESS");
  assert.equal(item.revision, 5);
  assert.equal(item.authority_granted, false);
  assert.equal(item.events.length, 4);
  assert.equal(item.events[0].authority_decision_ref, "authority:t1");
});

test("requires evidence and observed verification for completion and payment readiness", () => {
  const item = progressToInProgress();
  assert.throws(
    () => advanceFieldServiceLifecycle(item, mutation("complete-1", "COMPLETED", item.revision)),
    /evidence-required/,
  );
  const completed = advanceFieldServiceLifecycle(
    item,
    mutation("complete-1", "COMPLETED", item.revision, {
      evidence_refs: ["e:completion"],
      observed_verification_ref: "verify:completion",
    }),
  );
  assert.throws(
    () => advanceFieldServiceLifecycle(completed, mutation("invoice-1", "INVOICING_READY", completed.revision)),
    /evidence-required/,
  );
  const invoicingReady = advanceFieldServiceLifecycle(
    completed,
    mutation("invoice-1", "INVOICING_READY", completed.revision, {
      evidence_refs: ["e:invoice"],
      observed_verification_ref: "verify:invoice",
    }),
  );
  assert.equal(invoicingReady.stage, "INVOICING_READY");
});

test("makes duplicate replay idempotent and rejects conflicting reuse or stale revisions", () => {
  const item = createFieldServiceLifecycle(base);
  const first = advanceFieldServiceLifecycle(item, mutation("t1", "QUOTED", item.revision));
  const replay = advanceFieldServiceLifecycle(first, mutation("t1", "QUOTED", item.revision));
  assert.deepEqual(replay, first);
  assert.throws(
    () => advanceFieldServiceLifecycle(first, { ...mutation("t1", "QUOTED", item.revision), next_stage: "CANCELLED" }),
    /idempotency-conflict/,
  );
  assert.throws(
    () => advanceFieldServiceLifecycle(first, mutation("t2", "APPROVED", item.revision)),
    /revision-conflict/,
  );
});

test("rejects cross-company scope and provider acknowledgements as verification", () => {
  const item = createFieldServiceLifecycle(base);
  assert.throws(() => assertFieldServiceLifecycleScope(item, "co2"), /company-mismatch/);
  assert.throws(
    () => advanceFieldServiceLifecycle(item, mutation("t1", "QUOTED", item.revision, { provider_ack_ref: "ack:1" })),
    /observed-verification-required/,
  );
});

test("requires a governed execution receipt for every consequential transition", () => {
  const item = createFieldServiceLifecycle(base);
  const { execution_receipt_ref: _ignored, ...withoutReceipt } = mutation("t1", "QUOTED", item.revision);
  assert.throws(() => advanceFieldServiceLifecycle(item, withoutReceipt), /execution[_-]receipt[_-]ref-required/);
});

test("records a verified outcome only with evidence and preserves immutable event history", () => {
  const item = progressToInProgress();
  const completed = advanceFieldServiceLifecycle(
    item,
    mutation("complete-1", "COMPLETED", item.revision, {
      evidence_refs: ["e:completion"],
      observed_verification_ref: "verify:completion",
    }),
  );
  const withOutcome = recordVerifiedOutcome(completed, {
    company_id: "co1",
    outcome_ref: "outcome:completed",
    evidence_refs: ["e:outcome"],
    observed_verification_ref: "verify:outcome",
  });
  assert.deepEqual(withOutcome.outcome_refs, ["outcome:completed"]);
  assert.equal(withOutcome.events.length, completed.events.length);
  assert.equal(Object.isFrozen(withOutcome.events), true);
});

