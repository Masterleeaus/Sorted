import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTrustCycle } from "../.test-dist/workforce-trust/trust-cycle.js";
import { evaluateUnlockEligibility } from "../.test-dist/workforce-trust/unlock-gates.js";

const base={company_id:"co-1",agent_id:"agent-1",capability:"booking.create",outcome_success:true,policy_compliant:true,human_correction:false,reversed:false};

test("trust cannot accrue from asserted success without verified outcome evidence",()=>{
 const asserted=evaluateTrustCycle(base);
 assert.equal(asserted.successful,false);
 assert.equal(asserted.verified_outcome,false);
 const noEvidence=evaluateTrustCycle({...base,outcome_verified:true});
 assert.equal(noEvidence.successful,false);
 const verified=evaluateTrustCycle({...base,outcome_verified:true,evidence_refs:["evidence:verification:1"]});
 assert.equal(verified.successful,true);
 assert.equal(verified.verified_outcome,true);
 assert.deepEqual(verified.evidence_refs,["evidence:verification:1"]);
});

test("unlock eligibility counts only evidence-backed successful trust cycles and never grants authority",()=>{
 const unverified=Array.from({length:5},()=>evaluateTrustCycle(base));
 const denied=evaluateUnlockEligibility({company_id:"co-1",agent_id:"agent-1",capability:"booking.create",cycles:unverified,user_approved:true,worker_accepted:true},"proactive_specialist");
 assert.equal(denied.eligible_for_authority_evaluation,false);
 const verified=Array.from({length:5},(_,i)=>evaluateTrustCycle({...base,outcome_verified:true,evidence_refs:[`evidence:${i}`]}));
 const eligible=evaluateUnlockEligibility({company_id:"co-1",agent_id:"agent-1",capability:"booking.create",cycles:verified,user_approved:true,worker_accepted:true},"proactive_specialist");
 assert.equal(eligible.eligible_for_authority_evaluation,true);
 assert.equal(eligible.authority_granted,false);
 assert.equal(eligible.execution_permitted,false);
});


test("trust evidence from one workflow path cannot unlock another",()=>{
 const cycles=Array.from({length:5},(_,i)=>evaluateTrustCycle({...base,workflow:"booking.standard",context_ref:"region:melbourne",outcome_verified:true,evidence_refs:[`evidence:path:${i}`]}));
 const same=evaluateUnlockEligibility({company_id:"co-1",agent_id:"agent-1",capability:"booking.create",workflow:"booking.standard",context_ref:"region:melbourne",cycles,user_approved:true,worker_accepted:true},"proactive_specialist");
 assert.equal(same.eligible_for_authority_evaluation,true);
 const other=evaluateUnlockEligibility({company_id:"co-1",agent_id:"agent-1",capability:"booking.create",workflow:"booking.emergency",context_ref:"region:melbourne",cycles,user_approved:true,worker_accepted:true},"proactive_specialist");
 assert.equal(other.eligible_for_authority_evaluation,false);
});
