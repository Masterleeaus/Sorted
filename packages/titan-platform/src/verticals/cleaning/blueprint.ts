export const CLEANING_VERTICAL_REFERENCE_BLUEPRINT_SCHEMA = 'titan.vertical.cleaning.reference-blueprint.v1' as const;
export const CLEANING_E2E_CERTIFICATION_SCHEMA = 'titan.vertical.cleaning.e2e-certification.v1' as const;

export type CleaningBlueprintStageId =
  | 'onboarding' | 'lead_intake' | 'quote' | 'booking' | 'recurring_schedule'
  | 'workforce_assignment' | 'job_execution' | 'evidence' | 'qa_rework'
  | 'invoice' | 'payment' | 'rebooking';

export interface CleaningE2eCertificationInput {
  company_id: string;
  scenario: 'residential'|'commercial'|'end_of_lease'|'airbnb'|'specialist';
  service_id: string;
  refs: Partial<Record<'onboarding'|'lead'|'quote'|'booking'|'schedule'|'job'|'evidence'|'qa'|'invoice'|'payment'|'rebooking', string>>;
  recurring?: boolean;
  commercial_contract_ref?: string;
  offline_sync_state?: 'LOCAL_ONLY'|'QUEUED'|'SYNCED'|'CONFLICT';
  qa_outcome?: 'PASS'|'PASS_WITH_NOTES'|'REWORK_REQUIRED'|'ESCALATION_REQUIRED';
  unresolved_rework_count?: number;
  stage_company_ids?: Partial<Record<CleaningBlueprintStageId,string>>;
  [key:string]: unknown;
}

const LEGACY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacy(value:unknown,path='input'):void {
  if(!value || typeof value!=='object') return;
  if(Array.isArray(value)){value.forEach((item,index)=>rejectLegacy(item,`${path}[${index}]`));return;}
  for(const [key,child] of Object.entries(value as Record<string,unknown>)){
    if(LEGACY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacy(child,`${path}.${key}`);
  }
}
function req(value:unknown,label:string):string { const v=String(value??'').trim(); if(!v) throw new Error(`${label} is required`); return v; }
function opt(value:unknown):string|null { const v=String(value??'').trim(); return v||null; }
function nonNegativeInt(value:unknown,label:string,fallback=0):number { if(value==null) return fallback; const n=Number(value); if(!Number.isInteger(n)||n<0) throw new Error(`${label} must be a non-negative integer`); return n; }

export const CLEANING_VERTICAL_REFERENCE_BLUEPRINT = Object.freeze({
  schema:CLEANING_VERTICAL_REFERENCE_BLUEPRINT_SCHEMA,
  vertical_id:'cleaning',
  company_boundary:'company_id',
  identity_grants_authority:false,
  device_first:true,
  stages:Object.freeze([
    Object.freeze({id:'onboarding',owner:'shared_company_settings_and_onboarding_owner',cleaning_contribution:'service catalogue and cleaning setup projection'}),
    Object.freeze({id:'lead_intake',owner:'shared_crm_customer_and_lead_owner',cleaning_contribution:'cleaning intent and discovery hints'}),
    Object.freeze({id:'quote',owner:'shared_quote_agent_owner',cleaning_contribution:'cleaning pricing directives and quote questions'}),
    Object.freeze({id:'booking',owner:'shared_booking_agent_owner',cleaning_contribution:'cleaning access, crew and arrival-window requirements'}),
    Object.freeze({id:'recurring_schedule',owner:'shared_recurring_work_and_scheduling_owner',cleaning_contribution:'cadence, SLA and rotating-task projection'}),
    Object.freeze({id:'workforce_assignment',owner:'shared_workforce_assignment_owner',cleaning_contribution:'crew, skill and continuity preferences'}),
    Object.freeze({id:'job_execution',owner:'shared_jobs_owner',cleaning_contribution:'room/area execution pack and checklist'}),
    Object.freeze({id:'evidence',owner:'shared_evidence_owner',cleaning_contribution:'cleaning evidence requirements and exception references'}),
    Object.freeze({id:'qa_rework',owner:'shared_jobs_customer_care_and_workforce_quality_owners',cleaning_contribution:'inspection, rework and service-recovery projection'}),
    Object.freeze({id:'invoice',owner:'shared_invoice_owner',cleaning_contribution:'completion-to-invoice readiness handoff only'}),
    Object.freeze({id:'payment',owner:'shared_payment_reconciliation_owner',cleaning_contribution:'payment-readiness reference only'}),
    Object.freeze({id:'rebooking',owner:'shared_rebooking_agent_owner',cleaning_contribution:'cleaning recurrence/rebooking opportunity context only'})
  ]),
  owner_transfer_permitted:false,
  direct_mutation_permitted:false,
  automatic_assignment_permitted:false,
  automatic_payment_permitted:false,
  automatic_rebooking_permitted:false,
  grants_authority:false,
  execution_permitted:false
} as const);

const REQUIRED_REFS = Object.freeze(['onboarding','lead','quote','booking','schedule','job','evidence','qa','invoice','payment','rebooking'] as const);

export function buildCleaningE2eCertification(input:CleaningE2eCertificationInput){
  rejectLegacy(input);
  const company_id=req(input.company_id,'company_id');
  const service_id=req(input.service_id,'service_id');
  const refs=Object.freeze(Object.fromEntries(REQUIRED_REFS.map(key=>[key,opt(input.refs?.[key])])) as Record<typeof REQUIRED_REFS[number],string|null>);
  const blockers:string[]=[];
  for(const key of REQUIRED_REFS) if(!refs[key]) blockers.push(`MISSING_${key.toUpperCase()}_REF`);

  const stageCompanyIds=input.stage_company_ids??{};
  for(const stage of CLEANING_VERTICAL_REFERENCE_BLUEPRINT.stages){
    const seen=String(stageCompanyIds[stage.id as CleaningBlueprintStageId]??company_id).trim();
    if(!seen) blockers.push(`MISSING_COMPANY_ID:${stage.id}`);
    else if(seen!==company_id) blockers.push(`CROSS_COMPANY:${stage.id}`);
  }

  const recurring=!!input.recurring;
  const commercialContractRef=opt(input.commercial_contract_ref);
  if(recurring && !refs.schedule) blockers.push('RECURRING_SCHEDULE_REF_REQUIRED');
  if(input.scenario==='commercial' && recurring && !commercialContractRef) blockers.push('COMMERCIAL_CONTRACT_REF_REQUIRED');

  const sync=input.offline_sync_state??'SYNCED';
  if(!['LOCAL_ONLY','QUEUED','SYNCED','CONFLICT'].includes(sync)) throw new Error(`unsupported offline_sync_state: ${sync}`);
  if(sync==='CONFLICT') blockers.push('OFFLINE_SYNC_CONFLICT');

  const qa=input.qa_outcome??'PASS';
  if(!['PASS','PASS_WITH_NOTES','REWORK_REQUIRED','ESCALATION_REQUIRED'].includes(qa)) throw new Error(`unsupported qa_outcome: ${qa}`);
  const unresolvedRework=nonNegativeInt(input.unresolved_rework_count,'unresolved_rework_count');
  if(qa==='REWORK_REQUIRED' || unresolvedRework>0) blockers.push('UNRESOLVED_REWORK');
  if(qa==='ESCALATION_REQUIRED') blockers.push('QA_ESCALATION_REQUIRED');

  const certified=blockers.length===0;
  return Object.freeze({
    schema:CLEANING_E2E_CERTIFICATION_SCHEMA,
    blueprint_schema:CLEANING_VERTICAL_REFERENCE_BLUEPRINT_SCHEMA,
    company_id,scenario:input.scenario,service_id,refs,recurring,commercial_contract_ref:commercialContractRef,
    offline_sync_state:sync,qa_outcome:qa,unresolved_rework_count:unresolvedRework,
    stages:CLEANING_VERTICAL_REFERENCE_BLUEPRINT.stages,
    blockers:Object.freeze(blockers),certified,
    handoffs:Object.freeze({
      invoice_ready:certified && !!refs.invoice,
      payment_reconciliation_ready:certified && !!refs.payment,
      rebooking_context_ready:certified && !!refs.rebooking
    }),
    owners:Object.freeze({
      quote:'shared_quote_agent_owner',booking:'shared_booking_agent_owner',scheduling:'shared_recurring_work_and_scheduling_owner',
      assignment:'shared_workforce_assignment_owner',job:'shared_jobs_owner',evidence:'shared_evidence_owner',qa:'shared_jobs_customer_care_and_workforce_quality_owners',
      invoice:'shared_invoice_owner',payment:'shared_payment_reconciliation_owner',rebooking:'shared_rebooking_agent_owner',offline:'shared_offline_sync_owner'
    }),
    invoice_mutation_emitted:false,payment_mutation_emitted:false,rebooking_action_emitted:false,booking_mutation_emitted:false,
    schedule_mutation_emitted:false,assignment_mutation_emitted:false,job_mutation_emitted:false,qa_mutation_emitted:false,
    proposal_only:true,requires_fresh_authority:true,grants_authority:false,execution_permitted:false
  });
}
