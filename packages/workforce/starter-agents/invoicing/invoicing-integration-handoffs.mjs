import { createHash } from 'node:crypto';

const JOBS_TRIGGER_SCHEMA = 'titan.workforce.starter.invoicing.jobs-to-invoice-trigger.v1';
const CUSTOMER_CARE_SCHEMA = 'titan.workforce.starter.invoicing.customer-care-handoff.v1';
const REBOOKING_SCHEMA = 'titan.workforce.starter.invoicing.rebooking-handoff.v1';
const CERT_SCHEMA = 'titan.workforce.starter.invoicing.integration-certification.v1';

function text(v){ return typeof v === 'string' && v.trim() ? v.trim() : null; }
function company(v){ const c=text(v); if(!c) throw new TypeError('company_id is required'); return c; }
function stable(v){ if(Array.isArray(v)) return v.map(stable); if(v&&typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])); return v; }
function digest(v){ return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex'); }
function assertCompany(c,o,label){ if(o?.company_id && o.company_id!==c) throw new Error(`company_boundary_mismatch:${label}`); }
function authority(){ return Object.freeze({company_boundary:'company_id',identity_grants_authority:false,authority_granted:false,grants_authority:false,execution_permitted:false,canonical_mutation_permitted:false,outreach_permitted:false,booking_execution_permitted:false}); }
function id(prefix,body){ const h=digest(body); return Object.freeze({content_hash:h,operation_id:`${prefix}:${h.slice(0,32)}`,idempotency_key:`tz:${body.company_id}:${prefix}:${h}`}); }

export function buildJobsToInvoiceTrigger({company_id,source_event={},job={},readiness=null}={}){
  const c=company(company_id); assertCompany(c,source_event,'source_event'); assertCompany(c,job,'job'); assertCompany(c,readiness,'readiness');
  if(source_event.verified!==true) throw new Error('verified_job_completion_event_required');
  if(text(source_event.type)!=='job.completed') throw new Error('job_completed_event_required');
  if(text(source_event.source_owner)!=='Titan Field') throw new Error('job_source_owner_must_be_titan_field');
  if(!text(source_event.event_ref)) throw new Error('job_event_ref_required');
  if(!text(job.job_ref) || job.job_ref!==source_event.job_ref) throw new Error('job_ref_mismatch');
  if(text(job.status)?.toLowerCase()!=='completed') throw new Error('canonical_job_not_completed');
  if(job.request_invoice!==true) throw new Error('invoice_not_requested');
  if(!readiness || readiness.schema!=='titan.workforce.starter.invoicing.readiness.v1' || readiness.ready!==true) throw new Error('invoice_readiness_not_certified');
  const body={company_id:c,event_ref:source_event.event_ref,job_ref:job.job_ref,readiness_schema:readiness.schema,readiness_evaluated_at:readiness.evaluated_at??null};
  return Object.freeze({schema:JOBS_TRIGGER_SCHEMA,company_id:c,worker:'Invoicing Agent',source:{type:'job.completed',event_ref:source_event.event_ref,source_owner:'Titan Field',verified:true,job_ref:job.job_ref},target:{worker:'Invoicing Agent',purpose:'invoice_ready_job',proposal_only:true},identity:id('jobs-to-invoice',body),authority:authority()});
}

export function buildCustomerCareInvoiceIssuedHandoff({company_id,invoice={},customer_ref,job_ref=null,source_event_ref=null}={}){
  const c=company(company_id); assertCompany(c,invoice,'invoice');
  if(invoice.verified!==true) throw new Error('verified_canonical_invoice_required');
  if(text(invoice.source_owner)!=='Titan CRM') throw new Error('invoice_source_owner_must_be_titan_crm');
  if(!text(invoice.invoice_ref)) throw new Error('invoice_ref_required');
  if(!['issued','sent','viewed','partially_paid','paid','overdue'].includes(text(invoice.status)?.toLowerCase())) throw new Error('invoice_not_issued');
  const customer=text(customer_ref); if(!customer) throw new Error('customer_ref_required');
  const eventRef=text(source_event_ref) ?? `invoice-issued:${invoice.invoice_ref}`;
  const body={company_id:c,event_ref:eventRef,invoice_ref:invoice.invoice_ref,customer_ref:customer,job_ref:text(job_ref)};
  return Object.freeze({schema:CUSTOMER_CARE_SCHEMA,company_id:c,worker:'Invoicing Agent',source_event:{type:'invoice.issued',event_ref:eventRef,source_owner:'Titan CRM',verified:true,invoice_ref:invoice.invoice_ref,customer_ref:customer,job_ref:text(job_ref)},target:{worker:'Customer Care Agent',purpose:'post_invoice_customer_care',proposal_only:true,consent_and_channel_policy_required_downstream:true,dedupe_required_downstream:true},identity:id('invoice-to-customer-care',body),authority:authority()});
}

export function buildRebookingPaidHandoff({company_id,invoice={},payment_monitoring=null,job={},customer_ref,service_ref,source_event_ref=null}={}){
  const c=company(company_id); assertCompany(c,invoice,'invoice'); assertCompany(c,payment_monitoring,'payment_monitoring'); assertCompany(c,job,'job');
  if(invoice.verified!==true || text(invoice.source_owner)!=='Titan CRM') throw new Error('verified_titan_crm_invoice_required');
  if(!payment_monitoring || payment_monitoring.schema!=='titan.workforce.starter.invoicing.payment-monitoring.v1') throw new Error('valid_payment_monitoring_required');
  if(payment_monitoring.observed?.payment_state!=='paid' || payment_monitoring.observed?.balance_due_minor!=='0') throw new Error('invoice_not_fully_paid');
  if(text(job.status)?.toLowerCase()!=='completed' || !text(job.job_ref)) throw new Error('completed_job_required');
  const customer=text(customer_ref), service=text(service_ref); if(!customer) throw new Error('customer_ref_required'); if(!service) throw new Error('service_ref_required');
  const eventRef=text(source_event_ref) ?? `invoice-paid:${invoice.invoice_ref}`;
  const body={company_id:c,event_ref:eventRef,invoice_ref:invoice.invoice_ref,job_ref:job.job_ref,customer_ref:customer,service_ref:service};
  return Object.freeze({schema:REBOOKING_SCHEMA,company_id:c,worker:'Invoicing Agent',source_event:{type:'invoice.paid',event_ref:eventRef,source_owner:'Titan CRM/payment reconciliation',verified:true,invoice_ref:invoice.invoice_ref,job_ref:job.job_ref,customer_ref:customer,service_ref:service},target:{worker:'Rebooking Agent',purpose:'repeat_service_opportunity_input',proposal_only:true,recurrence_policy_required_downstream:true,consent_required_downstream:true,suppression_required_downstream:true,booking_handoff_required_downstream:true},identity:id('invoice-to-rebooking',body),authority:authority()});
}

export function certifyInvoicingIntegration({company_id,jobs_trigger=null,customer_care_handoff=null,rebooking_handoff=null,financial_certification=null,downstream_status={}}={}){
  const c=company(company_id); const checks=[];
  for(const [name,obj,schema] of [['jobs_trigger',jobs_trigger,JOBS_TRIGGER_SCHEMA],['customer_care_handoff',customer_care_handoff,CUSTOMER_CARE_SCHEMA],['rebooking_handoff',rebooking_handoff,REBOOKING_SCHEMA]]){
    if(!obj){ checks.push({name:`${name}_present`,passed:false}); continue; }
    assertCompany(c,obj,name); checks.push({name:`${name}_schema`,passed:obj.schema===schema}); checks.push({name:`${name}_authority_neutral`,passed:obj.authority?.execution_permitted===false&&obj.authority?.canonical_mutation_permitted===false});
  }
  if(financial_certification){ assertCompany(c,financial_certification,'financial_certification'); checks.push({name:'financial_integrity_certified',passed:financial_certification.certified===true}); }
  else checks.push({name:'financial_integrity_certified',passed:false});
  const failed=checks.filter(x=>!x.passed).map(x=>x.name);
  const jobsReady=downstream_status.jobs==='ready_for_manager_merge' || downstream_status.jobs==='merged';
  const customerReady=downstream_status.customer_care==='ready_for_manager_merge' || downstream_status.customer_care==='merged';
  const rebookingReady=downstream_status.rebooking==='ready_for_manager_merge' || downstream_status.rebooking==='merged';
  return Object.freeze({schema:CERT_SCHEMA,company_id:c,worker:'Invoicing Agent',invoicing_side_certified:failed.length===0,blocking_invariants:Object.freeze(failed),downstream_acceptance:{jobs:downstream_status.jobs??'unknown',customer_care:downstream_status.customer_care??'unknown',rebooking:downstream_status.rebooking??'unknown',jobs_ready:jobsReady,customer_care_ready:customerReady,rebooking_ready:rebookingReady,end_to_end_downstream_certified:jobsReady&&customerReady&&rebookingReady,note:'Downstream readiness is evidence only; Invoicing Agent does not promote or execute other workers.'},authority:authority()});
}

export {JOBS_TRIGGER_SCHEMA,CUSTOMER_CARE_SCHEMA,REBOOKING_SCHEMA,CERT_SCHEMA as INVOICING_INTEGRATION_CERTIFICATION_SCHEMA};
