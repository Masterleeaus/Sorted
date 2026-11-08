import {normalizeVerifiedOutcome,type VerifiedOutcome} from "./contracts.js";
export function createOutcomeHealthEvidence(input:VerifiedOutcome){
 const v=normalizeVerifiedOutcome(input);
 return Object.freeze({schema:"titan.workforce.outcome-health-evidence.v1",company_id:v.company_id,agent_id:v.agent_id,outcome_id:v.outcome_id,
 correlation_id:v.correlation_id,verified:true,receipt_count:v.receipt_refs.length,expected_state_ref:v.expected_state_ref,verified_state_ref:v.verified_state_ref,
 performance_evidence:true,trust_evidence_candidate:true,trust_is_not_authority:true,authority_effect:false as const,grants_authority:false as const});
}
