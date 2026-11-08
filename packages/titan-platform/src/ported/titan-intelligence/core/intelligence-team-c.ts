// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/intelligence-team-c.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { verifyTeamASeal } from './intelligence-team-a.js';
import { verifyTeamBSeal } from './intelligence-team-b.js';
import { assessConvergence } from './convergence-intelligence.js';
import { assessDivergence } from './divergence-intelligence.js';
import { assessDivergenceSeverity } from './divergence-severity.js';

export const DEFAULT_TEAM_C = Object.freeze({ assessments: [], updatedAt: 0 });
export const TEAM_C_CHALLENGE_ROLES = Object.freeze([
  'assumption-challenger',
  'authenticity-consequence-challenger',
  'specialist-assurance'
]);

const bounded=(items,limit=250)=>Array.isArray(items)?items.slice(-limit):[];
const clamp=n=>Math.max(0,Math.min(1,Number(n)||0));
const round=n=>Math.round(clamp(n)*10000)/10000;
const str=(v,code)=>{const s=v==null?'':String(v).trim();if(!s)throw new Error(code);return s;};
const deepFreeze=v=>{if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const k of Object.keys(v))deepFreeze(v[k]);return v;};
function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;}
async function sha256(text){const bytes=new TextEncoder().encode(text);const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function assertPair(a,b){if(!a||!b)throw new Error('team-c-two-assessments-required');if(a.team!=='A'||b.team!=='B')throw new Error('team-c-team-pair-required');for(const f of ['company_id','item_id','revision_id'])if(String(a[f])!==String(b[f]))throw new Error(`team-c-${f.replaceAll('_','-')}-mismatch`);}
function assertComparisonIdentity(name,value,a){if(!value)return;for(const f of ['company_id','item_id','revision_id'])if(String(value[f])!==String(a[f]))throw new Error(`team-c-${name}-${f.replaceAll('_','-')}-mismatch`);}
function evidenceSummary(a,b){
 const contributors=[...(a.evidence_independence?.contributors||[]),...(b.evidence_independence?.contributors||[])];
 const domains=contributors.map(c=>String(c.independence_domain||'')).filter(Boolean);
 const counts={};for(const d of domains)counts[d]=(counts[d]||0)+1;
 const shared=Object.entries(counts).filter(([,n])=>n>1).map(([domain,count])=>({domain,count}));
 const models=contributors.filter(c=>c.type==='model').map(c=>({id:c.contributor_id,origin:c.origin,domain:c.independence_domain}));
 const sources=contributors.filter(c=>c.type==='source').map(c=>({id:c.contributor_id,origin:c.origin,domain:c.independence_domain}));
 return {contributor_count:contributors.length,shared_independence_domains:shared,models,sources};
}
function roleFindings(input,combined){
 const supplied=input.challenge_findings||{};
 const assumption=[...(supplied.assumptions||[])].map(String);
 const authenticity=[...(supplied.authenticity||[])].map(String);
 const specialist=[...(supplied.specialist||[])].map(String);
 if(combined.convergence.classification==='correlated-convergence') assumption.push('Agreement may be inflated by correlated dependencies; treat it as non-independent corroboration.');
 if(combined.divergence.first_class_signal) assumption.push('Independent paths disagree; preserve the conflict and identify the disputed premise before synthesis.');
 if(combined.evidence.shared_independence_domains.length) authenticity.push('Shared contributor domains are present and require contamination/correlation review.');
 if(combined.divergence_severity.escalation?.required) specialist.push('Divergence severity requires additional specialist assurance before consequential processing.');
 if(!assumption.length) assumption.push('No explicit assumption failure detected; challenge hidden common premises before accepting convergence.');
 if(!authenticity.length) authenticity.push('No explicit authenticity failure detected; verify source origin, freshness and non-circular provenance.');
 if(!specialist.length) specialist.push('No mandatory escalation detected; retain unresolved issues and consequence checks for Zero synthesis.');
 return {
  assumption_challenger:{role:'assumption-challenger',findings:bounded(assumption,50)},
  authenticity_consequence_challenger:{role:'authenticity-consequence-challenger',findings:bounded(authenticity,50)},
  specialist_assurance:{role:'specialist-assurance',findings:bounded(specialist,50)}
 };
}

export async function createTeamCAssurance(input={}){
 const a=input.team_a||input.teamA,b=input.team_b||input.teamB;assertPair(a,b);
 if(!(await verifyTeamASeal(a)))throw new Error('team-c-team-a-seal-invalid');
 if(!(await verifyTeamBSeal(b)))throw new Error('team-c-team-b-seal-invalid');
 const convergence=input.convergence||await assessConvergence({team_a:a,team_b:b});
 const divergence=input.divergence||await assessDivergence({team_a:a,team_b:b,risk_level:input.risk_level});
 const divergence_severity=input.divergence_severity||input.divergenceSeverity||await assessDivergenceSeverity({team_a:a,team_b:b,divergence,risk_level:input.risk_level,criticality_score:input.criticality_score,consequence_score:input.consequence_score});
 assertComparisonIdentity('convergence',convergence,a);assertComparisonIdentity('divergence',divergence,a);assertComparisonIdentity('divergence-severity',divergence_severity,a);
 const evidence=evidenceSummary(a,b);
 const combined={convergence,divergence,divergence_severity,evidence};
 const challenges=roleFindings(input,combined);
 const unresolved=[...new Set([...(a.unresolved||[]),...(b.unresolved||[]),...(input.unresolved||[]).map(String)])].slice(0,100);
 const assurance_confidence=round(input.assurance_confidence==null?Math.min(.95,.45+(evidence.contributor_count?0.15:0)+(divergence_severity.factors?.provenance_quality||0)*.2+(divergence_severity.factors?.evidence_quality||0)*.2):input.assurance_confidence);
 const payload={
  schema_version:1,team:'C',post_ab:true,sealed:true,authority:'assurance-only',
  company_id:a.company_id,item_id:a.item_id,revision_id:a.revision_id,
  assurance_id:str(input.assurance_id||crypto.randomUUID(),'team-c-assurance-id-required'),
  source_seals:{team_a:{analysis_id:a.analysis_id,seal_digest:a.seal_digest},team_b:{analysis_id:b.analysis_id,seal_digest:b.seal_digest}},
  comparison_refs:{convergence_id:convergence.convergence_id,divergence_id:divergence.divergence_id,severity_id:divergence_severity.severity_id},
  challenge_roles:challenges,
  evidence_assurance:{shared_independence_domains:evidence.shared_independence_domains,model_contributors:evidence.models,source_contributors:evidence.sources},
  assessment:{convergence_classification:convergence.classification,divergence_severity:divergence_severity.severity,divergence_score:divergence_severity.score,high_confidence_conflict:Boolean(divergence.high_confidence_conflict),unresolved},
  assurance_confidence,
  synthesis_constraints:{may_modify_team_a:false,may_modify_team_b:false,may_approve:false,may_authorise:false,may_apply:false,zero_synthesis_required:true},
  sealed_at:Number(input.sealed_at||timestamp())
 };
 const seal_digest=await sha256(stable(payload));
 return deepFreeze({...payload,seal_digest});
}

export async function verifyTeamCSeal(assurance){
 if(!assurance||assurance.team!=='C'||assurance.post_ab!==true||assurance.sealed!==true||assurance.authority!=='assurance-only')return false;
 const copy=structuredClone(assurance),expected=copy.seal_digest;delete copy.seal_digest;return expected===await sha256(stable(copy));
}
export async function storeTeamCAssurance(input={}){
 const result=input?.seal_digest?deepFreeze(structuredClone(input)):await createTeamCAssurance(input);
 if(!(await verifyTeamCSeal(result)))throw new Error('team-c-seal-invalid');
 return updateLocal(ZERO_KEYS.teamC,DEFAULT_TEAM_C,current=>{if((current.assessments||[]).some(x=>x.assurance_id===result.assurance_id))throw new Error('team-c-assurance-id-duplicate');return {...current,assessments:bounded([...(current.assessments||[]),structuredClone(result)],250),updatedAt:timestamp()};});
}
export async function getTeamCState(){return readLocal(ZERO_KEYS.teamC,DEFAULT_TEAM_C);}
