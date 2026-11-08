import test from "node:test";
import assert from "node:assert/strict";
import { createCounterfactualBranch, compareCounterfactualBranches, promoteCounterfactualIntent } from "../.test-dist/counterfactual-branch.js";

const input = {
  branch_id: "branch-1",
  company_id: "company-1",
  parent_evidence_checkpoint: "evidence-1",
  assumptions: ["technician unavailable tomorrow"],
  provenance_ref: "model:planner-1",
  created_at: "2026-10-02T00:00:00Z",
};

test("creates isolated counterfactual branches and compares siblings", () => {
  const branch = createCounterfactualBranch(input);
  assert.equal(branch.classification, "COUNTERFACTUAL");
  assert.equal(branch.authority_granted, false);
  assert.deepEqual(compareCounterfactualBranches([branch], "company-1").branch_ids, ["branch-1"]);
});

test("rejects cross-company and stale branch comparisons", () => {
  const branch = createCounterfactualBranch(input);
  assert.throws(() => compareCounterfactualBranches([{ ...branch, company_id: "company-2" }], "company-1"), /branch-company-mismatch/);
  assert.throws(() => compareCounterfactualBranches([branch], "company-1", "evidence-2"), /checkpoint-mismatch/);
});

test("promotes only a fresh governed real intent reference", () => {
  const branch = createCounterfactualBranch(input);
  assert.deepEqual(promoteCounterfactualIntent(branch, {
    company_id: "company-1",
    parent_evidence_checkpoint: "evidence-1",
    real_intent_id: "intent-1",
    authority_decision_ref: "decision-1",
  }), {
    company_id: "company-1",
    branch_id: "branch-1",
    parent_evidence_checkpoint: "evidence-1",
    real_intent_id: "intent-1",
    authority_decision_ref: "decision-1",
    classification: "FACTUAL_INTENT",
    authority_granted: false,
  });
  assert.throws(() => promoteCounterfactualIntent(branch, { company_id: "company-2", parent_evidence_checkpoint: "evidence-1", real_intent_id: "intent-1", authority_decision_ref: "decision-1" }), /company-mismatch/);
});

