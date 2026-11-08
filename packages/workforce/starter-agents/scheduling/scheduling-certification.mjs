const LEGACY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId','workspace_tenant_id','tenant_company','tenant']);
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
const list=v=>Array.isArray(v)?v:[];
function rejectLegacy(value,path='certification'){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));return;}
 for(const [k,v] of Object.entries(value)){if(LEGACY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(v,`${path}.${k}`);}
}
function assertSameCompany(company_id,value,label){
 if(value?.company_id!=null&&String(value.company_id)!==company_id)throw new Error('cross-company-certification-evidence-denied');
 if(Array.isArray(value))for(const row of value)assertSameCompany(company_id,row,label);
}
function assertNeutral(value,label){
 if(!value||typeof value!=='object')return;
 if(value.execution_permitted===true||value.direct_mutation===true||value.grants_authority===true||value.authority_granted===true||value.authority_effect===true)throw new Error('execution-capable-evidence-denied');
}
export function buildSchedulingCertification(input={}){
 rejectLegacy(input);
 const company_id=text(input.company_id,'company-id');
 const claim_id=text(input.claim_id,'claim-id');
 const passes=[...new Set(list(input.passes_completed).map(Number).filter(Number.isInteger))].sort((a,b)=>a-b);
 if(passes.length!==12||passes.some((v,i)=>v!==i+1))throw new Error('all-12-passes-required');
 const manager_baseline_merge=Number(input.manager_baseline_merge);
 if(!Number.isInteger(manager_baseline_merge)||manager_baseline_merge<1)throw new Error('manager-baseline-merge-required');
 const evidenceKeys=['batch','events','metrics','trace','approval'];
 for(const key of evidenceKeys){const value=input[key];assertSameCompany(company_id,value,key);if(Array.isArray(value)){for(const row of value)assertNeutral(row,key);}else assertNeutral(value,key);}
 const checks=Object.freeze({
  all_12_passes:true,
  company_id_only:true,
  batch_projection:input.batch?.schema==='titan.scheduling.adversarial-batch.v1',
  observability_events:list(input.events).length>0&&list(input.events).every(e=>e?.schema==='titan.observability.v1'),
  metrics_projection:input.metrics?.schema==='titan.scheduling.metrics.v1',
  trace_projection:input.trace?.schema==='titan.scheduling.trace.v1',
  authority_gate:input.approval?.status==='READY_FOR_GOVERNED_SUBMISSION'&&input.approval?.requires_command_bus===true&&input.approval?.execution_permitted===false&&input.approval?.grants_authority===false,
  authority_neutrality:true,
  no_direct_mutation:true,
  no_execution_permission:true,
  no_authority_grant:true,
 });
 const failed_checks=Object.freeze(Object.entries(checks).filter(([,ok])=>ok!==true).map(([name])=>name).sort());
 const ready=failed_checks.length===0;
 return Object.freeze({
  schema:'titan.scheduling.certification.v1',
  company_id,
  claim_id,
  manager_baseline_merge,
  passes_completed:Object.freeze(passes),
  passes_complete:true,
  status:ready?'READY_FOR_MANAGER_MERGE':'CERTIFICATION_FAILED',
  company_boundary:'company_id_only',
  checks,
  failed_checks,
  authority_neutrality:true,
  claim_release_recommended:ready,
  manager_convergence_required:true,
  direct_mutation:false,
  execution_permitted:false,
  authority_effect:false,
  authority_granted:false,
  grants_authority:false,
  identity_not_authority:true,
 });
}
