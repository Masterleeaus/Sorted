import {strict as assert} from "node:assert";
import {createVerifiedValueReceipt,createLearningProposal,createOutcomeHealthEvidence} from "../../src/workforce-evidence/index.js";
const x={company_id:"c1",agent_id:"a1",capability_id:"cap1",outcome_id:"o1",correlation_id:"r1",receipt_refs:["receipt:1"],expected_state_ref:"expected:1",verified_state_ref:"verified:1",verified:true,financial_value:100,time_saved_minutes:20};
const value=createVerifiedValueReceipt(x);const learning=createLearningProposal(x);const health=createOutcomeHealthEvidence(x);
assert.equal(value.value.financial_value,100);assert.equal(learning.authority_granted,false);assert.equal(learning.may_not_adjust.includes("authority"),true);
assert.equal(health.trust_is_not_authority,true);
