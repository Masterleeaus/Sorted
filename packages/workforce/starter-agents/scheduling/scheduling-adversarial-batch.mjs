import {matchSchedulingCandidates} from './scheduling-matcher.mjs';
import {buildSchedulingReplayEnvelope,assessSchedulingReplay} from './scheduling-offline-replay.mjs';

const LEGACY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId','workspace_tenant_id']);
const list=v=>Array.isArray(v)?v:[];
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
function rejectLegacy(value,path='scheduling-batch'){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));return;}for(const[k,v]of Object.entries(value)){if(LEGACY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(v,`${path}.${k}`);}}
function assertCompany(company_id,row,label){if(row?.company_id!=null&&String(row.company_id)!==company_id)throw new Error(`cross-company-${label}-denied`);}
const time=v=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?n:null};
function windowOf(row){const w=row?.requested_window??row?.window??row;const starts=time(w?.starts_at),ends=time(w?.ends_at);return starts!==null&&ends!==null&&ends>starts?{starts,ends}:null;}
const overlaps=(a,b)=>a&&b&&a.starts<b.ends&&b.starts<a.ends;
function reasonCodesForWorker(worker_id,job,assignments){const jw=windowOf(job);const reasons=[];for(const a of assignments){if(String(a?.worker_id??'')!==worker_id)continue;const aw=windowOf(a);if(overlaps(jw,aw))reasons.push('DOUBLE_BOOKING');}return [...new Set(reasons)].sort();}

export function evaluateSchedulingBatch(input={}){
 rejectLegacy(input);
 const company_id=text(input.company_id,'company-id'),batch_id=text(input.batch_id,'batch-id');
 const jobs=list(input.jobs),capacity=input.capacity_snapshot??{},skills=input.skill_registry??{},availability=list(input.availability),existing=list(input.existing_assignments),replay=list(input.job_replay);
 assertCompany(company_id,capacity,'capacity');assertCompany(company_id,skills,'skill-registry');
 availability.forEach(r=>assertCompany(company_id,r,'availability'));existing.forEach(r=>assertCompany(company_id,r,'assignment'));replay.forEach(r=>assertCompany(company_id,r,'replay'));
 if(input.replay_state)assertCompany(company_id,input.replay_state,'replay-state');
 jobs.forEach(r=>assertCompany(company_id,r,'job'));
 const seen=new Set(),duplicates=[];
 const unique=[];
 for(const job of [...jobs].sort((a,b)=>String(a?.work_item_id??'').localeCompare(String(b?.work_item_id??''))||String(a?.schedule_intent_id??'').localeCompare(String(b?.schedule_intent_id??'')))){
  const id=text(job.work_item_id,'work-item-id');if(seen.has(id)){duplicates.push(id);continue;}seen.add(id);unique.push(job);
 }
 const virtual=[];const recommendations=[];
 for(const job of unique){
  const match=matchSchedulingCandidates(job,capacity,skills,availability);
  const excluded=[];const clean=[];
  for(const worker of match.eligible_workers){const worker_id=String(worker.worker_id);const reasons=reasonCodesForWorker(worker_id,job,[...existing,...virtual]);if(reasons.length)excluded.push(Object.freeze({worker_id,reason_codes:Object.freeze(reasons)}));else clean.push(worker);}
  const desired=Math.max(1,Math.floor(Number(job.crew_size??1)||1));
  const replayRow=replay.find(r=>String(r?.work_item_id??'')===String(job.work_item_id));
  let replay_disposition=null;
  if(replayRow){const env=buildSchedulingReplayEnvelope({company_id,operation_id:text(replayRow.operation_id,'operation-id'),base_revision:replayRow.base_revision,kind:'proposal'},{company_id,work_item_id:String(job.work_item_id),schedule_intent_id:String(job.schedule_intent_id),execution_permitted:false,grants_authority:false});replay_disposition=assessSchedulingReplay(env,{company_id,current_revision:input.replay_state?.current_revision,applied_operation_ids:list(input.replay_state?.applied_operation_ids)}).disposition;}
  const recommendation_suppressed=replay_disposition==='ALREADY_APPLIED';
  const chosen=recommendation_suppressed?[]:clean.slice(0,desired).map(x=>String(x.worker_id));
  if(!recommendation_suppressed)for(const worker_id of chosen)virtual.push({company_id,worker_id,work_item_id:String(job.work_item_id),requested_window:job.requested_window,source:'BATCH_RECOMMENDATION_RESERVATION_ONLY'});
  const reason_codes=[];if(match.conflict?.code)reason_codes.push(match.conflict.code);if(!recommendation_suppressed&&chosen.length<desired)reason_codes.push('INSUFFICIENT_NONCONFLICTING_WORKERS');if(replay_disposition==='STALE_REVISION')reason_codes.push('STALE_REVISION');if(replay_disposition==='ALREADY_APPLIED')reason_codes.push('DUPLICATE_REPLAY');
  recommendations.push(Object.freeze({schema:'titan.scheduling.batch-recommendation.v1',company_id,batch_id,schedule_intent_id:String(job.schedule_intent_id),work_item_id:String(job.work_item_id),recommended_worker_ids:Object.freeze(chosen),excluded_workers:Object.freeze(excluded.sort((a,b)=>a.worker_id.localeCompare(b.worker_id))),replay_disposition,recommendation_suppressed,suppression_reason:recommendation_suppressed?'DUPLICATE_REPLAY':null,reason_codes:Object.freeze([...new Set(reason_codes)].sort()),requires_human_review:!recommendation_suppressed&&(replay_disposition==='STALE_REVISION'||replay_disposition==='REVIEW_REQUIRED'||chosen.length<desired),requires_governed_assignment:!recommendation_suppressed,requires_fresh_authority_evaluation:!recommendation_suppressed,automatic_assignment:false,direct_mutation:false,execution_permitted:false,grants_authority:false}));
 }
 return Object.freeze({schema:'titan.scheduling.adversarial-batch.v1',company_id,batch_id,total_input_jobs:jobs.length,unique_jobs:unique.length,duplicate_work_items:Object.freeze(duplicates.sort()),recommendations:Object.freeze(recommendations),batch_reservations_are_advisory_only:true,requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,automatic_reschedule:false,direct_mutation:false,execution_permitted:false,authority_granted:false,grants_authority:false});
}
