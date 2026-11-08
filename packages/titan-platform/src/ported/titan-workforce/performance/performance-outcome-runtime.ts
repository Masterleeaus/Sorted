// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/performance/performance-outcome-runtime.mjs
const clean=(v,max=240)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const nowMs=()=>Date.now();
const toTs=v=>{const n=Number(v);if(Number.isFinite(n)&&n>0)return n;const d=Date.parse(String(v||''));return Number.isFinite(d)?d:0;};
const refs=o=>[...new Set([...list(o.evidence_refs),...list(o.verification_refs),...list(o.receipt_refs),...list(o.provenance_refs)].map(x=>clean(typeof x==='string'?x:x?.id||x?.ref||x?.url,300)).filter(Boolean))];
const num=(o,keys,def=null)=>{for(const k of keys){const n=Number(o?.[k]);if(Number.isFinite(n))return n;}return def;};
function normalizedMetric(v){if(v==null)return null;const n=Number(v);if(!Number.isFinite(n))return null;if(n>1&&n<=5)return clamp(n/5);if(n>5&&n<=100)return clamp(n/100);return clamp(n);}
function workerId(o){return clean(o.worker_id||o.actor_id||o.assignee_worker_id||o.completed_by_worker_id||o.owner_worker_id,180);}
function outcomeId(o,i){return clean(o.outcome_id||o.id||o.result_id||o.work_item_id||`outcome-${i}`,220);}
function avg(values){const x=values.filter(v=>v!=null&&Number.isFinite(Number(v))).map(Number);return x.length?Number((x.reduce((a,b)=>a+b,0)/x.length).toFixed(4)):null;}
export function buildPerformanceOutcomeEvidence(input={},graph={},projection={}){
  const company_id=clean(input.company_id||graph?.company_id,128);if(!validCompany(company_id))throw new Error('performance-company_id-required');
  if(graph?.schema!=='titan.workforce.graph.v1'||graph.company_id!==company_id)throw new Error('performance-workforce-graph-required');
  if(projection?.company_id&&projection.company_id!==company_id)throw new Error('performance-cross-company-projection-rejected');
  const graphWorkers=new Set(list(graph.nodes).filter(n=>n?.kind==='worker').map(n=>clean(n.id||n.worker_id,180)).filter(Boolean));
  const source=[...list(projection.outcome_records),...list(projection.performance_outcomes),...list(projection.outcomes),...list(input.outcomes)];
  const seen=new Set(), records=[];
  source.forEach((o,i)=>{
    if(!o||typeof o!=='object')return;if(o.company_id&&o.company_id!==company_id)return;
    const worker_id=workerId(o);if(!worker_id||!graphWorkers.has(worker_id))return;
    const outcome_id=outcomeId(o,i);const dedupe=`${worker_id}:${outcome_id}`;if(seen.has(dedupe))return;seen.add(dedupe);
    const evidence_refs=refs(o);const quality=normalizedMetric(num(o,['quality_score','quality','qa_score']));const customer=normalizedMetric(num(o,['customer_score','customer_rating','customer_result_score','csat']));const business=normalizedMetric(num(o,['business_result_score','outcome_score','result_score']));
    const correction_count=Math.max(0,num(o,['correction_count','rework_count','corrections'],0));
    const promised=toTs(o.due_at||o.promised_at||o.deadline_at), completed=toTs(o.completed_at||o.finished_at||o.occurred_at||o.timestamp||o.ts);
    const on_time=typeof o.on_time==='boolean'?o.on_time:(promised&&completed?completed<=promised:null);const status=clean(o.status||o.state||'unknown',60).toLowerCase();const successful=['verified','completed','succeeded','success','recovered'].includes(status);
    const dimensions=[quality,customer,business,on_time==null?null:(on_time?1:0),successful?1:0].filter(v=>v!=null);
    const evidence_weight=evidence_refs.length?1:0.5;const base=dimensions.length?dimensions.reduce((a,b)=>a+b,0)/dimensions.length:(successful?1:0.5);const correction_penalty=Math.min(0.5,correction_count*0.1);const score=clamp((base-correction_penalty)*evidence_weight);
    records.push({schema:'titan.workforce.performance-outcome-record.v1',company_id,outcome_id,worker_id,work_item_id:clean(o.work_item_id||o.assignment_id||o.job_id,180)||null,mission_team_id:clean(o.mission_team_id,180)||null,status,quality_score:quality,customer_score:customer,business_result_score:business,on_time,correction_count,evidence_refs,evidence_backed:evidence_refs.length>0,score:Number(score.toFixed(4)),occurred_at:completed||0,provenance:{source:clean(o.source||o.provenance?.source||'workforce-projection',120),source_revision:Number(projection.projection_revision||0)},grants_authority:false,authority_effect:false});
  });
  const byWorker=new Map();for(const r of records){if(!byWorker.has(r.worker_id))byWorker.set(r.worker_id,[]);byWorker.get(r.worker_id).push(r);}
  const worker_performance=[...graphWorkers].sort().map(worker_id=>{const rows=(byWorker.get(worker_id)||[]).sort((a,b)=>b.occurred_at-a.occurred_at||a.outcome_id.localeCompare(b.outcome_id));const evidenced=rows.filter(r=>r.evidence_backed);const usable=evidenced.length?evidenced:rows;const score=usable.length?usable.reduce((a,r)=>a+r.score,0)/usable.length:null;const ontime=rows.filter(r=>r.on_time!=null);return {worker_id,outcome_count:rows.length,evidence_backed_count:evidenced.length,performance_score:score==null?null:Number(score.toFixed(4)),confidence:Number(Math.min(1,evidenced.length/5).toFixed(4)),quality_score:avg(rows.map(r=>r.quality_score)),customer_score:avg(rows.map(r=>r.customer_score)),business_result_score:avg(rows.map(r=>r.business_result_score)),on_time_rate:ontime.length?Number((ontime.filter(r=>r.on_time).length/ontime.length).toFixed(4)):null,correction_count:rows.reduce((a,r)=>a+r.correction_count,0),latest_outcome_at:rows[0]?.occurred_at||0,performance_is_authority:false,grants_authority:false};});
  const evidence_backed_records=records.filter(r=>r.evidence_backed).length;return {schema:'titan.workforce.performance-outcome-evidence.v1',company_id,graph_revision:Number(graph.projection_revision||0),graph_cursor:graph.projection_cursor||null,records,worker_performance,summary:{outcome_records:records.length,evidence_backed_records,workers_with_evidence:worker_performance.filter(w=>w.evidence_backed_count>0).length,workers_with_no_evidence:worker_performance.filter(w=>w.outcome_count===0).length,corrections:records.reduce((a,r)=>a+r.correction_count,0)},append_only_evidence_model:true,performance_is_not_authority:true,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false,updated_at:nowMs()};
}
export function performanceSignalForWorker(snapshot={},worker_id=''){const w=list(snapshot.worker_performance).find(x=>x.worker_id===worker_id);return w?{score:w.performance_score,confidence:w.confidence,evidence_count:w.evidence_backed_count}:null;}
export function summarizePerformanceOutcomeEvidence(s={}){return {company_id:s.company_id,outcome_records:s.summary?.outcome_records||0,evidence_backed_records:s.summary?.evidence_backed_records||0,workers_with_evidence:s.summary?.workers_with_evidence||0,workers_with_no_evidence:s.summary?.workers_with_no_evidence||0,corrections:s.summary?.corrections||0,performance_is_not_authority:true,grants_authority:false};}
