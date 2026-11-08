import { LICENSED_TRADE_SERVICE_CATALOGUE } from './catalogue.js';
import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_REFERENCE_BLUEPRINT_SCHEMA='titan.vertical.licensed-trades.reference-blueprint.v1' as const;
export const LICENSED_TRADES_E2E_CERTIFICATION_SCHEMA='titan.vertical.licensed-trades.e2e-certification.v1' as const;

export type LicensedTradeCertificationStageId='lead_intake'|'triage'|'quote'|'booking'|'qualification'|'workforce_assignment'|'job_execution'|'evidence'|'invoice'|'payment'|'rebooking';

export interface LicensedTradeCertificationInput {
  company_id:string;
  trade:LicensedTradeKey;
  service_key:string;
  refs:Partial<Record<'lead'|'triage'|'quote'|'booking'|'assignment'|'job'|'evidence'|'invoice'|'payment'|'rebooking',string>>;
  qualification:{required_tags:string[];verified_tags:string[];evidence_refs:string[]};
  permissions:{quote:boolean;booking:boolean;assignment:boolean;job_execution:boolean};
  stage_company_ids?:Partial<Record<LicensedTradeCertificationStageId,string>>;
  [key:string]:unknown;
}

const LEGACY_KEYS=new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId','business_id','account_id','workspace_id']);
function rejectLegacy(value:unknown,path='input'):void{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((item,index)=>rejectLegacy(item,`${path}[${index}]`));return;}for(const[key,child]of Object.entries(value as Record<string,unknown>)){if(LEGACY_KEYS.has(key))throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);rejectLegacy(child,`${path}.${key}`);}}
function req(value:unknown,label:string):string{const v=String(value??'').trim();if(!v)throw new Error(`${label} is required`);return v;}
function opt(value:unknown):string|null{const v=String(value??'').trim();return v||null;}

export const LICENSED_TRADES_REFERENCE_BLUEPRINT=Object.freeze({
  schema:LICENSED_TRADES_REFERENCE_BLUEPRINT_SCHEMA,
  vertical_id:'licensed-trades',
  company_boundary:'company_id',
  identity_grants_authority:false,
  stages:Object.freeze([
    Object.freeze({id:'lead_intake',owner:'shared_crm_customer_and_lead_owner',vertical_contribution:'trade/service intent and discovery context'}),
    Object.freeze({id:'triage',owner:'shared_reception_and_governed_triage_owner',vertical_contribution:'trade-aware urgency/risk and attendance-vs-quote hints'}),
    Object.freeze({id:'quote',owner:'shared_pricing_quote_owner',vertical_contribution:'trade pricing directives and quote gates'}),
    Object.freeze({id:'booking',owner:'shared_booking_owner',vertical_contribution:'site/asset/access context only'}),
    Object.freeze({id:'qualification',owner:'shared_workforce_qualification_owner',vertical_contribution:'required qualification tags and evidence refs'}),
    Object.freeze({id:'workforce_assignment',owner:'shared_workforce_assignment_owner',vertical_contribution:'eligibility constraints only'}),
    Object.freeze({id:'job_execution',owner:'shared_jobs_owner',vertical_contribution:'trade checklist and safe-state evidence placeholders'}),
    Object.freeze({id:'evidence',owner:'shared_evidence_owner',vertical_contribution:'test/material/completion evidence requirements'}),
    Object.freeze({id:'invoice',owner:'shared_invoice_owner',vertical_contribution:'completion-readiness handoff only'}),
    Object.freeze({id:'payment',owner:'shared_payment_reconciliation_owner',vertical_contribution:'payment-readiness reference only'}),
    Object.freeze({id:'rebooking',owner:'shared_recurrence_rebooking_owner',vertical_contribution:'maintenance/reinspection opportunity context only'})
  ]),
  owner_transfer_permitted:false,
  permission_bypass_permitted:false,
  qualification_bypass_permitted:false,
  automatic_assignment_permitted:false,
  direct_mutation_permitted:false,
  grants_authority:false,
  execution_permitted:false
} as const);

export const LICENSED_TRADES_VERTICAL_CAPABILITY_MATRIX=Object.freeze((['plumbing','electrical','hvac'] as const).map(trade=>Object.freeze({
  trade,
  company_boundary:'company_id' as const,
  shared_workforce_mesh:true,
  identity_grants_authority:false,
  automatic_assignment_permitted:false,
  permission_bypass_permitted:false,
  qualification_bypass_permitted:false,
  handyman_semantics_inherited:false,
  cleaning_semantics_inherited:false,
  pricing_owner:'shared_pricing_quote_owner',
  booking_owner:'shared_booking_owner',
  assignment_owner:'shared_workforce_assignment_owner',
  jobs_owner:'shared_jobs_owner',
  evidence_owner:'shared_evidence_owner'
})));

const REQUIRED_REFS=Object.freeze(['lead','triage','quote','booking','assignment','job','evidence','invoice','payment','rebooking'] as const);
const PERMISSION_KEYS=Object.freeze(['quote','booking','assignment','job_execution'] as const);

export function buildLicensedTradesE2eCertification(input:LicensedTradeCertificationInput){
  rejectLegacy(input);
  const company_id=req(input.company_id,'company_id');
  const service_key=req(input.service_key,'service_key');
  const service=LICENSED_TRADE_SERVICE_CATALOGUE.find(x=>x.service_key===service_key);
  if(!service) throw new Error(`unknown licensed-trade service: ${service_key}`);
  if(service.trade!==input.trade) throw new Error(`service ${service_key} does not belong to trade ${input.trade}`);

  const refs=Object.freeze(Object.fromEntries(REQUIRED_REFS.map(key=>[key,opt(input.refs?.[key])])) as Record<typeof REQUIRED_REFS[number],string|null>);
  const blockers:string[]=[];
  for(const key of REQUIRED_REFS) if(!refs[key]) blockers.push(`MISSING_${key.toUpperCase()}_REF`);

  const stageCompanyIds=input.stage_company_ids??{};
  for(const stage of LICENSED_TRADES_REFERENCE_BLUEPRINT.stages){
    const seen=String(stageCompanyIds[stage.id as LicensedTradeCertificationStageId]??company_id).trim();
    if(!seen) blockers.push(`MISSING_COMPANY_ID:${stage.id}`);
    else if(seen!==company_id) blockers.push(`CROSS_COMPANY:${stage.id}`);
  }

  const requiredTags=Object.freeze([...new Set((input.qualification?.required_tags??[]).map(x=>String(x).trim()).filter(Boolean))]);
  const verifiedTags=new Set((input.qualification?.verified_tags??[]).map(x=>String(x).trim()).filter(Boolean));
  const evidenceRefs=Object.freeze((input.qualification?.evidence_refs??[]).map(x=>String(x).trim()).filter(Boolean));
  for(const tag of requiredTags) if(!verifiedTags.has(tag)) blockers.push(`QUALIFICATION_TAG_UNVERIFIED:${tag}`);
  if(requiredTags.length>0 && evidenceRefs.length===0) blockers.push('QUALIFICATION_EVIDENCE_REQUIRED');

  for(const permission of PERMISSION_KEYS) if(input.permissions?.[permission]!==true) blockers.push(`PERMISSION_REQUIRED:${permission}`);

  const serviceRequiredTags=service.qualification_tags.map(x=>String(x).trim()).filter(Boolean);
  for(const tag of serviceRequiredTags) if(!requiredTags.includes(tag)) blockers.push(`SERVICE_QUALIFICATION_NOT_DECLARED:${tag}`);

  const certified=blockers.length===0;
  return Object.freeze({
    schema:LICENSED_TRADES_E2E_CERTIFICATION_SCHEMA,
    blueprint_schema:LICENSED_TRADES_REFERENCE_BLUEPRINT_SCHEMA,
    company_id,
    trade:input.trade,
    service_key,
    refs,
    qualification:Object.freeze({required_tags:requiredTags,verified_tags:Object.freeze([...verifiedTags]),evidence_refs:evidenceRefs}),
    stages:LICENSED_TRADES_REFERENCE_BLUEPRINT.stages,
    blockers:Object.freeze(blockers),
    certified,
    owners:Object.freeze({quote:'shared_pricing_quote_owner',booking:'shared_booking_owner',qualification:'shared_workforce_qualification_owner',assignment:'shared_workforce_assignment_owner',job:'shared_jobs_owner',evidence:'shared_evidence_owner',invoice:'shared_invoice_owner',payment:'shared_payment_reconciliation_owner',rebooking:'shared_recurrence_rebooking_owner'}),
    identity_grants_authority:false,
    permission_bypass_permitted:false,
    qualification_bypass_permitted:false,
    quote_mutation_emitted:false,
    booking_mutation_emitted:false,
    assignment_mutation_emitted:false,
    job_mutation_emitted:false,
    payment_mutation_emitted:false,
    rebooking_action_emitted:false,
    proposal_only:true,
    requires_fresh_authority:true,
    grants_authority:false,
    execution_permitted:false
  });
}
