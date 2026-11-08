import assert from "node:assert/strict";
import test from "node:test";
import { assessAssuranceReadiness, canRewindAsNewIntent } from "../.test-dist/governance/assurance.js";
const trace = { company_id: "company-a", operation_id: "op-1", constitution_policy_set_id: "titan.constitution.v1", authority_decision_ref: "authority-1", evidence_refs: ["evidence-1"], execution_receipt_ref: "receipt-1", verification_ref: "verification-1", rewind_intent_ref: "rewind-1" };
test("projects a complete trace as assurance-ready", () => assert.equal(assessAssuranceReadiness(trace).ready, true));
test("fails closed when execution or verification evidence is absent", () => { const result = assessAssuranceReadiness({ ...trace, execution_receipt_ref: undefined, verification_ref: undefined }); assert.equal(result.ready, false); assert.deepEqual(result.missing, ["execution_receipt_ref", "verification_ref"]); });
test("rewind requires a new governed intent reference", () => { assert.equal(canRewindAsNewIntent(trace), true); assert.equal(canRewindAsNewIntent({ ...trace, rewind_intent_ref: undefined }), false); });

