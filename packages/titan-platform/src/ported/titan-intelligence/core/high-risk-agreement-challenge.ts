// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/high-risk-agreement-challenge.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { verifyTeamASeal } from './intelligence-team-a.js';
import { verifyTeamBSeal } from './intelligence-team-b.js';
import { verifyTeamCSeal } from './intelligence-team-c.js';
import { verifySharedBlindSpotSeal } from './shared-blind-spot.js';
export const DEFAULT_HIGH_RISK_AGREEMENT = Object.freeze({ assessments: [], updatedAt: 0 });
const bounded=(a,n=250)=>Array.isArray(a)?a.slice(-n):[]; const deepFreeze=v=>{if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const k of Object.keys(v))deepFreeze(v[k]);return v;};
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;}
async function sha256(t){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function high(r){return ['high','exceptional'].includes(String(r||'').toLowerCase());}
function assertIdentity(a,b,c,blind){for(const f of ['company_id','item_id','revision_id']){const vals=[a,b,c,blind].map(x=>String(x?.[f]??''));if(new Set(vals).size!==1)throw new Error(`high-risk-agreement-${f.replaceAll('_','-')}-mismatch`);}}
export async function challengeHighRiskAgreement(input={}){
 const a=input.team_a||input.teamA,b=input.team_b||input.teamB,c=input.team_c||input.teamC,blind=input.blind_spot||input.blindSpot,conv=input.convergence;
 if(!a||!b||!c||!blind||!conv)throw new Error('high-risk-agreement-lineage-required'); assertIdentity(a,b,c,blind);
 if(!(await verifyTeamASeal(a)))throw new Error('high-risk-agreement-team-a-seal-invalid'); if(!(await verifyTeamBSeal(b)))throw new Error('high-risk-agreement-team-b-seal-invalid'); if(!(await verifyTeamCSeal(c)))throw new Error('high-risk-agreement-team-c-seal-invalid'); if(!(await verifySharedBlindSpotSeal(blind)))throw new Error('high-risk-agreement-blind-spot-seal-invalid');
 if(!conv.agreement_detected)throw new Error('high-risk-agreement-agreement-required');
 const risk=String(input.risk_level||'low').toLowerCase(), required=high(risk);
 const teamCFindings=Object.values(c.challenge_roles||{}).flatMap(x=>x.findings||[]); const blindCritical=(blind.findings||[]).filter(x=>['high','critical'].includes(x.severity));
 const challenge_findings=[...teamCFindings,...blindCritical.map(x=>`${x.type}: ${x.detail||x.code}`),...(input.additional_challenges||[]).map(String)];
 const passed=!required || (challenge_findings.length>0 && blind.severity!=='critical' && c.synthesis_constraints?.zero_synthesis_required===true);
 const payload={schema_version:1,challenge_id:input.challenge_id||crypto.randomUUID(),company_id:a.company_id,item_id:a.item_id,revision_id:a.revision_id,risk_level:risk,agreement_classification:conv.classification,challenge_required:required,challenge_performed:true,passed,source_lineage:{team_a:a.seal_digest,team_b:b.seal_digest,team_c:c.seal_digest,blind_spot:blind.seal_digest,convergence_id:conv.convergence_id},challenge_findings:bounded(challenge_findings,100),blind_spot_severity:blind.severity,rule:'High-risk or exceptional agreement is challenged even when independent paths agree.',synthesis_constraints:{may_approve:false,may_authorise:false,may_apply:false,zero_synthesis_required:true},assessed_at:Number(input.assessed_at||timestamp())};
 const seal_digest=await sha256(stable(payload)); return deepFreeze({...payload,sealed:true,seal_digest});
}
export async function verifyHighRiskAgreementSeal(r){if(!r||r.sealed!==true)return false;const c=structuredClone(r),e=c.seal_digest;delete c.seal_digest;delete c.sealed;return e===await sha256(stable(c));}
export async function storeHighRiskAgreementChallenge(input={}){const r=input?.seal_digest?deepFreeze(structuredClone(input)):await challengeHighRiskAgreement(input);if(!(await verifyHighRiskAgreementSeal(r)))throw new Error('high-risk-agreement-seal-invalid');return updateLocal(ZERO_KEYS.highRiskAgreement,DEFAULT_HIGH_RISK_AGREEMENT,s=>({...s,assessments:bounded([...(s.assessments||[]),structuredClone(r)]),updatedAt:timestamp()}));}
export async function getHighRiskAgreementState(){return readLocal(ZERO_KEYS.highRiskAgreement,DEFAULT_HIGH_RISK_AGREEMENT);}
