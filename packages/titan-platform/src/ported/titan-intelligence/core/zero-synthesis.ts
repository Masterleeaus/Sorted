// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/zero-synthesis.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { verifyTeamASeal } from './intelligence-team-a.js';
import { verifyTeamBSeal } from './intelligence-team-b.js';
import { verifyTeamCSeal } from './intelligence-team-c.js';
import { verifySharedBlindSpotSeal } from './shared-blind-spot.js';
import { verifyHighRiskAgreementSeal } from './high-risk-agreement-challenge.js';
export const DEFAULT_ZERO_SYNTHESIS=Object.freeze({states:[],updatedAt:0});
const bounded=(a,n=250)=>Array.isArray(a)?a.slice(-n):[];const freeze=v=>{if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const k of Object.keys(v))freeze(v[k]);return v;};
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;}
async function sha(t){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function same(a,b,c){for(const f of ['company_id','item_id','revision_id'])if(new Set([a,b,c].map(x=>String(x?.[f]||''))).size!==1)throw new Error(`zero-synthesis-${f.replaceAll('_','-')}-mismatch`);}
export async function synthesizeIntelligenceState(input={}){
 const a=input.team_a||input.teamA,b=input.team_b||input.teamB,c=input.team_c||input.teamC;same(a,b,c);
 if(!(await verifyTeamASeal(a)))throw new Error('zero-synthesis-team-a-seal-invalid');if(!(await verifyTeamBSeal(b)))throw new Error('zero-synthesis-team-b-seal-invalid');if(!(await verifyTeamCSeal(c)))throw new Error('zero-synthesis-team-c-seal-invalid');
 const blind=input.blind_spot||input.blindSpot;if(blind&&!(await verifySharedBlindSpotSeal(blind)))throw new Error('zero-synthesis-blind-spot-seal-invalid');
 const risk=String(input.risk_level||'low').toLowerCase(),agreement=input.convergence?.agreement_detected===true,high=['high','exceptional'].includes(risk);const highChallenge=input.high_risk_agreement||input.highRiskAgreement;
 if(high&&agreement){if(!highChallenge||!(await verifyHighRiskAgreementSeal(highChallenge)))throw new Error('zero-synthesis-high-risk-agreement-challenge-required');if(!highChallenge.passed)throw new Error('zero-synthesis-high-risk-agreement-challenge-not-passed');}
 const divergence=input.divergence||{},severity=input.divergence_severity||input.divergenceSeverity||{};const blindCritical=blind?.severity==='critical';
 const state=blindCritical||['critical','high'].includes(severity.severity)||divergence.high_confidence_conflict?'contested':'supported';
 const payload={schema_version:1,synthesis_id:input.synthesis_id||crypto.randomUUID(),authority:'Titan Zero',authority_scope:'sole-intelligence-synthesis',integrated_by:'titan-zero',company_id:a.company_id,item_id:a.item_id,revision_id:a.revision_id,risk_level:risk,resulting_intelligence_state:state,inputs:{team_a:{analysis_id:a.analysis_id,seal_digest:a.seal_digest,interpretation:a.interpretation,confidence:a.confidence},team_b:{analysis_id:b.analysis_id,seal_digest:b.seal_digest,interpretation:b.interpretation,confidence:b.confidence},team_c:{assurance_id:c.assurance_id,seal_digest:c.seal_digest,assurance_confidence:c.assurance_confidence},convergence:input.convergence||null,divergence:divergence||null,divergence_severity:severity||null,blind_spot:blind?{challenge_id:blind.challenge_id,seal_digest:blind.seal_digest,severity:blind.severity}:null,high_risk_agreement:highChallenge?{challenge_id:highChallenge.challenge_id,seal_digest:highChallenge.seal_digest,passed:highChallenge.passed}:null},confidence_handling:{aggregation:'not-averaged',independent_agreement_evidence:input.convergence?.confidence_evidence||null,divergence_preserved:true},unresolved:[...new Set([...(a.unresolved||[]),...(b.unresolved||[]),...(c.assessment?.unresolved||[]),...(input.unresolved||[])])].slice(0,100),authority_constraints:{team_a_may_synthesize:false,team_b_may_synthesize:false,team_c_may_synthesize:false,comparison_layers_may_synthesize:false,may_approve:false,may_authorise:false,may_apply:false},synthesized_at:Number(input.synthesized_at||timestamp())};
 const seal_digest=await sha(stable(payload));return freeze({...payload,sealed:true,seal_digest});
}
export async function verifyZeroSynthesisSeal(r){if(!r||r.sealed!==true||r.authority!=='Titan Zero')return false;const c=structuredClone(r),e=c.seal_digest;delete c.seal_digest;delete c.sealed;return e===await sha(stable(c));}
export async function storeZeroSynthesis(input={}){const r=input?.seal_digest?freeze(structuredClone(input)):await synthesizeIntelligenceState(input);if(!(await verifyZeroSynthesisSeal(r)))throw new Error('zero-synthesis-seal-invalid');return updateLocal(ZERO_KEYS.zeroSynthesis,DEFAULT_ZERO_SYNTHESIS,s=>({...s,states:bounded([...(s.states||[]),structuredClone(r)]),updatedAt:timestamp()}));}
export async function getZeroSynthesisState(){return readLocal(ZERO_KEYS.zeroSynthesis,DEFAULT_ZERO_SYNTHESIS);}
