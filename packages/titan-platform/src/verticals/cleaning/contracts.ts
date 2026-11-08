export const CLEANING_COMMERCIAL_CONTRACT_SCHEMA='titan.vertical.cleaning.commercial-recurring-contract.v1' as const;
export type CleaningContractFrequency='daily'|'weekly'|'fortnightly'|'monthly'|'custom';
export interface CleaningCommercialSiteProfileInput {site_ref:string;site_name?:string;access_contact_ref?:string;instructions_ref?:string;consumables?:readonly string[];worker_continuity_preferred?:boolean;}
export interface CleaningCommercialContractInput {
  company_id:string; contract_ref:string; customer_ref:string; service_id:string; frequency:CleaningContractFrequency; schedule_source_ref:string;
  sla_window:{start:string;end:string}; sites:readonly CleaningCommercialSiteProfileInput[]; rotating_task_refs?:readonly string[];
  status?:'active'|'paused'|'change_requested'; pause_reason_ref?:string; change_request_ref?:string;
  continuity?:{preferred_worker_refs?:readonly string[]; minimum_repeat_workers?:number};
}
const LEGACY=new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacy(v:unknown,p='input'):void{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${p}[${i}]`));return;}for(const[k,x]of Object.entries(v as Record<string,unknown>)){if(LEGACY.has(k))throw new Error(`${p}.${k} is a legacy tenant boundary; company_id is required`);rejectLegacy(x,`${p}.${k}`);}}
function req(v:unknown,n:string){const x=String(v??'').trim();if(!x)throw new Error(`${n} is required`);return x;}
function opt(v:unknown){const x=String(v??'').trim();return x||null;}
function uniq(v:readonly string[]|undefined){return Object.freeze([...new Set((v??[]).map(x=>String(x).trim()).filter(Boolean))]);}
function hhmm(v:unknown,n:string){const x=String(v??'').trim();if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x))throw new Error(`${n} must be HH:MM`);return x;}
export function buildCleaningCommercialRecurringContract(input:CleaningCommercialContractInput){
  rejectLegacy(input);const company_id=req(input.company_id,'company_id');const contract_ref=req(input.contract_ref,'contract_ref');const customer_ref=req(input.customer_ref,'customer_ref');const service_id=req(input.service_id,'service_id');
  if(!['daily','weekly','fortnightly','monthly','custom'].includes(input.frequency))throw new Error(`unsupported frequency: ${input.frequency}`);
  const schedule_source_ref=req(input.schedule_source_ref,'schedule_source_ref');const start=hhmm(input.sla_window?.start,'sla_window.start');const end=hhmm(input.sla_window?.end,'sla_window.end');if(start>=end)throw new Error('sla_window.end must be after start');
  const sites=(input.sites??[]).map((s,i)=>Object.freeze({site_ref:req(s.site_ref,`sites[${i}].site_ref`),site_name:opt(s.site_name),access_contact_ref:opt(s.access_contact_ref),instructions_ref:opt(s.instructions_ref),consumables:uniq(s.consumables),worker_continuity_preferred:s.worker_continuity_preferred!==false}));
  if(!sites.length)throw new Error('at least one commercial cleaning site is required');if(new Set(sites.map(s=>s.site_ref)).size!==sites.length)throw new Error('duplicate site_ref');
  const status=input.status??'active';if(!['active','paused','change_requested'].includes(status))throw new Error(`unsupported contract status: ${status}`);if(status==='paused'&&!opt(input.pause_reason_ref))throw new Error('pause_reason_ref is required when paused');if(status==='change_requested'&&!opt(input.change_request_ref))throw new Error('change_request_ref is required when change_requested');
  const preferred=uniq(input.continuity?.preferred_worker_refs);const minimum=Math.max(0,Number(input.continuity?.minimum_repeat_workers??0));if(!Number.isInteger(minimum))throw new Error('minimum_repeat_workers must be an integer');
  return Object.freeze({schema:CLEANING_COMMERCIAL_CONTRACT_SCHEMA,company_id,contract_ref,customer_ref,service_id,frequency:input.frequency,schedule_source_ref,sla_window:Object.freeze({start,end}),sites:Object.freeze(sites),rotating_task_refs:uniq(input.rotating_task_refs),status,pause_reason_ref:opt(input.pause_reason_ref),change_request_ref:opt(input.change_request_ref),continuity:Object.freeze({preferred_worker_refs:preferred,minimum_repeat_workers:minimum}),
    owners:Object.freeze({contract:'shared_business_contract_owner',recurring:'shared_recurring_work_owner',scheduling:'shared_scheduling_owner',assignment:'shared_workforce_assignment_owner',jobs:'shared_jobs_owner'}),
    recurrence_proposal_only:true,schedule_mutation_emitted:false,contract_mutation_emitted:false,automatic_assignment:false,automatic_pause_resume:false,automatic_change_apply:false,requires_fresh_authority:true,grants_authority:false,execution_permitted:false});
}
