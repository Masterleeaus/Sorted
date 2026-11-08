// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/divergence-intelligence.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { compareEvidenceIndependence } from './evidence-independence.js';
import { verifyTeamASeal } from './intelligence-team-a.js';
import { verifyTeamBSeal } from './intelligence-team-b.js';

export const DEFAULT_DIVERGENCE = Object.freeze({ assessments: [], updatedAt: 0 });

function bounded(items, limit=250){ return Array.isArray(items)?items.slice(-limit):[]; }
function wordList(value){ return String(value||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>2); }
function tokenSet(value){ return new Set(wordList(value)); }
function sim(a,b){ const A=tokenSet(a),B=tokenSet(b); if(!A.size&&!B.size)return 1; const i=[...A].filter(x=>B.has(x)).length; const u=new Set([...A,...B]).size; return u?i/u:0; }
function round(n){ return Math.round(Math.max(0,Math.min(1,n))*10000)/10000; }
function deepFreeze(v){ if(!v||typeof v!=='object'||Object.isFrozen(v))return v; Object.freeze(v); for(const k of Object.keys(v))deepFreeze(v[k]); return v; }
function pair(a,b){ if(!a||!b)throw new Error('divergence-two-assessments-required'); if(a.team!=='A'||b.team!=='B')throw new Error('divergence-team-pair-required'); for(const f of ['company_id','item_id','revision_id']) if(String(a[f])!==String(b[f])) throw new Error(`divergence-${f.replaceAll('_','-')}-mismatch`); }
function independence(a,b){
 const c=compareEvidenceIndependence(a.evidence_independence,b.evidence_independence);
 const A=new Set(a.evidence_independence?.independence_domains||[]),B=new Set(b.evidence_independence?.independence_domains||[]);
 const denominator=Math.max(1,Math.min(A.size,B.size));
 const overlap=c.shared_domains.length/denominator;
 return {...c,score:(A.size&&B.size)?round(1-Math.min(1,overlap)):0,overlap_ratio:round(overlap),left_domain_count:A.size,right_domain_count:B.size};
}
function contestedTerms(a,b,limit=12){
 const A=tokenSet(a),B=tokenSet(b);
 const onlyA=[...A].filter(x=>!B.has(x)).slice(0,limit);
 const onlyB=[...B].filter(x=>!A.has(x)).slice(0,limit);
 return { team_a_distinct_terms: onlyA, team_b_distinct_terms: onlyB };
}
function severityOf({disagreement,independence,confidenceA,confidenceB,risk}){
 const highConfidence=confidenceA>=0.75&&confidenceB>=0.75;
 if(disagreement>=0.72&&highConfidence&&independence>=0.7) return 'critical';
 if(disagreement>=0.55&&(highConfidence||['high','exceptional'].includes(risk))) return 'high';
 if(disagreement>=0.35) return 'medium';
 return disagreement>0.15?'low':'none';
}
export async function assessDivergence(input={}){
 const a=input.team_a||input.teamA,b=input.team_b||input.teamB; pair(a,b);
 if(!(await verifyTeamASeal(a))) throw new Error('divergence-team-a-seal-invalid');
 if(!(await verifyTeamBSeal(b))) throw new Error('divergence-team-b-seal-invalid');
 const semantic_similarity=round(sim(a.interpretation,b.interpretation));
 const disagreement_strength=round(1-semantic_similarity);
 const ind=independence(a,b);
 const risk=String(input.risk_level||a.risk_level_at_analysis||b.risk_level_at_analysis||'unknown').toLowerCase();
 const confidence_positions=deepFreeze({team_a:Number(a.confidence),team_b:Number(b.confidence),aggregation:'not-averaged',absolute_gap:round(Math.abs(Number(a.confidence)-Number(b.confidence)))});
 const severity=severityOf({disagreement:disagreement_strength,independence:ind.score,confidenceA:confidence_positions.team_a,confidenceB:confidence_positions.team_b,risk});
 const first_class_signal=severity!=='none';
 const high_confidence_conflict=confidence_positions.team_a>=0.75&&confidence_positions.team_b>=0.75&&disagreement_strength>=0.55;
 const escalation_required=first_class_signal&&(high_confidence_conflict||['high','critical'].includes(severity)||['high','exceptional'].includes(risk));
 return deepFreeze({
  schema_version:1, divergence_id:input.divergence_id||crypto.randomUUID(), company_id:a.company_id,item_id:a.item_id,revision_id:a.revision_id,
  compared_analysis_ids:[a.analysis_id,b.analysis_id], first_class_signal, severity, semantic_similarity, disagreement_strength,
  confidence_positions, independence:ind, high_confidence_conflict,
  contested:contestedTerms(a.interpretation,b.interpretation),
  interpretations:{team_a:a.interpretation,team_b:b.interpretation},
  unresolved:{team_a:[...(a.unresolved||[])],team_b:[...(b.unresolved||[])]},
  escalation:{required:escalation_required,reason:escalation_required?'Independent disagreement or high-risk conflict requires additional assurance rather than confidence averaging.':'No escalation threshold reached by this divergence signal.'},
  assessed_at:Number(input.assessed_at||timestamp())
 });
}
export async function storeDivergence(input={}){
 const result=input?.severity?structuredClone(input):await assessDivergence(input);
 return updateLocal(ZERO_KEYS.divergence,DEFAULT_DIVERGENCE,current=>{ if((current.assessments||[]).some(x=>x.divergence_id===result.divergence_id))throw new Error('divergence-id-duplicate'); return {...current,assessments:bounded([...(current.assessments||[]),result],250),updatedAt:timestamp()}; });
}
export async function getDivergenceState(){ return readLocal(ZERO_KEYS.divergence,DEFAULT_DIVERGENCE); }
