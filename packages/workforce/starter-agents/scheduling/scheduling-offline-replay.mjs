const LEGACY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId','workspace_tenant_id']);
const text=(v,n)=>{const s=String(v??'').trim();if(!s&&n)throw new Error(`${n}-required`);return s||null};
const clone=v=>v==null?v:globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));
function rejectLegacy(value,path='scheduling-offline'){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));return;}
 for(const[k,v]of Object.entries(value)){if(LEGACY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(v,`${path}.${k}`);}
}
function sameCompany(company_id,value,label){if(value?.company_id!=null&&String(value.company_id)!==company_id)throw new Error(`cross-company-${label}-denied`);}
function cleanWorkers(v){return Object.freeze([...new Set((Array.isArray(v)?v:[]).map(x=>String(x??'').trim()).filter(Boolean))].sort());}

export function buildSchedulingReplayEnvelope(input={},source={}){
 rejectLegacy(input);rejectLegacy(source,'source');
 const company_id=text(input.company_id,'company-id'),operation_id=text(input.operation_id,'operation-id');
 sameCompany(company_id,source,'source');
 const kind=String(input.kind||'proposal').trim();
 if(!['proposal','accepted_assignment_reference'].includes(kind))throw new Error(`invalid-replay-kind:${kind}`);
 const base_revision=Number.isFinite(Number(input.base_revision))?Number(input.base_revision):null;
 let payload=null,accepted_assignment_reference=null;
 if(kind==='accepted_assignment_reference'){
  const assignment_id=text(source.assignment_id,'assignment-id');
  accepted_assignment_reference=Object.freeze({assignment_id,assignment_revision:Number.isFinite(Number(source.assignment_revision))?Number(source.assignment_revision):null,work_item_id:text(source.work_item_id)||null,worker_ids:cleanWorkers(source.worker_ids)});
 }else payload=clone(source);
 return Object.freeze({
  schema:'titan.scheduling.offline-replay-envelope.v1',company_id,operation_id,
  idempotency_key:`scheduling:${company_id}:${operation_id}`,payload_kind:kind,base_revision,payload,accepted_assignment_reference,
  state:'queued',requires_explicit_resume:true,automatic_effect_replay:false,effect_replay_allowed:false,replay_allowed:false,
  requires_fresh_authority_evaluation:true,requires_command_bus:true,assignment_authority_owned:false,
  execution_permitted:false,authority_granted:false,grants_authority:false,identity_not_authority:true
 });
}

export function assessSchedulingReplay(envelope={},current={}){
 rejectLegacy(envelope,'envelope');rejectLegacy(current,'current');
 if(envelope.schema!=='titan.scheduling.offline-replay-envelope.v1')throw new Error('scheduling-replay-envelope-required');
 const company_id=text(envelope.company_id,'company-id');sameCompany(company_id,current,'current-state');
 const operation_id=text(envelope.operation_id,'operation-id');
 const applied=new Set((Array.isArray(current.applied_operation_ids)?current.applied_operation_ids:[]).map(x=>String(x)));
 let disposition='REVIEW_REQUIRED';
 if(applied.has(operation_id))disposition='ALREADY_APPLIED';
 else if(envelope.base_revision==null||current.current_revision==null)disposition='REVIEW_REQUIRED';
 else if(Number(envelope.base_revision)!==Number(current.current_revision))disposition='STALE_REVISION';
 else disposition='READY_FOR_GOVERNED_RESUBMISSION';
 return Object.freeze({
  schema:'titan.scheduling.offline-replay-assessment.v1',company_id,operation_id,idempotency_key:envelope.idempotency_key,
  disposition,duplicate:disposition==='ALREADY_APPLIED',base_revision:envelope.base_revision,current_revision:current.current_revision==null?null:Number(current.current_revision),
  requires_explicit_resume:disposition!=='ALREADY_APPLIED',requires_fresh_authority_evaluation:disposition!=='ALREADY_APPLIED',
  requires_command_bus:disposition==='READY_FOR_GOVERNED_RESUBMISSION',automatic_effect_replay:false,effect_replay_allowed:false,replay_allowed:false,
  execution_permitted:false,authority_granted:false,grants_authority:false,assignment_authority_owned:false
 });
}
