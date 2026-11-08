// @ts-nocheck
// Forward-ported into Titan Business Ops native platform from five-tier workforce runtime.
const clean=(v,max=1200)=>String(v??'').trim().slice(0,max);
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const SALES={manager:'titan.manager.sales',supervisor:'titan.sales.sales_coordinator'};
const QUOTE={specialist:'titan.sales.quote_coordinator',worker:'titan.worker.create_quote_agent'};
const BOOKING={manager:'titan.manager.customer_service',supervisor:'titan.customer.customer_service_coordinator',specialist:'titan.customer.booking_coordinator',worker:'titan.worker.book_job_agent'};
const QUALIFIER={specialist:'titan.sales.sales_representative',worker:'titan.worker.intelligent_lead_scoring_agent'};

function requireBase(input={}){
 const company_id=clean(input.company_id,128); if(!validCompany(company_id)) throw new Error('lead-qualification-company_id-required');
 const call_ref=clean(input.call_ref,220); if(!call_ref) throw new Error('lead-qualification-call_ref-required');
 const evidence_ref=clean(input.evidence_ref??input.transcript_ref??input.voicemail_ref,260); if(!evidence_ref) throw new Error('lead-qualification-evidence-ref-required');
 const idempotency_key=clean(input.idempotency_key,220); if(!idempotency_key) throw new Error('lead-qualification-idempotency-key-required');
 return {company_id,call_ref,evidence_ref,idempotency_key};
}
function firstMatch(text, patterns){ for(const p of patterns){ const m=text.match(p); if(m) return clean(m[1]??m[0],220); } return null; }
function extractService(text,input){
 const explicit=clean(input.service_need,220); if(explicit) return {value:explicit,source:'structured_evidence',confidence:1};
 const m=firstMatch(text,[/\b(?:need|want|looking for|after|require)\s+(?:a\s+|an\s+|some\s+)?([^.!?]{3,90})/i,/\b(cleaning|plumbing|electrical|gardening|landscaping|painting|handyman|pest control|window cleaning|carpet cleaning|pressure washing|pool service|hvac|air conditioning)\b/i]);
 return m?{value:m,source:'transcript_inference',confidence:.72}:null;
}
function extractLocation(text,input){
 const explicit=clean(input.location_ref??input.location_text,220); if(explicit) return {value:explicit,source:'structured_evidence',confidence:1};
 const m=firstMatch(text,[/\b(?:in|at|around|near)\s+([A-Z][A-Za-z .'-]{2,50})(?:\b|[,.!?])/]);
 return m?{value:m,source:'transcript_inference',confidence:.65}:null;
}
function extractUrgency(text,input){
 const explicit=clean(input.urgency,80).toLowerCase(); if(explicit) return {value:explicit,source:'structured_evidence',confidence:1};
 if(/\b(emergency|urgent|asap|immediately|right now|today)\b/i.test(text)) return {value:'urgent',source:'transcript_inference',confidence:.9};
 if(/\b(no rush|not urgent|whenever|flexible)\b/i.test(text)) return {value:'flexible',source:'transcript_inference',confidence:.9};
 return null;
}
function extractTiming(text,input){
 const explicit=clean(input.timing,160); if(explicit) return {value:explicit,source:'structured_evidence',confidence:1};
 const m=firstMatch(text,[/\b(today|tomorrow|tonight|this\s+(?:morning|afternoon|evening|week|weekend)|next\s+(?:week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?)\b/i]);
 return m?{value:m,source:'transcript_inference',confidence:.82}:null;
}
function detectIntent(text,input){
 const explicit=clean(input.requested_action,80).toLowerCase();
 if(['quote','booking','information'].includes(explicit)) return {value:explicit,source:'structured_evidence',confidence:1};
 if(/\b(quote|estimate|price|cost|how much)\b/i.test(text)) return {value:'quote',source:'transcript_inference',confidence:.92};
 if(/\b(book|booking|schedule|appointment|come out|send someone)\b/i.test(text)) return {value:'booking',source:'transcript_inference',confidence:.92};
 return {value:'information',source:'transcript_inference',confidence:.5};
}
export function extractCallLeadQualification(input={}){
 const b=requireBase(input); const text=clean(input.transcript_text??input.voicemail_text,5000);
 const service=extractService(text,input), location=extractLocation(text,input), urgency=extractUrgency(text,input), timing=extractTiming(text,input), intent=detectIntent(text,input);
 const fields={service_need:service,location,urgency,timing,requested_action:intent};
 const missing=[]; if(!service) missing.push('service_need'); if(!location) missing.push('location'); if(!timing) missing.push('timing');
 const inferred=Object.entries(fields).filter(([,v])=>v?.source==='transcript_inference').map(([k])=>k);
 return {schema:'titan.workforce.call-lead-qualification.v1',...b,lead_ref:clean(input.lead_ref,220)||null,customer_ref:clean(input.customer_ref,220)||null,
  qualification:{service_need:service?.value??null,location:location?.value??null,urgency:urgency?.value??'unspecified',timing:timing?.value??null,requested_action:intent.value},
  evidence_provenance:fields,inferred_fields:inferred,missing_fields:missing,complete_for_routing:missing.length===0,
  transcript_is_evidence_not_truth:true,persistence_performed:false,grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function planQualifiedLeadHandoff(input={}){
 const q=extractCallLeadQualification(input); const handoffs=[];
 handoffs.push({type:'GOVERNED_HANDOFF',intent:'score_call_lead_qualification_proposal',orchestrator:'sales',manager:SALES.manager,supervisor:SALES.supervisor,specialist:QUALIFIER.specialist,target_worker:QUALIFIER.worker,company_id:q.company_id,lead_ref:q.lead_ref,customer_ref:q.customer_ref,evidence_ref:q.evidence_ref,qualification:q.qualification,requires_approval:true,execution_permitted:false});
 if(!q.complete_for_routing){
  handoffs.push({type:'GOVERNED_HANDOFF',intent:'request_missing_lead_qualification_evidence',orchestrator:'sales',manager:SALES.manager,supervisor:SALES.supervisor,specialist:QUALIFIER.specialist,target_worker:'titan.worker.create_follow_up_agent',company_id:q.company_id,lead_ref:q.lead_ref,customer_ref:q.customer_ref,evidence_ref:q.evidence_ref,missing_fields:q.missing_fields,requires_human_or_customer_clarification:true,execution_permitted:false});
  return {...q,schema:'titan.workforce.qualified-call-handoff-plan.v1',status:'QUALIFICATION_INCOMPLETE',recommended_orchestrator:null,handoffs,downstream_creation_performed:false};
 }
 if(q.qualification.requested_action==='quote'){
  handoffs.push({type:'GOVERNED_HANDOFF',intent:'prepare_quote_from_qualified_call_proposal',orchestrator:'quote',manager:SALES.manager,supervisor:SALES.supervisor,specialist:QUOTE.specialist,target_worker:QUOTE.worker,company_id:q.company_id,lead_ref:q.lead_ref,customer_ref:q.customer_ref,evidence_ref:q.evidence_ref,qualification:q.qualification,requires_approval:true,execution_permitted:false});
  return {...q,schema:'titan.workforce.qualified-call-handoff-plan.v1',status:'QUOTE_HANDOFF_RECOMMENDED',recommended_orchestrator:'quote',handoffs,downstream_creation_performed:false};
 }
 if(q.qualification.requested_action==='booking'){
  handoffs.push({type:'GOVERNED_HANDOFF',intent:'prepare_booking_from_qualified_call_proposal',orchestrator:'booking',manager:BOOKING.manager,supervisor:BOOKING.supervisor,specialist:BOOKING.specialist,target_worker:BOOKING.worker,company_id:q.company_id,lead_ref:q.lead_ref,customer_ref:q.customer_ref,evidence_ref:q.evidence_ref,qualification:q.qualification,requires_approval:true,execution_permitted:false});
  return {...q,schema:'titan.workforce.qualified-call-handoff-plan.v1',status:'BOOKING_HANDOFF_RECOMMENDED',recommended_orchestrator:'booking',handoffs,downstream_creation_performed:false};
 }
 return {...q,schema:'titan.workforce.qualified-call-handoff-plan.v1',status:'SALES_REVIEW_RECOMMENDED',recommended_orchestrator:'sales',handoffs,downstream_creation_performed:false};
}
export function dedupeQualification(previous={},candidate={}){
 const a=clean(previous.company_id,128),b=clean(candidate.company_id,128); if(a&&b&&a!==b) throw new Error('lead-qualification-company-mismatch');
 const key=clean(candidate.idempotency_key,220); if(!key) throw new Error('lead-qualification-idempotency-key-required');
 const seen=Array.isArray(previous.processed_idempotency_keys)?previous.processed_idempotency_keys:[];
 return seen.includes(key)?{duplicate:true,apply:false,processed_idempotency_keys:seen,execution_permitted:false}:{duplicate:false,apply:true,processed_idempotency_keys:[...seen,key],execution_permitted:false};
}
export default {extractCallLeadQualification,planQualifiedLeadHandoff,dedupeQualification};
