import type { LearningProposalRecord } from "./learning-review.js";

export type LearningConsumer="interaction"|"decision"|"workforce";
export type AcceptedLearningAdjustment=Readonly<{
 schema:"titan.personal-zero.accepted-learning.v1";consumer:LearningConsumer;
 proposal_id:string;company_id:string;one_id:string;zero_id:string;relationship_id:string;
 trigger:LearningProposalRecord["trigger"];evidence_refs:readonly string[];review_evidence_refs:readonly string[];
 adjustments:LearningProposalRecord["proposed_adjustments"];
 read_only:true;authority_neutral:true;execution_authority:false;mutation_permitted:false;
}>;

export function createAcceptedLearningAdjustment(proposal:LearningProposalRecord,consumer:LearningConsumer):AcceptedLearningAdjustment{
 if(proposal.status!=="accepted")throw new Error("Only accepted learning proposals may be consumed");
 if(proposal.applied||proposal.application_authority)throw new Error("Personal Zero learning cannot directly apply or grant authority");
 return Object.freeze({schema:"titan.personal-zero.accepted-learning.v1",consumer,proposal_id:proposal.proposal_id,company_id:proposal.company_id,one_id:proposal.one_id,zero_id:proposal.zero_id,relationship_id:proposal.relationship_id,trigger:proposal.trigger,evidence_refs:Object.freeze([...proposal.evidence_refs]),review_evidence_refs:Object.freeze([...proposal.review_evidence_refs]),adjustments:Object.freeze([...proposal.proposed_adjustments]),read_only:true,authority_neutral:true,execution_authority:false,mutation_permitted:false});
}
