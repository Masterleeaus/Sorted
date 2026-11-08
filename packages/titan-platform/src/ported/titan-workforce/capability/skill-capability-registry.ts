// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/capability/skill-capability-registry.mjs
const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const uniq=a=>[...new Set(list(a).map(x=>clean(x)).filter(Boolean))];
const PROF={UNKNOWN:0,AWARE:1,BASIC:2,WORKING:3,PROFICIENT:4,EXPERT:5};
const normalizeLevel=v=>{
  if(typeof v==='number'&&Number.isFinite(v))return Math.max(0,Math.min(5,Math.round(v)));
  const s=clean(v,40).toUpperCase();return Object.prototype.hasOwnProperty.call(PROF,s)?PROF[s]:0;
};
const levelName=n=>Object.entries(PROF).find(([,v])=>v===n)?.[0]||'UNKNOWN';
const workerId=n=>clean(String(n?.node_id||'').replace(/^worker:/,''));
const capId=n=>clean(String(n?.node_id||'').replace(/^capability:/,''));
function assertGraph(graph,company_id){if(graph?.schema!=='titan.workforce.graph.v1'||graph?.company_id!==company_id)throw new Error('skill-capability-workforce-graph-required');}
function capabilityObjects(record={}){
  const raw=[...list(record.capabilities),...list(record.skills),...list(record.provider_capabilities)];
  return raw.map(v=>typeof v==='string'?{capability_id:v}:v).filter(v=>v&&typeof v==='object');
}
function evidenceFor(record={},capability_id){
  const pools=[...list(record.capability_evidence),...list(record.skill_evidence),...list(record.evidence)];
  return pools.filter(e=>clean(e?.capability_id||e?.skill_id||e?.capability)===capability_id).map(e=>({
    evidence_id:clean(e.evidence_id||e.id||e.ref||e.uri),
    kind:clean(e.kind||e.type||'evidence',80),
    issued_at:clean(e.issued_at||e.observed_at||e.created_at,80)||null,
    expires_at:clean(e.expires_at||e.valid_until,80)||null,
    source:clean(e.source||e.issuer||e.provider,120)||null,
    verified:Boolean(e.verified===true||String(e.state||'').toUpperCase()==='VERIFIED')
  })).filter(e=>e.evidence_id||e.source||e.issued_at);
}
function stateFor(entry,nowMs){
  if(entry.revoked===true)return 'REVOKED';
  if(entry.expires_at&&Number.isFinite(Date.parse(entry.expires_at))&&Date.parse(entry.expires_at)<nowMs)return 'EXPIRED';
  if(entry.verified===true||entry.evidence.some(e=>e.verified))return 'VERIFIED';
  if(entry.evidence.length)return 'EVIDENCED';
  return 'UNVERIFIED';
}
export function buildSkillCapabilityRegistry(input={},graph={},projection={},platformRegistry=null){
  const company_id=clean(input.company_id||graph?.company_id,128);if(!validCompany(company_id))throw new Error('skill-capability-company_id-required');assertGraph(graph,company_id);
  if(projection?.company_id&&projection.company_id!==company_id)throw new Error('skill-capability-cross-company-projection-rejected');
  if(platformRegistry?.company_id&&platformRegistry.company_id!==company_id)throw new Error('skill-capability-cross-company-platform-registry-rejected');
  const nowMs=Number(input.now_ms||Date.now());
  const workers=list(graph.nodes).filter(n=>n?.kind==='worker'&&n.company_id===company_id);const roster=list(projection.roster).filter(r=>!r?.company_id||r.company_id===company_id);
  const rosterBy=new Map(roster.map(r=>[clean(r.worker_id||r.actor_id||r.agent_id||r.id),r]));
  const graphCaps=new Map();
  for(const e of list(graph.edges).filter(e=>e?.type==='HAS_CAPABILITY'&&e.company_id===company_id)){
    const w=clean(String(e.from||'').replace(/^worker:/,'')),c=clean(String(e.to||'').replace(/^capability:/,''));if(!w||!c)continue;(graphCaps.get(w)||graphCaps.set(w,new Set()).get(w)).add(c);
  }
  const platformIds=new Set();for(const e of list(platformRegistry?.entries)){platformIds.add(clean(e.id));platformIds.add(clean(e.registry_id));for(const c of list(e.capabilities))platformIds.add(clean(c));}
  const worker_capabilities=[];
  for(const node of workers){
    const worker_id=workerId(node),record=rosterBy.get(worker_id)||{};const objs=capabilityObjects(record);const byId=new Map(objs.map(o=>[clean(o.capability_id||o.skill_id||o.id||o.name),o]).filter(([id])=>id));
    const ids=new Set([...(graphCaps.get(worker_id)||[]),...byId.keys()]);
    for(const capability_id of [...ids].sort()){
      const o=byId.get(capability_id)||{};const evidence=evidenceFor(record,capability_id);const proficiency=normalizeLevel(o.proficiency??o.level??o.rating??record?.capability_proficiency?.[capability_id]);
      const expires_at=clean(o.expires_at||o.valid_until,80)||evidence.map(e=>e.expires_at).filter(Boolean).sort()[0]||null;
      const row={worker_id,capability_id,platform_registry_known:platformIds.size?platformIds.has(capability_id):null,proficiency,proficiency_level:levelName(proficiency),evidence,verified:Boolean(o.verified===true),revoked:Boolean(o.revoked===true),expires_at,sources:uniq([...(graphCaps.get(worker_id)?.has(capability_id)?['canonical-workforce-graph']:[]),...(byId.has(capability_id)?['workforce-roster']:[])]),grants_authority:false};
      row.verification_state=stateFor(row,nowMs);worker_capabilities.push(row);
    }
  }
  const reqMeta=new Map();for(const a of list(projection.assignments).filter(a=>!a?.company_id||a.company_id===company_id)){
    for(const r of list(a.required_capabilities)){const o=typeof r==='string'?{capability_id:r}:r;const id=clean(o?.capability_id||o?.id||o?.name);if(!id)continue;const prior=reqMeta.get(id)||{min_proficiency:0,require_verified:false};prior.min_proficiency=Math.max(prior.min_proficiency,normalizeLevel(o.min_proficiency??o.proficiency??o.level));prior.require_verified=prior.require_verified||o.require_verified===true;reqMeta.set(id,prior);}
  }
  const graphDemand=new Map();for(const e of list(graph.edges).filter(e=>e?.type==='REQUIRES_CAPABILITY'&&e.company_id===company_id)){const id=clean(String(e.to||'').replace(/^capability:/,''));if(id)graphDemand.set(id,(graphDemand.get(id)||0)+1);}
  const requirements=[...graphDemand.entries()].map(([capability_id,demand_count])=>{const meta=reqMeta.get(capability_id)||{min_proficiency:0,require_verified:false};const holders=worker_capabilities.filter(w=>w.capability_id===capability_id&&w.verification_state!=='REVOKED'&&w.verification_state!=='EXPIRED'&&w.proficiency>=meta.min_proficiency&&(!meta.require_verified||w.verification_state==='VERIFIED'));return {capability_id,demand_count,min_proficiency:meta.min_proficiency,min_proficiency_level:levelName(meta.min_proficiency),require_verified:meta.require_verified,eligible_worker_ids:holders.map(h=>h.worker_id).sort(),eligible_holder_count:holders.length,coverage_ratio:holders.length/Math.max(1,demand_count),grants_authority:false};}).sort((a,b)=>a.capability_id.localeCompare(b.capability_id));
  const verified=worker_capabilities.filter(x=>x.verification_state==='VERIFIED').length,expired=worker_capabilities.filter(x=>x.verification_state==='EXPIRED').length,unverified=worker_capabilities.filter(x=>x.verification_state==='UNVERIFIED').length;
  return {schema:'titan.workforce.skill-capability-registry.v1',company_id,graph_revision:Number(graph.projection_revision||0),graph_cursor:graph.projection_cursor||null,worker_capabilities,requirements,summary:{worker_count:workers.length,worker_capability_count:worker_capabilities.length,verified_capabilities:verified,expired_capabilities:expired,unverified_capabilities:unverified,requirement_count:requirements.length,coverage_gaps:requirements.filter(r=>r.eligible_holder_count===0||r.coverage_ratio<1).length},platform_capability_registry_referenced:Boolean(platformRegistry),capability_presence_is_not_authority:true,proficiency_is_not_authority:true,verification_is_not_authority:true,authority_granted:false,execution_permitted:false,grants_authority:false,updated_at:nowMs};
}
export function summarizeSkillCapabilityRegistry(r={}){return {company_id:r.company_id,worker_capability_count:r.summary?.worker_capability_count||0,verified_capabilities:r.summary?.verified_capabilities||0,expired_capabilities:r.summary?.expired_capabilities||0,unverified_capabilities:r.summary?.unverified_capabilities||0,requirement_count:r.summary?.requirement_count||0,coverage_gaps:r.summary?.coverage_gaps||0,grants_authority:false};}
