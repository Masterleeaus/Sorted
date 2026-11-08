import { CUSTOMER_CARE_CONTRACT, buildCustomerCareHandoff } from './customer-care-contract.mjs';

const TARGETS = Object.freeze(['jobs', 'rebooking', 'sales']);
const RESOLVED_STATES = Object.freeze(['RESOLVED', 'CLOSED']);
const LEGACY = new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const clean = (v, max = 240) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const unique = (v, max = 64) => Object.freeze([...new Set((Array.isArray(v) ? v : []).map(x => clean(typeof x === 'string' ? x : (x?.id ?? x?.ref ?? ''), 320)).filter(Boolean))].slice(0, max));
function company(v){const id=clean(v,128);if(!id)throw new TypeError('company_id is required');return id;}
function rejectLegacy(value,path='input'){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,v]of Object.entries(value)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(v,`${path}.${k}`);}}
function sameCompany(record, expected, label){if(!record)return;const c=company(record.company_id);if(c!==expected)throw new Error(`customer-care-resolved-handoff-cross-company-${label}`);}
function sameId(record, field, expected, label){if(!record||!expected)return;const actual=clean(record[field],180);if(actual&&actual!==expected)throw new Error(`customer-care-resolved-handoff-${label}-id-mismatch`);}
function target(v){const t=clean(v,40).toLowerCase();if(!TARGETS.includes(t))throw new TypeError('unsupported resolved-service handoff target');return t;}
function reasonFor(t,v){const reason=clean(v,120).toUpperCase();const allowed=CUSTOMER_CARE_CONTRACT.handoffs[t];if(!allowed?.includes(reason))throw new Error(`customer-care-resolved-handoff-reason-invalid:${t}:${reason||'missing'}`);return reason;}

export function buildResolvedServiceHandoffDedupeKey(input={}){
  const c=company(input.company_id);const case_id=clean(input.case_id??input.source_case_id,180);if(!case_id)throw new TypeError('case_id is required');const t=target(input.target);const r=reasonFor(t,input.reason);return `customer-care:${c}:${case_id}:${t}:${r}`;
}

export function buildResolvedServiceHandoff(input={}){
  rejectLegacy(input);const c=company(input.company_id);const record=input.case_record;
  if(!record||typeof record!=='object')throw new TypeError('case_record is required');sameCompany(record,c,'case');
  const case_id=clean(record.case_id??input.case_id,180);if(!case_id)throw new TypeError('resolved Customer Care case_id is required');
  const customer_id=clean(record.customer_id,180);if(!customer_id)throw new TypeError('resolved Customer Care customer_id is required');
  const state=clean(record.state,40).toUpperCase();if(!RESOLVED_STATES.includes(state))throw new Error('customer-care-resolved-handoff-case-not-resolved');
  if(record.authority_granted===true||record.execution_permitted===true)throw new Error('customer-care-resolved-handoff-authority-bearing-case-forbidden');
  const t=target(input.target);const reason=reasonFor(t,input.reason);
  const satisfactory=input.outcome_satisfactory===true;
  const sentiment=clean(record.sentiment,40).toUpperCase();
  if((t==='rebooking'||t==='sales')&&(!satisfactory||sentiment==='NEGATIVE'))throw new Error('customer-care-resolved-handoff-satisfactory-outcome-required');
  const job_id=clean(record.job_id,180)||null,location_id=clean(record.location_id,180)||null,invoice_id=clean(record.invoice_id,180)||null;
  sameCompany(input.customer_record,c,'customer');sameId(input.customer_record,'customer_id',customer_id,'customer');
  sameCompany(input.job_record,c,'job');sameId(input.job_record,'job_id',job_id,'job');
  sameCompany(input.location_record,c,'location');sameId(input.location_record,'location_id',location_id,'location');
  sameCompany(input.invoice_record,c,'invoice');sameId(input.invoice_record,'invoice_id',invoice_id,'invoice');
  const evidence_refs=unique([...(Array.isArray(record.evidence_refs)?record.evidence_refs:[]),...(Array.isArray(input.evidence_refs)?input.evidence_refs:[])]);
  if(evidence_refs.length===0)throw new Error('customer-care-resolved-handoff-evidence-required');
  const generic=buildCustomerCareHandoff({...record,case_id},t,reason,{source_case_state:state,outcome_satisfactory:satisfactory});
  const dedupe_key=buildResolvedServiceHandoffDedupeKey({company_id:c,case_id,target:t,reason});
  return Object.freeze({
    schema:'titan.workforce.customer-care.resolved-service-handoff.v1',company_id:c,handoff_id:dedupe_key,dedupe_key,
    source_case_id:case_id,customer_id,job_id,location_id,invoice_id,target:t,reason,
    source_refs:Object.freeze({case_ref:case_id,customer_ref:customer_id,job_ref:job_id,location_ref:location_id,invoice_ref:invoice_id}),
    evidence_refs,
    context:Object.freeze({source_case_state:state,issue_class:clean(record.issue_class,40).toUpperCase()||'OTHER',sentiment:sentiment||'UNKNOWN',outcome_satisfactory:satisfactory}),
    generic_handoff:generic,
    source_records_authoritative:true,owns_source_records:false,overwrite_source_records:false,direct_mutation:false,
    downstream_action_requested:true,downstream_action_completed:false,requires_target_validation:true,requires_governed_execution_for_material_effect:true,
    authority_granted:false,execution_permitted:false
  });
}

export class MemoryResolvedServiceHandoffLedger {
  #seen = new Map();
  record(handoff){if(!handoff||handoff.schema!=='titan.workforce.customer-care.resolved-service-handoff.v1')throw new TypeError('resolved service handoff required');const existing=this.#seen.get(handoff.dedupe_key);if(existing)return Object.freeze({duplicate:true,handoff:existing});this.#seen.set(handoff.dedupe_key,handoff);return Object.freeze({duplicate:false,handoff});}
  get(dedupe_key){return this.#seen.get(clean(dedupe_key,500))??null;}
}
