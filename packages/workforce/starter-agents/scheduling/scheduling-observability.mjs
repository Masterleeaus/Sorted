import {normalizeObservation} from '../../../titan-observability/contracts.mjs';

const LEGACY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId','workspace_tenant_id','tenant_company','tenant','organisation_id','organization_id']);
const list=v=>Array.isArray(v)?v:[];
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
function rejectLegacy(value,path='scheduling-observability'){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));return;}
 for(const[k,v]of Object.entries(value)){if(LEGACY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(v,`${path}.${k}`);}
}
function assertCompany(company_id,row,label){if(row?.company_id!=null&&String(row.company_id)!==company_id)throw new Error(`cross-company-${label}-denied`);}
function stableHash(input){let h=2166136261;for(const ch of String(input)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
function safeReasons(v){return Object.freeze([...new Set(list(v).map(x=>String(x??'').trim().toUpperCase()).filter(Boolean))].sort())}
function baseContext(context={}){
 rejectLegacy(context,'context');
 return Object.freeze({
  company_id:text(context.company_id,'company-id'),
  correlation_id:text(context.correlation_id,'correlation-id'),
  operation_id:text(context.operation_id,'operation-id'),
  causation_id:String(context.causation_id??'').trim()||null,
  observed_at:Number.isFinite(Number(context.observed_at))?Number(context.observed_at):Date.now(),
 });
}
function observation({company_id,correlation_id,operation_id,causation_id,observed_at,event_id,event_type,severity='info',payload}){
 return normalizeObservation({schema:'titan.observability.v1',event_id,company_id,correlation_id,operation_id,causation_id,observed_at,event_type,component:'scheduling-agent',source:'titan-workforce-starter-scheduling',severity,payload,tags:['workforce','scheduling','operator-safe']},{company_id,clock:()=>observed_at});
}

export function projectSchedulingBatchObservations(batch={},context={}){
 rejectLegacy(batch,'batch');
 const ctx=baseContext(context);assertCompany(ctx.company_id,batch,'batch');
 if(batch?.schema!=='titan.scheduling.adversarial-batch.v1')throw new Error('scheduling-batch-schema-invalid');
 const batch_id=text(batch.batch_id,'batch-id');
 const batchEventId=`sched-obs-${stableHash(`${ctx.company_id}|${ctx.correlation_id}|${ctx.operation_id}|${batch_id}|batch`)}`;
 const recommendations=list(batch.recommendations);
 const batchReasons=safeReasons(recommendations.flatMap(r=>r.reason_codes));
 const events=[observation({
  ...ctx,event_id:batchEventId,event_type:'scheduling.batch.evaluated',severity:batchReasons.length?'warn':'info',
  payload:{batch_id,total_input_jobs:Number(batch.total_input_jobs||0),unique_jobs:Number(batch.unique_jobs||0),duplicate_work_items:Number(list(batch.duplicate_work_items).length),recommendation_count:recommendations.length,reason_codes:batchReasons,requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,direct_mutation:false,execution_permitted:false,grants_authority:false}
 })];
 for(const rec of recommendations){
  assertCompany(ctx.company_id,rec,'recommendation');
  const work_item_id=text(rec.work_item_id,'work-item-id');
  const schedule_intent_id=text(rec.schedule_intent_id,'schedule-intent-id');
  const reasons=safeReasons(rec.reason_codes);
  const suppressed=rec.recommendation_suppressed===true;
  const review=Boolean(rec.requires_human_review);
  const event_type=suppressed?'scheduling.recommendation.suppressed':review?'scheduling.recommendation.review_required':'scheduling.recommendation.ready';
  const severity=suppressed||review?'warn':'info';
  const event_id=`sched-obs-${stableHash(`${ctx.company_id}|${ctx.correlation_id}|${ctx.operation_id}|${batch_id}|${work_item_id}|${event_type}`)}`;
  events.push(observation({...ctx,event_id,event_type,severity,causation_id:batchEventId,payload:{batch_id,work_item_id,schedule_intent_id,recommended_worker_count:list(rec.recommended_worker_ids).length,excluded_worker_count:list(rec.excluded_workers).length,replay_disposition:rec.replay_disposition??null,recommendation_suppressed:suppressed,suppression_reason:rec.suppression_reason??null,reason_codes:reasons,requires_human_review:review,requires_governed_assignment:suppressed?false:true,requires_fresh_authority_evaluation:suppressed?false:true,automatic_assignment:false,direct_mutation:false,execution_permitted:false,grants_authority:false}}));
 }
 return Object.freeze(events);
}

export function summarizeSchedulingMetrics(events=[],company_id){
 const cid=text(company_id,'company-id');rejectLegacy(events,'events');
 for(const e of list(events)){if(e?.component==='scheduling-agent'||String(e?.event_type??'').startsWith('scheduling.'))assertCompany(cid,e,'observation');}
 const own=list(events).filter(e=>e?.schema==='titan.observability.v1'&&e.company_id===cid&&e.component==='scheduling-agent');
 const counts={};const reasonCounts={};
 for(const e of own){counts[e.event_type]=(counts[e.event_type]??0)+1;if(String(e.event_type).startsWith('scheduling.recommendation.'))for(const r of safeReasons(e.payload?.reason_codes))reasonCounts[r]=(reasonCounts[r]??0)+1;}
 return Object.freeze({schema:'titan.scheduling.metrics.v1',company_id:cid,total_events:own.length,batches:counts['scheduling.batch.evaluated']??0,recommendations:(counts['scheduling.recommendation.ready']??0)+(counts['scheduling.recommendation.review_required']??0)+(counts['scheduling.recommendation.suppressed']??0),ready:counts['scheduling.recommendation.ready']??0,review_required:counts['scheduling.recommendation.review_required']??0,suppressed:counts['scheduling.recommendation.suppressed']??0,stale_revision:reasonCounts.STALE_REVISION??0,duplicate_replay:reasonCounts.DUPLICATE_REPLAY??0,double_booking:reasonCounts.DOUBLE_BOOKING??0,insufficient_nonconflicting_workers:reasonCounts.INSUFFICIENT_NONCONFLICTING_WORKERS??0,reason_counts:Object.freeze({...reasonCounts}),counts:Object.freeze({...counts}),observability_not_authority:true,authority_effect:false,grants_authority:false,direct_mutation:false,execution_permitted:false});
}

export function buildSchedulingTrace(events=[],query={}){
 rejectLegacy(query,'trace-query');const cid=text(query.company_id,'company-id');const corr=String(query.correlation_id??'').trim()||null;const op=String(query.operation_id??'').trim()||null;if(!corr&&!op)throw new Error('trace-correlation-or-operation-required');
 for(const e of list(events)){if(e?.component==='scheduling-agent'||String(e?.event_type??'').startsWith('scheduling.'))assertCompany(cid,e,'observation');}
 let own=list(events).filter(e=>e?.schema==='titan.observability.v1'&&e.company_id===cid&&e.component==='scheduling-agent');if(corr)own=own.filter(e=>e.correlation_id===corr);if(op)own=own.filter(e=>e.operation_id===op);
 own=[...own].sort((a,b)=>Number(a.observed_at??0)-Number(b.observed_at??0)||String(a.event_type??'').localeCompare(String(b.event_type??''))||String(a.event_id??'').localeCompare(String(b.event_id??'')));
 return Object.freeze({schema:'titan.scheduling.trace.v1',company_id:cid,correlation_id:corr,operation_id:op,event_count:own.length,events:Object.freeze(own),observability_not_authority:true,authority_effect:false,grants_authority:false,direct_mutation:false,execution_permitted:false});
}
