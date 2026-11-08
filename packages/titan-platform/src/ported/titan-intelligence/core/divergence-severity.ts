// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/divergence-severity.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { assessDivergence } from './divergence-intelligence.js';
import { verifyTeamASeal } from './intelligence-team-a.js';
import { verifyTeamBSeal } from './intelligence-team-b.js';

export const DEFAULT_DIVERGENCE_SEVERITY = Object.freeze({ assessments: [], updatedAt: 0 });
export const DIVERGENCE_SEVERITY_WEIGHTS = Object.freeze({
  disagreement: 0.24,
  evidence_quality: 0.16,
  confidence_strength: 0.14,
  criticality: 0.16,
  independence: 0.12,
  provenance_quality: 0.08,
  consequence: 0.10
});

const bounded=(items,limit=250)=>Array.isArray(items)?items.slice(-limit):[];
const clamp=n=>Math.max(0,Math.min(1,Number(n)||0));
const round=n=>Math.round(clamp(n)*10000)/10000;
const deepFreeze=v=>{ if(!v||typeof v!=='object'||Object.isFrozen(v))return v; Object.freeze(v); for(const k of Object.keys(v))deepFreeze(v[k]); return v; };
const riskScore=r=>({low:.2,medium:.5,high:.82,exceptional:1}[String(r||'').toLowerCase()] ?? .4);

function evidenceQuality(assessment){
  const evidence=Array.isArray(assessment?.evidence)?assessment.evidence:[];
  if(!evidence.length)return 0;
  const confidences=evidence.map(e=>e?.confidence==null?.65:clamp(e.confidence));
  const minimum=Math.min(...confidences);
  const traceable=evidence.filter(e=>e?.source||e?.provenance||e?.evidence_id).length/evidence.length;
  return round(Math.sqrt(minimum*traceable));
}
function provenanceQuality(assessment){
  const ledger=assessment?.evidence_independence;
  const contributors=Array.isArray(ledger?.contributors)?ledger.contributors:[];
  if(!contributors.length)return 0;
  const traceable=contributors.filter(c=>c.origin&&c.independence_domain).length/contributors.length;
  const provenance=contributors.filter(c=>c.provenance!=null).length/contributors.length;
  const revisionBound=contributors.filter(c=>c.revision_id==null||String(c.revision_id)===String(assessment.revision_id)).length/contributors.length;
  return round((traceable*.45)+(provenance*.25)+(revisionBound*.30));
}
function level(score,hard={}){
  if(hard.exceptional || (hard.highConfidenceIndependent && score>=.72))return 'critical';
  if(score>=.72)return 'high';
  if(score>=.50)return 'medium';
  if(score>=.28)return 'low';
  return 'minimal';
}
function pair(a,b){
  if(!a||!b)throw new Error('divergence-severity-two-assessments-required');
  if(a.team!=='A'||b.team!=='B')throw new Error('divergence-severity-team-pair-required');
  for(const f of ['company_id','item_id','revision_id'])if(String(a[f])!==String(b[f]))throw new Error(`divergence-severity-${f.replaceAll('_','-')}-mismatch`);
}

export async function assessDivergenceSeverity(input={}){
  const a=input.team_a||input.teamA,b=input.team_b||input.teamB; pair(a,b);
  if(!(await verifyTeamASeal(a)))throw new Error('divergence-severity-team-a-seal-invalid');
  if(!(await verifyTeamBSeal(b)))throw new Error('divergence-severity-team-b-seal-invalid');
  const divergence=input.divergence||await assessDivergence({team_a:a,team_b:b,risk_level:input.risk_level});
  if(String(divergence.revision_id)!==String(a.revision_id))throw new Error('divergence-severity-divergence-revision-mismatch');
  const risk=String(input.risk_level||a.risk_level_at_analysis||b.risk_level_at_analysis||'unknown').toLowerCase();
  const evidenceA=evidenceQuality(a),evidenceB=evidenceQuality(b);
  const provenanceA=provenanceQuality(a),provenanceB=provenanceQuality(b);
  const confidenceA=clamp(a.confidence),confidenceB=clamp(b.confidence);
  const factors=deepFreeze({
    disagreement: round(divergence.disagreement_strength),
    evidence_quality: round(Math.min(evidenceA,evidenceB)),
    confidence_strength: round(Math.min(confidenceA,confidenceB)),
    criticality: round(input.criticality_score==null?riskScore(risk):input.criticality_score),
    independence: round(divergence.independence?.score),
    provenance_quality: round(Math.min(provenanceA,provenanceB)),
    consequence: round(input.consequence_score==null?riskScore(risk):input.consequence_score)
  });
  const weighted_components={}; let score=0;
  for(const [name,weight] of Object.entries(DIVERGENCE_SEVERITY_WEIGHTS)){ const contribution=round(factors[name]*weight); weighted_components[name]={value:factors[name],weight,contribution}; score+=factors[name]*weight; }
  score=round(score);
  const highConfidenceIndependent=factors.confidence_strength>=.75&&factors.independence>=.7&&factors.disagreement>=.55;
  const exceptional=risk==='exceptional'&&factors.disagreement>=.35;
  const severity=level(score,{highConfidenceIndependent,exceptional});
  return deepFreeze({
    schema_version:1,
    severity_id:input.severity_id||crypto.randomUUID(),
    divergence_id:divergence.divergence_id,
    company_id:a.company_id,item_id:a.item_id,revision_id:a.revision_id,
    compared_analysis_ids:[a.analysis_id,b.analysis_id],
    severity,score,
    factors,weighted_components,
    source_positions:{team_a:{confidence:confidenceA,evidence_quality:evidenceA,provenance_quality:provenanceA},team_b:{confidence:confidenceB,evidence_quality:evidenceB,provenance_quality:provenanceB},confidence_aggregation:'not-averaged'},
    escalation:{required:['high','critical'].includes(severity)||exceptional,high_confidence_independent_conflict:highConfidenceIndependent,exceptional_risk_conflict:exceptional},
    rationale:`Divergence severity is ${severity}; disagreement is weighted by conservative evidence/confidence quality, criticality, measured independence, provenance and potential consequence.`,
    assessed_at:Number(input.assessed_at||timestamp())
  });
}
export async function storeDivergenceSeverity(input={}){
  const result=input?.severity_id?structuredClone(input):await assessDivergenceSeverity(input);
  return updateLocal(ZERO_KEYS.divergenceSeverity,DEFAULT_DIVERGENCE_SEVERITY,current=>{ if((current.assessments||[]).some(x=>x.severity_id===result.severity_id))throw new Error('divergence-severity-id-duplicate'); return {...current,assessments:bounded([...(current.assessments||[]),result],250),updatedAt:timestamp()}; });
}
export async function getDivergenceSeverityState(){ return readLocal(ZERO_KEYS.divergenceSeverity,DEFAULT_DIVERGENCE_SEVERITY); }
