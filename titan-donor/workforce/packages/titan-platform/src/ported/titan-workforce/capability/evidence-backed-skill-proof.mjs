const list=v=>Array.isArray(v)?v:[];
const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const uniq=a=>[...new Set(list(a).map(x=>clean(typeof x==='string'?x:x?.evidence_id||x?.id||x?.ref||x?.source)).filter(Boolean))].sort();

function assertRegistry(r){
  if(r?.schema!=='titan.workforce.skill-capability-registry.v1')throw new Error('skill-proof-registry-required');
  if(!clean(r.company_id,128))throw new Error('skill-proof-company_id-required');
  if(r.grants_authority!==false||r.execution_permitted!==false)throw new Error('skill-proof-unsafe-registry');
  return r;
}
function assertPerformance(p,company_id){
  if(!p)return null;
  if(p.schema!=='titan.workforce.performance-outcome-evidence.v1')throw new Error('skill-proof-performance-required');
  if(p.company_id!==company_id)throw new Error('skill-proof-cross-company-performance');
  if(p.grants_authority!==false||p.execution_permitted!==false)throw new Error('skill-proof-unsafe-performance');
  return p;
}
function assertMatrix(m,company_id){
  if(!m)return null;
  if(m.schema!=='titan.workforce.capability-matrix.v1')throw new Error('skill-proof-matrix-required');
  if(m.company_id!==company_id)throw new Error('skill-proof-cross-company-matrix');
  if(m.grants_authority!==false||m.execution_permitted!==false)throw new Error('skill-proof-unsafe-matrix');
  return m;
}
function proofState(row){
  if(row?.verification_state==='REVOKED')return 'revoked';
  if(row?.verification_state==='EXPIRED')return 'expired';
  if(row?.verification_state==='VERIFIED')return 'verified';
  if(row?.verification_state==='EVIDENCED'||list(row?.evidence).length)return 'evidenced';
  return 'unverified';
}
function proofStrength(row){
  const state=proofState(row),evidenceCount=list(row?.evidence).length;
  if(state==='revoked'||state==='expired')return 0;
  if(state==='verified')return Number(Math.min(1,0.9+Math.min(0.1,evidenceCount*0.02)).toFixed(2));
  if(state==='evidenced')return Number(Math.min(0.85,0.55+Math.min(0.3,evidenceCount*0.05)).toFixed(2));
  return row?.proficiency>0?0.2:0;
}

export function buildEvidenceBackedSkillProof(registry={},performance=null,matrix=null){
  const r=assertRegistry(registry),company_id=r.company_id,p=assertPerformance(performance,company_id),m=assertMatrix(matrix,company_id);
  const perfBy=new Map(list(p?.worker_performance).map(x=>[clean(x.worker_id,180),x]));
  const matrixBy=new Map(list(m?.workers).map(w=>[clean(w.worker_id,180),new Map(list(w.capabilities).map(c=>[clean(c.capability_id,180),c]))]));
  const rows=list(r.worker_capabilities).filter(x=>clean(x.worker_id)&&clean(x.capability_id)).map(x=>{
    const worker_id=clean(x.worker_id,180),capability_id=clean(x.capability_id,180),perf=perfBy.get(worker_id)||null,cell=matrixBy.get(worker_id)?.get(capability_id)||null;
    const evidence_refs=uniq(x.evidence);
    return {
      worker_id,capability_id,proficiency:Number(x.proficiency||0),proficiency_level:clean(x.proficiency_level,40)||'UNKNOWN',
      verification_state:clean(x.verification_state,40)||'UNVERIFIED',proof_state:proofState(x),proof_strength:proofStrength(x),
      evidence_count:evidence_refs.length,evidence_refs,
      contextual_performance_support:perf?{outcome_count:Number(perf.outcome_count||0),evidence_backed_count:Number(perf.evidence_backed_count||0),performance_score:perf.performance_score??null,confidence:perf.confidence??0}:null,
      contextual_performance_is_not_capability_verification:true,
      meets_registry_requirement:cell?.meets_registry_requirement??null,
      required_min_proficiency:cell?.required_min_proficiency??null,
      require_verified:cell?.require_verified??null,
      expired_or_revoked:['EXPIRED','REVOKED'].includes(clean(x.verification_state,40)),
      capability_presence_confers_authority:false,verification_confers_authority:false,performance_confers_authority:false,grants_authority:false
    };
  }).sort((a,b)=>a.worker_id.localeCompare(b.worker_id)||a.capability_id.localeCompare(b.capability_id));
  const workerIds=[...new Set(rows.map(x=>x.worker_id))].sort();
  const workers=workerIds.map(worker_id=>{const skills=rows.filter(x=>x.worker_id===worker_id);return {worker_id,skills,summary:{skill_count:skills.length,verified:skills.filter(x=>x.proof_state==='verified').length,evidenced:skills.filter(x=>x.proof_state==='evidenced').length,unverified:skills.filter(x=>x.proof_state==='unverified').length,expired_or_revoked:skills.filter(x=>x.expired_or_revoked).length,requirement_gaps:skills.filter(x=>x.meets_registry_requirement===false).length},worker_identity_confers_authority:false,grants_authority:false};});
  return {schema:'titan.workforce.evidence-backed-skill-proof.v1',company_id,workers,skill_proofs:rows,summary:{worker_count:workers.length,skill_proof_count:rows.length,verified_skill_proofs:rows.filter(x=>x.proof_state==='verified').length,evidenced_skill_proofs:rows.filter(x=>x.proof_state==='evidenced').length,unverified_skill_proofs:rows.filter(x=>x.proof_state==='unverified').length,invalid_skill_proofs:rows.filter(x=>x.expired_or_revoked).length,requirement_gaps:rows.filter(x=>x.meets_registry_requirement===false).length,workers_with_contextual_performance:workers.filter(w=>w.skills.some(s=>Number(s.contextual_performance_support?.evidence_backed_count||0)>0)).length},read_only:true,derived:true,performance_is_context_only:true,routing_decision:false,entitlement_decision:false,assignment_decision:false,automatic_execution:false,execution_permitted:false,grants_authority:false};
}

export function summarizeEvidenceBackedSkillProof(snapshot={}){
  if(snapshot?.schema!=='titan.workforce.evidence-backed-skill-proof.v1')throw new Error('invalid-skill-proof-snapshot');
  return {company_id:snapshot.company_id,...snapshot.summary,read_only:true,performance_is_context_only:true,grants_authority:false};
}
