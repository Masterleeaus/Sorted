// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/customer-care/customer-care-human-review.mjs
import { transitionCustomerCareCase } from './customer-care-contract.js';

const REVIEW_CLASSES = Object.freeze(['REFUND','CREDIT','FREE_REWORK','LEGAL_SAFETY','ABUSIVE_INTERACTION','HIGH_VALUE_CUSTOMER','GENERAL']);
const STATES = Object.freeze(['WAITING','APPROVED','REJECTED','EXPIRED','SUPERSEDED']);
const PROTECTED_EFFECTS = Object.freeze(['REFUND','CREDIT','FREE_REWORK','LEGAL_ADMISSION','SAFETY_COMMITMENT']);
const EXECUTABLE_AFTER_GOVERNANCE = Object.freeze(['REFUND','CREDIT','FREE_REWORK']);
const NEVER_UNLOCKED_HERE = Object.freeze(['LEGAL_ADMISSION','SAFETY_COMMITMENT']);

const clean = (v, max=240) => String(v ?? '').trim().slice(0,max);
const uniq = values => Object.freeze([...new Set((Array.isArray(values)?values:[]).map(v=>clean(v)).filter(Boolean))]);
function requireCompanyId(v){const id=clean(v,128);if(!id)throw new TypeError('company_id is required');return id;}
function normalizeReviewClass(v){const x=clean(v,64).toUpperCase();if(!REVIEW_CLASSES.includes(x))throw new TypeError('invalid Customer Care review class');return x;}
function normalizeState(v){const x=clean(v,32).toUpperCase();if(!STATES.includes(x))throw new TypeError('invalid Customer Care review state');return x;}
function proposalFingerprint(p={}){
  return JSON.stringify({
    proposal_type: clean(p.proposal_type,64).toUpperCase(),
    amount: Number.isFinite(Number(p.amount)) ? Number(p.amount) : null,
    currency: clean(p.currency,12).toUpperCase() || null,
    job_id: clean(p.job_id)||null,
    invoice_id: clean(p.invoice_id)||null,
    reason_code: clean(p.reason_code,120)||null
  });
}
function inferReviewClass(caseRecord={}, proposal={}){
  const type=clean(proposal.proposal_type,64).toUpperCase();
  if(type==='REFUND')return 'REFUND';
  if(type==='CREDIT')return 'CREDIT';
  if(type==='FREE_REWORK')return 'FREE_REWORK';
  if(['LEGAL_ADMISSION','SAFETY_COMMITMENT'].includes(type)||['SAFETY','PRIVACY'].includes(clean(caseRecord.issue_class,64).toUpperCase()))return 'LEGAL_SAFETY';
  if(proposal.abusive_interaction===true||clean(proposal.reason_code,120).toUpperCase()==='ABUSIVE_INTERACTION')return 'ABUSIVE_INTERACTION';
  if(proposal.high_value_customer===true)return 'HIGH_VALUE_CUSTOMER';
  return 'GENERAL';
}
function validateProposalLinkage(caseRecord, proposal){
  if(proposal.company_id && proposal.company_id!==caseRecord.company_id)throw new Error('customer-care-review-cross-company-proposal-rejected');
  for(const key of ['customer_id','job_id','invoice_id']){
    if(proposal[key] && caseRecord[key] && proposal[key]!==caseRecord[key])throw new Error(`customer-care-review-${key}-mismatch`);
  }
}

export const CUSTOMER_CARE_HUMAN_REVIEW_CONTRACT = Object.freeze({
  schema:'titan.workforce.customer-care.human-review-contract.v1',
  company_boundary:'company_id',
  authority_rule:'identity_does_not_grant_authority',
  review_classes:REVIEW_CLASSES,
  protected_effects:PROTECTED_EFFECTS,
  execution_after_approval_requires_separate_authority:EXECUTABLE_AFTER_GOVERNANCE,
  never_unlocked_by_customer_care_review:NEVER_UNLOCKED_HERE,
  mandatory_review:Object.freeze(['REFUND','CREDIT','FREE_REWORK','LEGAL_SAFETY','ABUSIVE_INTERACTION','HIGH_VALUE_CUSTOMER']),
  human_decision_required:true,
  decision_scope_bound_to_exact_proposal:true,
  approval_is_not_execution_authority:true
});

export function buildCustomerCareReviewRequirements(caseRecord={}, proposal={}){
  const company_id=requireCompanyId(caseRecord.company_id);
  validateProposalLinkage(caseRecord,proposal);
  const review_class=inferReviewClass(caseRecord,proposal);
  const proposal_type=clean(proposal.proposal_type,64).toUpperCase()||null;
  const reasons=[];
  if(['REFUND','CREDIT','FREE_REWORK'].includes(proposal_type))reasons.push('protected_remediation');
  if(review_class==='LEGAL_SAFETY')reasons.push('legal_or_safety_review');
  if(review_class==='ABUSIVE_INTERACTION')reasons.push('abusive_interaction_review');
  if(review_class==='HIGH_VALUE_CUSTOMER')reasons.push('high_value_customer_review');
  if(clean(caseRecord.severity,32).toUpperCase()==='CRITICAL')reasons.push('critical_case');
  const mandatory=CUSTOMER_CARE_HUMAN_REVIEW_CONTRACT.mandatory_review.includes(review_class)||clean(caseRecord.severity,32).toUpperCase()==='CRITICAL';
  return Object.freeze({company_id,review_class,mandatory,reasons:uniq(reasons),requires_human_reviewer:mandatory,requires_separation_of_duties:true,authority_granted:false,execution_permitted:false,grants_authority:false});
}

export function createCustomerCareHumanReview(caseRecord={}, proposal={}, options={}){
  const company_id=requireCompanyId(caseRecord.company_id);
  if(!caseRecord.customer_id)throw new TypeError('customer_id is required');
  validateProposalLinkage(caseRecord,proposal);
  const requirements=buildCustomerCareReviewRequirements(caseRecord,proposal);
  const review_class=options.review_class?normalizeReviewClass(options.review_class):requirements.review_class;
  const fingerprint=proposalFingerprint(proposal);
  const review_id=clean(options.review_id)||`${company_id}:customer-care:review:${clean(caseRecord.case_id)||clean(caseRecord.customer_id)}:${Buffer.from(fingerprint).toString('base64url').slice(0,24)}`;
  let pending_case=caseRecord;
  if(caseRecord.state==='TRIAGED'||caseRecord.state==='WAITING_INTERNAL')pending_case=transitionCustomerCareCase(caseRecord,'PENDING_APPROVAL');
  return Object.freeze({
    schema:'titan.workforce.customer-care.human-review.v1', company_id, review_id,
    case_id:caseRecord.case_id??null, customer_id:caseRecord.customer_id, job_id:caseRecord.job_id??null, invoice_id:caseRecord.invoice_id??null,
    review_class, state:'WAITING', proposal:Object.freeze({...proposal, company_id}), proposal_fingerprint:fingerprint,
    proposer_worker_id:clean(options.proposer_worker_id)||null,
    required_approver_refs:uniq(options.required_approver_refs?.length?options.required_approver_refs:['human_reviewer']),
    requirements, case_state_projection:pending_case.state,
    protected_effects_remain_blocked:true, approval_satisfied:false, execution_authorization_required:true,
    authority_granted:false, execution_permitted:false, grants_authority:false
  });
}

export function decideCustomerCareHumanReview(review={}, decision={}){
  const company_id=requireCompanyId(review.company_id);
  if(review.schema!=='titan.workforce.customer-care.human-review.v1')throw new TypeError('Customer Care human review is required');
  if(normalizeState(review.state)!=='WAITING')throw new Error('customer-care-review-not-waiting');
  if(decision.company_id!==company_id)throw new Error('customer-care-review-cross-company-decision-rejected');
  const actor_type=clean(decision.actor_type,32).toUpperCase();
  if(actor_type!=='HUMAN')throw new Error('customer-care-review-human-decision-required');
  const approver_id=clean(decision.approver_id);
  if(!approver_id)throw new TypeError('approver_id is required');
  if(review.proposer_worker_id&&approver_id===review.proposer_worker_id)throw new Error('customer-care-review-separation-of-duties-required');
  const state=normalizeState(decision.decision);
  if(!['APPROVED','REJECTED'].includes(state))throw new TypeError('decision must be APPROVED or REJECTED');
  const presented=proposalFingerprint(decision.proposal??review.proposal);
  if(presented!==review.proposal_fingerprint)throw new Error('customer-care-review-proposal-drift-rejected');
  const proposal_type=clean(review.proposal?.proposal_type,64).toUpperCase();
  const executionCandidate=state==='APPROVED'&&EXECUTABLE_AFTER_GOVERNANCE.includes(proposal_type);
  const permanentlyBlocked=NEVER_UNLOCKED_HERE.includes(proposal_type);
  return Object.freeze({
    ...review, state, decision:Object.freeze({actor_type:'HUMAN',approver_id,reason:clean(decision.reason,500)||null,decided_at:decision.decided_at??Date.now()}),
    approval_satisfied:state==='APPROVED',
    governed_execution_candidate:executionCandidate&&!permanentlyBlocked,
    protected_effects_remain_blocked:true,
    execution_authorization_required:true,
    never_unlocked_by_customer_care_review:permanentlyBlocked,
    authority_granted:false, execution_permitted:false, grants_authority:false
  });
}

export function buildCustomerCareApprovalHandoff(review={}){
  const company_id=requireCompanyId(review.company_id);
  if(review.schema!=='titan.workforce.customer-care.human-review.v1')throw new TypeError('Customer Care human review is required');
  return Object.freeze({
    schema:'titan.workforce.customer-care.approval-handoff.v1', company_id,
    review_id:review.review_id, case_id:review.case_id??null, customer_id:review.customer_id,
    proposal_fingerprint:review.proposal_fingerprint, review_state:review.state,
    target:'governance', purpose:review.state==='APPROVED'?'GOVERNED_EXECUTION_EVALUATION':'REVIEW_OUTCOME_RECORDING',
    approval_is_not_execution_authority:true, authority_granted:false, execution_permitted:false, grants_authority:false
  });
}
