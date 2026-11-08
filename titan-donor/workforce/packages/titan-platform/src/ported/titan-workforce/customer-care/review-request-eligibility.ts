// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/customer-care/review-request-eligibility.mjs
import { assessReviewEligibility } from './customer-care-contract.js';

const ALLOWED_OUTCOMES = Object.freeze(['SATISFIED','POSITIVE','RESOLVED_SATISFACTORY']);
const OPEN_CASE_STATES = Object.freeze(['OPEN','TRIAGED','WAITING_CUSTOMER','WAITING_INTERNAL','PENDING_APPROVAL']);
const NEGATIVE_SENTIMENTS = Object.freeze(['NEGATIVE']);

const clean = (v, max=240) => String(v ?? '').trim().slice(0,max);
const uniq = values => Object.freeze([...new Set((Array.isArray(values)?values:[]).map(v=>clean(v)).filter(Boolean))]);
function requireString(v, field){const x=clean(v,160);if(!x)throw new TypeError(`${field} is required`);return x;}
function normalize(v){return clean(v,80).toUpperCase();}

export const CUSTOMER_CARE_REVIEW_REQUEST_CONTRACT = Object.freeze({
  schema:'titan.workforce.customer-care.review-request-eligibility-contract.v1',
  company_boundary:'company_id',
  authority_rule:'identity_does_not_grant_authority',
  purpose:'public_review_request',
  requires_verified_outcome:true,
  satisfactory_outcomes:ALLOWED_OUTCOMES,
  blocks_unresolved_dissatisfaction:true,
  blocks_negative_sentiment:true,
  blocks_open_customer_care_cases:true,
  requires_customer_contact_consent:true,
  duplicate_scope:'company_id+customer_id+job_id+purpose',
  output_is_proposal_only:true,
  sender_owner:'Titan Connect'
});

function validateOutcome(input, company_id, customer_id, job_id){
  const outcome=input?.outcome_record;
  if(!outcome||outcome.verified!==true)return {ok:false,reason:'verified_satisfactory_outcome_required'};
  if(requireString(outcome.company_id,'outcome_record.company_id')!==company_id)return {ok:false,reason:'cross_company_outcome_record'};
  if(requireString(outcome.customer_id,'outcome_record.customer_id')!==customer_id)return {ok:false,reason:'outcome_customer_mismatch'};
  if(requireString(outcome.job_id,'outcome_record.job_id')!==job_id)return {ok:false,reason:'outcome_job_mismatch'};
  const status=normalize(outcome.status);
  if(!ALLOWED_OUTCOMES.includes(status))return {ok:false,reason:'outcome_not_satisfactory'};
  return {ok:true,status,evidence_ref:clean(outcome.evidence_ref)||null};
}

function inspectCases(cases, company_id, customer_id, job_id){
  const blockers=[];
  for(const c of Array.isArray(cases)?cases:[]){
    if(!c||c.company_id!==company_id) throw new Error('review-request-cross-company-case-rejected');
    if(c.customer_id&&c.customer_id!==customer_id) continue;
    if(c.job_id&&c.job_id!==job_id) continue;
    const base=assessReviewEligibility(c);
    if(!base.eligible) blockers.push(...base.blockers.map(v=>`case:${clean(c.case_id)||'unknown'}:${v}`));
    if(OPEN_CASE_STATES.includes(normalize(c.state))) blockers.push(`case:${clean(c.case_id)||'unknown'}:open_case`);
    if(NEGATIVE_SENTIMENTS.includes(normalize(c.sentiment))) blockers.push(`case:${clean(c.case_id)||'unknown'}:negative_sentiment`);
  }
  return uniq(blockers);
}

export function buildReviewRequestDedupeKey(input={}){
  const company_id=requireString(input.company_id,'company_id');
  const customer_id=requireString(input.customer_id,'customer_id');
  const job_id=requireString(input.job_id,'job_id');
  return `${company_id}:${customer_id}:${job_id}:public_review_request`;
}

export class MemoryReviewRequestLedger {
  #entries=new Map();
  has(k){return this.#entries.has(k)}
  get(k){return this.#entries.get(k)??null}
  record(k,v){if(this.#entries.has(k))return this.#entries.get(k);const f=Object.freeze({...v});this.#entries.set(k,f);return f}
  size(){return this.#entries.size}
}

export function assessPublicReviewRequestEligibility(input={}, ports={}){
  const company_id=requireString(input.company_id,'company_id');
  const customer_id=requireString(input.customer_id,'customer_id');
  const job_id=requireString(input.job_id,'job_id');
  const dedupe_key=buildReviewRequestDedupeKey({company_id,customer_id,job_id});
  const base={
    schema:'titan.workforce.customer-care.review-request-decision.v1', company_id,customer_id,job_id,
    purpose:'public_review_request',dedupe_key,authority_granted:false,execution_permitted:false,delivery_permitted:false
  };

  const outcome=validateOutcome(input,company_id,customer_id,job_id);
  if(!outcome.ok)return Object.freeze({...base,eligible:false,status:'BLOCKED',reason:outcome.reason,blockers:Object.freeze([outcome.reason])});

  const caseBlockers=inspectCases(input.customer_care_cases,company_id,customer_id,job_id);
  if(caseBlockers.length)return Object.freeze({...base,eligible:false,status:'SUPPRESSED_DISSATISFACTION',reason:'unresolved_or_negative_customer_care',blockers:caseBlockers});

  if(input.latest_sentiment&&NEGATIVE_SENTIMENTS.includes(normalize(input.latest_sentiment))){
    return Object.freeze({...base,eligible:false,status:'SUPPRESSED_DISSATISFACTION',reason:'latest_negative_sentiment',blockers:Object.freeze(['latest_negative_sentiment'])});
  }
  if(input.unresolved_dissatisfaction===true){
    return Object.freeze({...base,eligible:false,status:'SUPPRESSED_DISSATISFACTION',reason:'unresolved_dissatisfaction_flag',blockers:Object.freeze(['unresolved_dissatisfaction_flag'])});
  }

  const prefs=input.contact_preferences;
  if(!prefs||prefs.status!=='GRANTED')return Object.freeze({...base,eligible:false,status:'BLOCKED',reason:'customer_contact_consent_missing',blockers:Object.freeze(['customer_contact_consent_missing'])});
  const channel=clean(input.channel,64).toLowerCase();
  const allowed=Array.isArray(prefs.allowed_channels)?prefs.allowed_channels.map(v=>clean(v,64).toLowerCase()):[];
  if(!channel||!allowed.includes(channel))return Object.freeze({...base,eligible:false,status:'BLOCKED',reason:'channel_not_consented',blockers:Object.freeze(['channel_not_consented'])});

  const ledger=ports.ledger;
  if(!ledger||typeof ledger.has!=='function'||typeof ledger.record!=='function')throw new TypeError('review request ledger port is required');
  if(ledger.has(dedupe_key))return Object.freeze({...base,eligible:false,status:'SUPPRESSED_DUPLICATE',reason:'duplicate_public_review_request',prior:ledger.get?.(dedupe_key)??null,blockers:Object.freeze(['duplicate_public_review_request'])});

  const proposal=Object.freeze({...base,eligible:true,status:'PROPOSE_REVIEW_REQUEST',reason:null,blockers:Object.freeze([]),channel,
    template_intent:'public_review_request',outcome_status:outcome.status,outcome_evidence_ref:outcome.evidence_ref,
    sender_owner:'Titan Connect',send_requires_authority:true});
  ledger.record(dedupe_key,{company_id,customer_id,job_id,status:'PROPOSE_REVIEW_REQUEST',outcome_status:outcome.status});
  return proposal;
}
