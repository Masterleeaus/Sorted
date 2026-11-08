// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/shared-blind-spot.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { verifyTeamASeal } from './intelligence-team-a.js';
import { verifyTeamBSeal } from './intelligence-team-b.js';
import { verifyTeamCSeal } from './intelligence-team-c.js';

export const DEFAULT_BLIND_SPOT = Object.freeze({ assessments: [], updatedAt: 0 });
export const BLIND_SPOT_TYPES = Object.freeze([
  'correlated-assumption',
  'circular-evidence',
  'shared-model-weakness',
  'common-source-contamination'
]);

const bounded=(items,limit=250)=>Array.isArray(items)?items.slice(-limit):[];
const clamp=n=>Math.max(0,Math.min(1,Number(n)||0));
const round=n=>Math.round(clamp(n)*10000)/10000;
const deepFreeze=v=>{if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const k of Object.keys(v))deepFreeze(v[k]);return v;};
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;}
async function sha256(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function assertLineage(a,b,c){if(!a||!b||!c)throw new Error('blind-spot-a-b-c-required');if(a.team!=='A'||b.team!=='B'||c.team!=='C')throw new Error('blind-spot-team-lineage-required');for(const f of ['company_id','item_id','revision_id']){if(String(a[f])!==String(b[f])||String(a[f])!==String(c[f]))throw new Error(`blind-spot-${f.replaceAll('_','-')}-mismatch`);}if(c.source_seals?.team_a?.seal_digest!==a.seal_digest||c.source_seals?.team_b?.seal_digest!==b.seal_digest)throw new Error('blind-spot-team-c-source-seal-mismatch');}
function norm(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g,'-');}
function tokens(v){return new Set(String(v||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>2));}
function similarity(a,b){const A=tokens(a),B=tokens(b);if(!A.size&&!B.size)return 1;const i=[...A].filter(x=>B.has(x)).length,u=new Set([...A,...B]).size;return u?i/u:0;}
function contributors(x){return Array.isArray(x?.evidence_independence?.contributors)?x.evidence_independence.contributors:[];}
function evidence(x){return Array.isArray(x?.evidence)?x.evidence:[];}
function flattenStrings(value,out=[]){if(value==null)return out;if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'){out.push(String(value));return out;}if(Array.isArray(value)){for(const v of value)flattenStrings(v,out);return out;}if(typeof value==='object'){for(const v of Object.values(value))flattenStrings(v,out);return out;}return out;}
function finding(type,code,severity,evidence,explanation){return {finding_id:crypto.randomUUID(),type,code,severity,evidence:bounded(evidence,50),explanation};}
function commonSourceFindings(a,b){
 const A=contributors(a).filter(c=>c.type==='source'),B=contributors(b).filter(c=>c.type==='source'),out=[];
 for(const x of A)for(const y of B){const sameOrigin=norm(x.origin)&&norm(x.origin)===norm(y.origin);const sameDomain=norm(x.independence_domain)&&norm(x.independence_domain)===norm(y.independence_domain);if(sameOrigin||sameDomain)out.push(finding('common-source-contamination',sameOrigin?'shared-source-origin':'shared-source-domain',sameOrigin&&sameDomain?'high':'medium',[{team_a:x},{team_b:y}],sameOrigin?'Both independent paths ultimately depend on the same source origin.':'Both paths share a source independence domain, reducing true independence.'));}
 return out;
}
function modelFindings(a,b,input){
 const A=contributors(a).filter(c=>c.type==='model'),B=contributors(b).filter(c=>c.type==='model'),out=[];
 const registry=input.model_weakness_registry||{};
 for(const x of A)for(const y of B){const px=x.provenance||{},py=y.provenance||{};const sameOrigin=norm(x.origin)&&norm(x.origin)===norm(y.origin);const familyX=norm(px.model_family||px.family||x.origin),familyY=norm(py.model_family||py.family||y.origin);const sameFamily=familyX&&familyX===familyY;const sameDomain=norm(x.independence_domain)&&norm(x.independence_domain)===norm(y.independence_domain);if(sameOrigin||sameFamily||sameDomain){const weaknesses=[...(registry[familyX]||[]),...(registry[norm(x.origin)]||[])].map(String);out.push(finding('shared-model-weakness','shared-model-dependency',weaknesses.length?'high':'medium',[{team_a:x},{team_b:y},{known_weaknesses:weaknesses}],weaknesses.length?'Both paths share a model family/provider with known weaknesses.':'Both paths share a model provider, family or independence domain and may have correlated model failure modes.'));}}
 return out;
}
function assumptionFindings(a,b,c,input){
 const A=[...(input.assumptions?.team_a||[]),...(a.unresolved||[]),...(c.challenge_roles?.assumption_challenger?.findings||[])].map(String);
 const B=[...(input.assumptions?.team_b||[]),...(b.unresolved||[])].map(String);const out=[];
 const threshold=Number(input.assumption_similarity_threshold??0.62);
 for(const x of A)for(const y of B){const s=round(similarity(x,y));if(s>=threshold)out.push(finding('correlated-assumption','overlapping-assumption','medium',[{team_a:x,team_b:y,similarity:s}],'The two paths appear to rely on materially overlapping assumptions, so agreement may not be informationally independent.'));}
 const ruleA=contributors(a).filter(c=>c.type==='rule'||c.type==='memory'),ruleB=contributors(b).filter(c=>c.type==='rule'||c.type==='memory');
 for(const x of ruleA)for(const y of ruleB){if((norm(x.origin)&&norm(x.origin)===norm(y.origin))||(norm(x.independence_domain)&&norm(x.independence_domain)===norm(y.independence_domain)))out.push(finding('correlated-assumption','shared-rule-or-memory-root','high',[{team_a:x},{team_b:y}],'Both paths inherit the same rule or memory root, creating a correlated premise even when their reasoning sessions were separate.'));}
 return out;
}
function circularFindings(a,b){
 const ea=evidence(a),eb=evidence(b),ca=contributors(a),cb=contributors(b),idsA=new Set([...ea.map(x=>norm(x.evidence_id)),...ca.map(x=>norm(x.contributor_id))].filter(Boolean)),idsB=new Set([...eb.map(x=>norm(x.evidence_id)),...cb.map(x=>norm(x.contributor_id))].filter(Boolean));
 const refsA=new Set([...ea,...ca].flatMap(x=>flattenStrings(x.provenance||{})).map(norm).filter(Boolean));const refsB=new Set([...eb,...cb].flatMap(x=>flattenStrings(x.provenance||{})).map(norm).filter(Boolean));const out=[];
 const aToB=[...idsB].filter(id=>[...refsA].some(r=>r===id||r.includes(id))),bToA=[...idsA].filter(id=>[...refsB].some(r=>r===id||r.includes(id)));
 if(aToB.length&&bToA.length)out.push(finding('circular-evidence','cross-path-cycle','critical',[{team_a_refs_team_b:aToB,team_b_refs_team_a:bToA}],'Each path contains provenance references that lead back into the other path, forming a circular evidence dependency.'));
 const commonRefs=[...refsA].filter(r=>refsB.has(r)&&r.length>2);if(commonRefs.length)out.push(finding('circular-evidence','shared-provenance-root','high',[{shared_refs:commonRefs.slice(0,20)}],'Both paths resolve provenance through the same underlying reference root; apparent corroboration may therefore be duplicate evidence rather than independent evidence.'));
 return out;
}
function dedupe(findings){const seen=new Set(),out=[];for(const f of findings){const key=f.type+'|'+f.code+'|'+stable(f.evidence);if(seen.has(key))continue;seen.add(key);out.push(f);}return out;}
function score(findings){const weights={low:.2,medium:.45,high:.75,critical:1};if(!findings.length)return 0;const vals=findings.map(f=>weights[f.severity]||.3).sort((a,b)=>b-a);if(vals.length===1)return round(vals[0]);return round(vals[0]*.65+(vals.slice(1).reduce((s,x)=>s+x,0)/(vals.length-1))*.35);}
function level(s){return s>=.8?'critical':s>=.6?'high':s>=.35?'medium':s>0?'low':'none';}

export async function assessSharedBlindSpots(input={}){
 const a=input.team_a||input.teamA,b=input.team_b||input.teamB,c=input.team_c||input.teamC;assertLineage(a,b,c);
 if(!(await verifyTeamASeal(a)))throw new Error('blind-spot-team-a-seal-invalid');if(!(await verifyTeamBSeal(b)))throw new Error('blind-spot-team-b-seal-invalid');if(!(await verifyTeamCSeal(c)))throw new Error('blind-spot-team-c-seal-invalid');
 const findings=dedupe([...commonSourceFindings(a,b),...modelFindings(a,b,input),...assumptionFindings(a,b,c,input),...circularFindings(a,b)]);const blind_spot_score=score(findings),severity=level(blind_spot_score);
 const by_type=Object.fromEntries(BLIND_SPOT_TYPES.map(t=>[t,findings.filter(f=>f.type===t)]));
 const payload={schema_version:1,challenge_id:input.challenge_id||crypto.randomUUID(),company_id:a.company_id,item_id:a.item_id,revision_id:a.revision_id,source_lineage:{team_a:{analysis_id:a.analysis_id,seal_digest:a.seal_digest},team_b:{analysis_id:b.analysis_id,seal_digest:b.seal_digest},team_c:{assurance_id:c.assurance_id,seal_digest:c.seal_digest}},blind_spot_detected:findings.length>0,severity,blind_spot_score,findings,by_type,independence_effect:{should_discount_convergence:findings.some(f=>['common-source-contamination','shared-model-weakness','correlated-assumption','circular-evidence'].includes(f.type)),reason:findings.length?'Detected shared dependencies or circularity that weaken the assumption of independent corroboration.':'No tested shared dependency was detected.'},synthesis_constraints:{may_rewrite_a_b_c:false,may_approve:false,may_authorise:false,zero_synthesis_required:true},assessed_at:Number(input.assessed_at||timestamp())};
 const seal_digest=await sha256(stable(payload));return deepFreeze({...payload,sealed:true,seal_digest});
}
export async function verifySharedBlindSpotSeal(report){if(!report||report.sealed!==true)return false;const copy=structuredClone(report),expected=copy.seal_digest;delete copy.seal_digest;delete copy.sealed;return expected===await sha256(stable(copy));}
export async function storeSharedBlindSpot(input={}){const result=input?.seal_digest?deepFreeze(structuredClone(input)):await assessSharedBlindSpots(input);if(!(await verifySharedBlindSpotSeal(result)))throw new Error('blind-spot-seal-invalid');return updateLocal(ZERO_KEYS.blindSpotChallenge,DEFAULT_BLIND_SPOT,current=>{if((current.assessments||[]).some(x=>x.challenge_id===result.challenge_id))throw new Error('blind-spot-id-duplicate');return {...current,assessments:bounded([...(current.assessments||[]),structuredClone(result)],250),updatedAt:timestamp()};});}
export async function getSharedBlindSpotState(){return readLocal(ZERO_KEYS.blindSpotChallenge,DEFAULT_BLIND_SPOT);}
