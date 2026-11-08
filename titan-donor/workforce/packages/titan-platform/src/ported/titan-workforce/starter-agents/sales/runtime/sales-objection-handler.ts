// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-objection-handler.mjs
export const SALES_OBJECTION_HANDLER_SCHEMA = 'titan-zero-starter-sales-objection-handler/v1';
const clean = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
const arr = (v) => Array.isArray(v) ? v : [];
function rejectLegacy(input) { for (const obj of [input,input?.knowledge,input?.request,input?.availability]) if (obj && typeof obj==='object' && ('tenant_id' in obj || 'tenant_company_id' in obj)) throw new TypeError('legacy tenant boundaries are not accepted'); }
function sameCompany(companyId,obj,label){ if(obj?.company_id && obj.company_id!==companyId) throw new TypeError(`${label} company_id must match Sales company_id`); }
function approvedEntries(entries,kind){ return arr(entries).filter(e=>e&&e.status==='approved'&&e.customer_safe===true&&clean(e.text)).map(e=>Object.freeze({id:clean(e.id),kind,text:clean(e.text),source_ref:clean(e.source_ref),version:clean(e.version)})); }
export function handleSalesObjection(input={}) {
  rejectLegacy(input); const company_id=clean(input.company_id); if(!company_id) throw new TypeError('company_id is required');
  const request=input.request||{}, knowledge=input.knowledge||{}; sameCompany(company_id,request,'request'); sameCompany(company_id,knowledge,'knowledge'); sameCompany(company_id,input.availability,'availability');
  const question=clean(request.question); if(!question) throw new TypeError('request.question is required');
  const category=clean(request.category)||'general', service=clean(request.service);
  const requestedDiscount=request.requested_discount===true||category==='discount', requestedAvailability=request.requested_availability===true||category==='availability', requestedPromise=request.requested_promise===true||category==='promise';
  const allFacts=[...approvedEntries(knowledge.service_facts,'service'),...approvedEntries(knowledge.pricing_facts,'pricing'),...approvedEntries(knowledge.policy_facts,'policy')];
  const matched=allFacts.filter(f=>{const hay=`${f.text} ${f.id||''}`.toLowerCase(); if(service&&hay.includes(service.toLowerCase())) return true; return question.toLowerCase().split(/\W+/).filter(x=>x.length>=4).some(t=>hay.includes(t));});
  const blockers=[], escalation_reasons=[];
  if(!knowledge.approved_snapshot_id||knowledge.status!=='approved') blockers.push('approved_knowledge_snapshot_required');
  if(requestedDiscount){const d=input.discount_authority||{}; sameCompany(company_id,d,'discount_authority'); if(d.status!=='approved'||!clean(d.approval_ref)){blockers.push('unsupported_discount'); escalation_reasons.push('discount_requires_external_approval');}}
  if(requestedAvailability){const a=input.availability||{}; if(a.status!=='verified'||!clean(a.source_ref)||!clean(a.slot_ref)){blockers.push('availability_unverified'); escalation_reasons.push('availability_must_be_verified_by_canonical_booking_or_scheduling_authority');}}
  if(requestedPromise){const p=input.promise_authority||{}; sameCompany(company_id,p,'promise_authority'); if(p.status!=='approved'||!clean(p.approval_ref)){blockers.push('unsupported_promise'); escalation_reasons.push('promise_requires_external_authority');}}
  if(!matched.length){blockers.push('approved_answer_not_found'); escalation_reasons.push('human_review_or_more_information_required');}
  const safeFacts=blockers.includes('approved_knowledge_snapshot_required')?[]:matched;
  return Object.freeze({schema:SALES_OBJECTION_HANDLER_SCHEMA,company_id,lead_id:clean(request.lead_id),correlation_id:clean(request.correlation_id),category,response_plan:Object.freeze({disposition:blockers.length?'escalate_or_clarify':'answer_from_approved_knowledge',facts:Object.freeze(safeFacts),customer_safe_only:true,may_offer_discount:requestedDiscount&&!blockers.includes('unsupported_discount'),may_state_availability:requestedAvailability&&!blockers.includes('availability_unverified'),may_make_promise:requestedPromise&&!blockers.includes('unsupported_promise'),must_not_invent:Object.freeze(['price','discount','availability','scope','warranty','outcome','completion_time'])}),blockers:Object.freeze([...new Set(blockers)]),escalation_reasons:Object.freeze([...new Set(escalation_reasons)]),evidence:Object.freeze({approved_snapshot_id:clean(knowledge.approved_snapshot_id),matched_fact_ids:Object.freeze(safeFacts.map(f=>f.id).filter(Boolean)),availability_source_ref:clean(input.availability?.source_ref),discount_approval_ref:clean(input.discount_authority?.approval_ref),promise_approval_ref:clean(input.promise_authority?.approval_ref)}),authority_neutral:true,execution_authority:false,pricing_authority_assumed:false,availability_authority_assumed:false,persistence_performed:false});
}
