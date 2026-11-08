const clean=(v,max=260)=>String(v??'').trim().slice(0,max);
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const SALES_CHAIN={manager:'titan.manager.sales',supervisor:'titan.sales.sales_coordinator',specialist:'titan.sales.sales_representative'};
const CUSTOMER_CHAIN={manager:'titan.manager.customer_service',supervisor:'titan.customer.customer_service_coordinator',specialist:'titan.customer.receptionist'};
function requireBase(input={}){
 const company_id=clean(input.company_id,128); if(!validCompany(company_id)) throw new Error('caller-resolution-company_id-required');
 const call_ref=clean(input.call_ref,220); if(!call_ref) throw new Error('caller-resolution-call_ref-required');
 const idempotency_key=clean(input.idempotency_key,220); if(!idempotency_key) throw new Error('caller-resolution-idempotency-key-required');
 return {company_id,call_ref,idempotency_key};
}
function normalizedMatch(candidate,company_id){
 if(!candidate||typeof candidate!=='object') return null;
 const c=clean(candidate.company_id,128); if(c!==company_id) return null;
 const customer_ref=clean(candidate.customer_ref??candidate.customer_id,220); if(!customer_ref) return null;
 const confidence=Number(candidate.confidence??0); if(!Number.isFinite(confidence)||confidence<0||confidence>1) return null;
 const basis=clean(candidate.match_basis,80).toLowerCase();
 return {company_id:c,customer_ref,confidence,match_basis:basis||'unspecified'};
}
export function resolveCallerIdentity(input={}){
 const b=requireBase(input); const caller_ref=clean(input.caller_ref,220)||null;
 const matches=(Array.isArray(input.customer_matches)?input.customer_matches:[]).map(x=>normalizedMatch(x,b.company_id)).filter(Boolean);
 const exact=matches.filter(x=>x.confidence===1 && ['verified_phone','verified_contact','canonical_channel_identity'].includes(x.match_basis));
 let resolution='unknown', customer_ref=null, review_required=false;
 if(exact.length===1){ resolution='known_customer'; customer_ref=exact[0].customer_ref; }
 else if(exact.length>1 || matches.length>1){ resolution='ambiguous'; review_required=true; }
 else if(matches.length===1){ resolution='ambiguous'; review_required=true; }
 return {schema:'titan.workforce.caller-identity-resolution.v1',...b,caller_ref,resolution,customer_ref,
  candidate_count:matches.length,match_candidates:matches.map(x=>({customer_ref:x.customer_ref,confidence:x.confidence,match_basis:x.match_basis})),
  review_required,match_policy:'EXACT_VERIFIED_SINGLE_MATCH_ONLY',grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function planCallerRevenueCapture(input={}){
 const r=resolveCallerIdentity(input); const evidence_ref=clean(input.evidence_ref,260)||null;
 const service_interest=clean(input.service_interest,220)||null; const caller_name_ref=clean(input.caller_name_ref,220)||null;
 const source='voice_call_recovery';
 if(r.resolution==='known_customer'){
  return {schema:'titan.workforce.caller-revenue-capture-plan.v1',...r,status:'KNOWN_CUSTOMER_ENQUIRY_PROPOSED',source,
   handoffs:[{type:'GOVERNED_HANDOFF',intent:'attach_customer_enquiry_proposal',orchestrator:'reception',manager:CUSTOMER_CHAIN.manager,
    supervisor:CUSTOMER_CHAIN.supervisor,specialist:CUSTOMER_CHAIN.specialist,target_worker:'titan.worker.create_follow_up_agent',company_id:r.company_id,
    customer_ref:r.customer_ref,caller_ref:r.caller_ref,call_ref:r.call_ref,evidence_ref,service_interest,requires_approval:true,execution_permitted:false}],
   duplicate_customer_creation_permitted:false,grants_authority:false,authority_effect:false,execution_permitted:false};
 }
 if(r.resolution==='ambiguous'){
  return {schema:'titan.workforce.caller-revenue-capture-plan.v1',...r,status:'IDENTITY_REVIEW_REQUIRED',source,
   handoffs:[{type:'GOVERNED_HANDOFF',intent:'caller_identity_human_review',orchestrator:'reception',manager:CUSTOMER_CHAIN.manager,
    supervisor:CUSTOMER_CHAIN.supervisor,specialist:CUSTOMER_CHAIN.specialist,target_worker:null,company_id:r.company_id,call_ref:r.call_ref,
    caller_ref:r.caller_ref,evidence_ref,requires_human_acceptance:true,execution_permitted:false}],
   lead_creation_permitted:false,customer_link_permitted:false,grants_authority:false,authority_effect:false,execution_permitted:false};
 }
 return {schema:'titan.workforce.caller-revenue-capture-plan.v1',...r,status:'UNKNOWN_CALLER_LEAD_PROPOSED',source,
  handoffs:[{type:'GOVERNED_HANDOFF',intent:'create_lead_from_call_enquiry_proposal',orchestrator:'sales',manager:SALES_CHAIN.manager,
   supervisor:SALES_CHAIN.supervisor,specialist:SALES_CHAIN.specialist,target_worker:'titan.worker.create_lead_agent',company_id:r.company_id,
   caller_ref:r.caller_ref,caller_name_ref,call_ref:r.call_ref,evidence_ref,service_interest,source,requires_approval:true,execution_permitted:false}],
  customer_creation_permitted:false,lead_creation_is_proposal:true,grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function planOpportunityReview(input={}){
 const b=requireBase(input); const lead_ref=clean(input.lead_ref,220); if(!lead_ref) throw new Error('caller-opportunity-canonical-lead-ref-required');
 const qualification_ref=clean(input.qualification_ref,260); if(!qualification_ref) throw new Error('caller-opportunity-qualification-ref-required');
 return {schema:'titan.workforce.call-opportunity-review.v1',...b,status:'OPPORTUNITY_REVIEW_PROPOSED',lead_ref,qualification_ref,
  orchestrator:'sales',manager:SALES_CHAIN.manager,supervisor:SALES_CHAIN.supervisor,specialist:SALES_CHAIN.specialist,
  intent:'evaluate_canonical_lead_for_opportunity',persistence_request_only:true,opportunity_creation_performed:false,requires_approval:true,
  grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function dedupeCallerCapture(previous={},candidate={}){
 const a=clean(previous.company_id,128),b=clean(candidate.company_id,128); if(a&&b&&a!==b) throw new Error('caller-capture-company-mismatch');
 const key=clean(candidate.idempotency_key,220); if(!key) throw new Error('caller-resolution-idempotency-key-required');
 const seen=Array.isArray(previous.processed_idempotency_keys)?previous.processed_idempotency_keys:[];
 if(seen.includes(key)) return {duplicate:true,apply:false,processed_idempotency_keys:seen,execution_permitted:false};
 return {duplicate:false,apply:true,processed_idempotency_keys:[...seen,key],execution_permitted:false};
}
export {SALES_CHAIN,CUSTOMER_CHAIN};
export default {resolveCallerIdentity,planCallerRevenueCapture,planOpportunityReview,dedupeCallerCapture,SALES_CHAIN,CUSTOMER_CHAIN};
