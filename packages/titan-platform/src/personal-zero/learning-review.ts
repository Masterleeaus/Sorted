import type { PersonalZeroLearningProposal } from "./learning-governor-bridge.js";

export type LearningReviewStatus="pending_review"|"accepted"|"rejected"|"superseded";
export type LearningProposalRecord=Readonly<PersonalZeroLearningProposal & {
  proposal_id:string;status:LearningReviewStatus;created_at:number;
  reviewed_at:number|null;reviewer_id:string|null;review_evidence_refs:readonly string[];
  review_reason:string|null;supersedes_proposal_id:string|null;
  applied:false;application_authority:false;
}>;

const id=(v:unknown,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(n+" is required");return x};
export function createLearningProposalRecord(proposal:PersonalZeroLearningProposal,input:{proposal_id:string;created_at:number;supersedes_proposal_id?:string|null}):LearningProposalRecord{
 return Object.freeze({...proposal,proposal_id:id(input.proposal_id,"proposal_id"),status:"pending_review",created_at:Number(input.created_at),reviewed_at:null,reviewer_id:null,review_evidence_refs:Object.freeze([]),review_reason:null,supersedes_proposal_id:input.supersedes_proposal_id??null,applied:false,application_authority:false});
}
export function reviewLearningProposal(current:LearningProposalRecord,input:{status:"accepted"|"rejected";reviewer_id:string;review_evidence_refs:readonly string[];review_reason:string;reviewed_at:number}):LearningProposalRecord{
 if(current.status!=="pending_review")throw new Error("Only pending learning proposals may be reviewed");
 if(!input.review_evidence_refs.length)throw new Error("Learning review requires evidence");
 return Object.freeze({...current,status:input.status,reviewer_id:id(input.reviewer_id,"reviewer_id"),review_evidence_refs:Object.freeze([...input.review_evidence_refs]),review_reason:id(input.review_reason,"review_reason"),reviewed_at:Number(input.reviewed_at),applied:false,application_authority:false});
}
export function supersedeLearningProposal(current:LearningProposalRecord,input:{superseded_at:number;reason:string}):LearningProposalRecord{
 if(current.status==="superseded")throw new Error("Learning proposal already superseded");
 return Object.freeze({...current,status:"superseded",reviewed_at:Number(input.superseded_at),review_reason:id(input.reason,"reason"),applied:false,application_authority:false});
}
