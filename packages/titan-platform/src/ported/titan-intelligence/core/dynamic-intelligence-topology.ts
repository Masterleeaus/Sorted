// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/dynamic-intelligence-topology.mjs
const LEVELS=Object.freeze({low:0,medium:1,high:2,exceptional:3});
const clamp=n=>Math.max(0,Math.min(1,Number.isFinite(Number(n))?Number(n):0));
const uniq=a=>[...new Set(a)];
export function planIntelligenceTopology(input={}){
 const company_id=String(input.company_id||'').trim(); if(!company_id) throw new Error('topology-company-id-required');
 const risk=String(input.risk_level||'low').toLowerCase(); if(!(risk in LEVELS)) throw new Error('topology-risk-level-invalid');
 const uncertainty=clamp(input.uncertainty??input.uncertainty_score??0);
 const consequence=clamp(input.consequence_potential??0); const independence=clamp(input.independence_requirement??0);
 const hardware=input.hardware||{}; const privacy=String(input.privacy_mode||'standard'); const connected=input.network_available!==false;
 const localModel=Boolean(hardware.local_model||hardware.browser_ai||hardware.ollama); const budget=Math.max(0,Number(input.cost_budget||0));
 const reasons=[]; let teams=[]; let tier='deterministic';
 const needsIndependent = LEVELS[risk]>=1 || uncertainty>=0.3 || consequence>=0.35 || independence>=0.35;
 const needsChallenge = LEVELS[risk]>=2 || uncertainty>=0.65 || consequence>=0.7 || independence>=0.75 || input.high_confidence_disagreement===true;
 if(needsIndependent){teams=['A','B'];tier='independent-a-b';reasons.push('independent-assessment-justified');}
 if(needsChallenge){teams=['A','B','C'];tier='adversarial-a-b-c';reasons.push('adversarial-assurance-required');}
 if(!needsIndependent) reasons.push('deterministic-path-sufficient');
 if(LEVELS[risk]>=2) reasons.push('high-risk-requires-team-c');
 if(input.high_confidence_disagreement===true) reasons.push('high-confidence-divergence-requires-team-c');
 const provider_order=['deterministic'];
 if(localModel) provider_order.push('local-intelligence');
 if(connected&&privacy!=='local-only'&&budget>0) provider_order.push('connected-intelligence');
 const model_required=Boolean(input.model_required===true && (localModel || (connected&&privacy!=='local-only'&&budget>0)));
 return Object.freeze({schema_version:1,company_id,item_id:input.item_id||null,revision_id:input.revision_id||null,risk_level:risk,uncertainty,consequence_potential:consequence,independence_requirement:independence,topology_tier:tier,required_teams:teams,zero_synthesis_required:teams.length>0,provider_order,model_required,resource_constraints:{local_model_available:localModel,network_available:connected,privacy_mode:privacy,cost_budget:budget},reasons:uniq(reasons),authority_constraints:{topology_may_synthesize:false,topology_may_approve:false,topology_may_authorise:false,topology_may_apply:false,sole_synthesis_authority:'Titan Zero'},minimum_justified:true});
}
