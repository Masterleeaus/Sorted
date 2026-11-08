import {normalizeVerifiedOutcome,type VerifiedOutcome} from "./contracts.js";
export function createLearningProposal(input:VerifiedOutcome){
 const v=normalizeVerifiedOutcome(input);
 return Object.freeze({schema:"titan.workforce.learning-proposal.v1",company_id:v.company_id,agent_id:v.agent_id,capability_id:v.capability_id,
 outcome_id:v.outcome_id,correlation_id:v.correlation_id,evidence_refs:v.receipt_refs,proposal_only:true,
 may_adjust:["ranking","recommendation_weight","workflow_preference","exception_pattern"],
 may_not_adjust:["authority","entitlement","delegation_ceiling","governance_policy","tenant_boundary"],
 requires_learning_governor_review:true,requires_external_authority_evaluation_for_any_future_execution:true,
 authority_granted:false as const,execution_permitted:false as const,grants_authority:false as const,authority_effect:false as const});
}
