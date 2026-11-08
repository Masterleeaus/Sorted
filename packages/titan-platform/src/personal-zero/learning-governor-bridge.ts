import { createLearningProposal } from "../workforce-evidence/learning-governor-bridge.js";
import type { VerifiedOutcome } from "../workforce-evidence/contracts.js";
import type { CognitiveEvent, PredictionCalibration, UnderstandingEvidence } from "./contracts.js";

export type PersonalZeroLearningProposal=Readonly<{
  schema:"titan.personal-zero.learning-proposal.v1";
  company_id:string;one_id:string;zero_id:string;relationship_id:string;
  trigger:"correction"|"prediction_error"|"verified_outcome";
  evidence_refs:readonly string[];
  proposed_adjustments:readonly ("ranking"|"recommendation_weight"|"workflow_preference"|"exception_pattern")[];
  workforce_governor_proposal:ReturnType<typeof createLearningProposal>|null;
  requires_learning_governor_review:true;
  authority_granted:false;execution_permitted:false;grants_authority:false;authority_effect:false;
}>;

const base=(x:{company_id:string;one_id:string;zero_id:string;relationship_id:string|null},trigger:PersonalZeroLearningProposal["trigger"],evidence_refs:readonly string[],workforce_governor_proposal:ReturnType<typeof createLearningProposal>|null):PersonalZeroLearningProposal=>{
 if(!x.relationship_id)throw new Error("Personal Zero learning requires relationship_id");
 return Object.freeze({schema:"titan.personal-zero.learning-proposal.v1",company_id:x.company_id,one_id:x.one_id,zero_id:x.zero_id,relationship_id:x.relationship_id,trigger,evidence_refs:Object.freeze([...evidence_refs]),proposed_adjustments:Object.freeze(["ranking","recommendation_weight","workflow_preference","exception_pattern"] as const),workforce_governor_proposal,requires_learning_governor_review:true,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false});
};

export function proposeLearningFromCorrection(evidence:UnderstandingEvidence):PersonalZeroLearningProposal{
 if(!evidence.correction_of)throw new Error("correction_of is required for correction-driven learning");
 return base(evidence,"correction",[evidence.understanding_evidence_id,evidence.correction_of],null);
}
export function proposeLearningFromPredictionError(input:{company_id:string;one_id:string;zero_id:string;relationship_id:string;calibration:PredictionCalibration;error_threshold?:number}):PersonalZeroLearningProposal|null{
 const threshold=input.error_threshold??0.25;
 if(input.calibration.brier_score<threshold)return null;
 return base(input,"prediction_error",[input.calibration.prediction_event_id,input.calibration.outcome_event_id],null);
}
export function proposeLearningFromVerifiedOutcome(input:{one_id:string;zero_id:string;relationship_id:string;outcome:VerifiedOutcome}):PersonalZeroLearningProposal{
 const governed=createLearningProposal(input.outcome);
 return base({company_id:input.outcome.company_id,one_id:input.one_id,zero_id:input.zero_id,relationship_id:input.relationship_id},"verified_outcome",[input.outcome.outcome_id,...input.outcome.receipt_refs],governed);
}
export function assertLearningProposalAuthorityNeutral(proposal:PersonalZeroLearningProposal){
 if(proposal.authority_granted||proposal.execution_permitted||proposal.grants_authority||proposal.authority_effect)throw new Error("Learning proposal cannot grant authority");
 return proposal;
}
