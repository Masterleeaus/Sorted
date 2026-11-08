// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/learning/learning-governor-runtime.mjs
const clean=(v,max=320)=>String(v??'').trim().slice(0,max);
const arr=v=>Array.isArray(v)?v:[];
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const uniq=a=>[...new Set(arr(a).map(v=>clean(typeof v==='string'?v:v?.id||v?.ref,300)).filter(Boolean))];
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const priorityScore={LOW:1,MEDIUM:2,HIGH:3,CRITICAL:4};

function requireCompany(company_id){const id=clean(company_id,128);if(!validCompany(id))throw new Error('learning-governor-company_id-required');return id;}
function requireSameCompany(company_id,...snapshots){for(const s of snapshots){if(!s||!Object.keys(s).length)continue;if(clean(s.company_id,128)!==company_id)throw new Error('learning-governor-cross-company-rejected');}}

export function scoreLearningSignals(input={}){
  const company_id=requireCompany(input.company_id);
  const observations=arr(input.observations);
  const signals=[];
  for(const o of observations){
    if(o?.company_id&&clean(o.company_id,128)!==company_id)throw new Error('learning-governor-cross-company-observation');
    const novelty=clamp(o?.novelty); const disagreement=clamp(o?.disagreement); const uncertainty=clamp(o?.uncertainty); const impact=clamp(o?.impact);
    const recurrence=clamp((Number(o?.recurrence_count)||0)/5);
    const evidence_strength=clamp(o?.evidence_strength);
    const curiosity=clamp((novelty*.35)+(disagreement*.20)+(uncertainty*.20)+(impact*.15)+(recurrence*.10));
    const anomaly=clamp((disagreement*.30)+(uncertainty*.25)+(impact*.25)+(novelty*.10)+(recurrence*.10));
    const confidence=clamp((evidence_strength*.7)+((1-uncertainty)*.3));
    if(curiosity<0.35&&anomaly<0.35)continue;
    const score=Math.max(curiosity,anomaly);
    const priority=score>=0.85?'CRITICAL':score>=0.68?'HIGH':score>=0.50?'MEDIUM':'LOW';
    signals.push({schema:'titan.learning.signal.v1',signal_id:clean(o.signal_id||o.observation_id||`signal:${signals.length+1}`),company_id,source:clean(o.source||'unknown'),topic:clean(o.topic||'general'),curiosity:Number(curiosity.toFixed(4)),anomaly:Number(anomaly.toFixed(4)),confidence:Number(confidence.toFixed(4)),priority,evidence_refs:uniq(o.evidence_refs),requires_review:priority==='CRITICAL'||priority==='HIGH',authority_effect:false,grants_authority:false});
  }
  signals.sort((a,b)=>(priorityScore[b.priority]-priorityScore[a.priority])||Math.max(b.curiosity,b.anomaly)-Math.max(a.curiosity,a.anomaly)||a.signal_id.localeCompare(b.signal_id));
  return {schema:'titan.learning.signal-snapshot.v1',company_id,signals,summary:{count:signals.length,high_or_critical:signals.filter(s=>priorityScore[s.priority]>=3).length},authority_effect:false,grants_authority:false};
}

export function curateLearningMemory(input={}){
  const company_id=requireCompany(input.company_id);
  const candidates=arr(input.candidates);
  const max_entries=Math.max(1,Math.min(500,Number(input.max_entries)||100));
  const seen=new Set();
  const ranked=[];
  for(const c of candidates){
    if(c?.company_id&&clean(c.company_id,128)!==company_id)throw new Error('learning-governor-cross-company-memory');
    const evidence=uniq(c.evidence_refs); const provenance=uniq(c.provenance_refs);
    const id=clean(c.memory_id||c.id||''); if(!id||seen.has(id))continue;seen.add(id);
    const importance=clamp(c.importance);const usefulness=clamp(c.usefulness);const recency=clamp(c.recency);const evidence_strength=clamp(c.evidence_strength);
    const score=clamp((importance*.35)+(usefulness*.30)+(evidence_strength*.25)+(recency*.10));
    if(score<0.35||evidence.length===0)continue;
    ranked.push({memory_id:id,company_id,topic:clean(c.topic||'general'),score:Number(score.toFixed(4)),evidence_refs:evidence,provenance_refs:provenance,content_ref:clean(c.content_ref||'',500),preserve_as_replay_candidate:score>=0.75,authority_effect:false});
  }
  ranked.sort((a,b)=>b.score-a.score||a.memory_id.localeCompare(b.memory_id));
  const selected=ranked.slice(0,max_entries);
  return {schema:'titan.learning.memory-curation.v1',company_id,selected,replay_candidates:selected.filter(x=>x.preserve_as_replay_candidate).map(x=>x.memory_id),summary:{candidate_count:candidates.length,selected_count:selected.length,replay_candidate_count:selected.filter(x=>x.preserve_as_replay_candidate).length},evidence_required:true,authority_effect:false,grants_authority:false};
}

export function buildReplaySet(input={}){
  const company_id=requireCompany(input.company_id);
  const previous=arr(input.previous_core); const current=arr(input.current_examples); const max_core=Math.max(1,Math.min(500,Number(input.max_core)||200));
  const map=new Map();
  for(const item of [...previous,...current]){
    if(item?.company_id&&clean(item.company_id,128)!==company_id)throw new Error('learning-governor-cross-company-replay');
    const id=clean(item.example_id||item.id||''); if(!id)continue;
    const evidence=uniq(item.evidence_refs); if(!evidence.length)continue;
    const weight=clamp(item.weight??item.importance??0.5);
    const existing=map.get(id); if(!existing||weight>existing.weight)map.set(id,{example_id:id,company_id,weight:Number(weight.toFixed(4)),evidence_refs:evidence,content_ref:clean(item.content_ref||'',500)});
  }
  const core=[...map.values()].sort((a,b)=>b.weight-a.weight||a.example_id.localeCompare(b.example_id)).slice(0,max_core);
  return {schema:'titan.learning.replay-set.v1',company_id,core,summary:{core_count:core.length,previous_count:previous.length,current_count:current.length},purpose:'prevent-regression-and-catastrophic-forgetting',automatic_training:false,authority_effect:false,grants_authority:false};
}

export function proposeTrainingCycle(input={},signals={},curation={},replay={}){
  const company_id=requireCompany(input.company_id);requireSameCompany(company_id,signals,curation,replay);
  const min_examples=Math.max(1,Number(input.min_examples)||30); const min_hours=Math.max(1,Number(input.min_hours_between)||12);
  const now=Number(input.now_ms)||Date.now(); const last=Number(input.last_training_at_ms)||0; const hours_since=last?Math.max(0,(now-last)/3600000):Infinity;
  const example_count=Number(curation?.summary?.selected_count||0); const strong_signals=Number(signals?.summary?.high_or_critical||0); const replay_count=Number(replay?.summary?.core_count||0);
  const reasons=[];
  if(example_count<min_examples)reasons.push(`insufficient-evidence:${example_count}/${min_examples}`);
  if(hours_since<min_hours)reasons.push(`cooldown-active:${hours_since.toFixed(2)}/${min_hours}h`);
  if(strong_signals===0)reasons.push('no-high-priority-learning-signal');
  if(replay_count===0)reasons.push('no-replay-core');
  const eligible=reasons.length===0;
  const proposal={schema:'titan.learning.training-proposal.v1',proposal_id:clean(input.proposal_id||`training:${clean(input.model_or_capability||'learning')}`),company_id,target:clean(input.model_or_capability||'learning'),eligible,proposal_state:'PROPOSED',reasons,metrics:{example_count,strong_signals,replay_count,hours_since_last_training:Number.isFinite(hours_since)?Number(hours_since.toFixed(2)):null},requires_human_or_governed_review:true,automatic_training:false,automatic_model_replacement:false,automatic_production_change:false,automatic_workflow_change:false,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false};
  return proposal;
}
