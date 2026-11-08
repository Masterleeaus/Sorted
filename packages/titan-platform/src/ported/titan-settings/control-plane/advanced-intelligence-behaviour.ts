// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/advanced-intelligence-behaviour.mjs
const DEPTHS=Object.freeze(['fast','balanced','deep']);
const CLOUD=Object.freeze(['never','when-unresolved','allowed']);
const RISKS=Object.freeze(['low','medium','high','exceptional']);
const defaults=Object.freeze({
 reasoning_depth:'balanced', prefer_deterministic:true, prefer_local:true,
 cloud_escalation:'when-unresolved', minimum_confidence:0.62,
 max_challenge_rounds:2, require_independent_challenge_on_high_risk:true
});
function company(input={}){ if('tenant_id' in input||'tenant_company_id' in input) throw new Error('advanced-intelligence-company-id-legacy-alias-rejected'); const v=String(input.company_id||'').trim(); if(!v) throw new Error('advanced-intelligence-company-id-required'); return v; }
function raw(input){ return input?.settings?.advancedIntelligenceBehaviour||input?.advancedIntelligenceBehaviour||{}; }
function normalise(input={}){
 const r=raw(input); const out={...defaults,...r};
 if(!DEPTHS.includes(out.reasoning_depth)) throw new Error('advanced-intelligence-reasoning-depth-invalid');
 if(!CLOUD.includes(out.cloud_escalation)) throw new Error('advanced-intelligence-cloud-escalation-invalid');
 if(typeof out.prefer_deterministic!=='boolean'||typeof out.prefer_local!=='boolean') throw new Error('advanced-intelligence-route-preference-invalid');
 const c=Number(out.minimum_confidence); if(!Number.isFinite(c)||c<0||c>1) throw new Error('advanced-intelligence-minimum-confidence-invalid'); out.minimum_confidence=c;
 const rounds=Number(out.max_challenge_rounds); if(!Number.isInteger(rounds)||rounds<1||rounds>3) throw new Error('advanced-intelligence-challenge-rounds-invalid'); out.max_challenge_rounds=rounds;
 // Mandatory runtime safety cannot be disabled by Settings.
 out.require_independent_challenge_on_high_risk=true;
 return out;
}
export const ADVANCED_INTELLIGENCE_REASONING_DEPTHS=DEPTHS;
export const ADVANCED_INTELLIGENCE_CLOUD_ESCALATION_POLICIES=CLOUD;
export function projectAdvancedIntelligenceBehaviour(input={}){
 const company_id=company(input); const b=normalise(input);
 return Object.freeze({company_id,...b,authority_granted:false,execution_permitted:false,automatic_authority_change:false,settings_can_bypass_runtime_topology:false,settings_can_bypass_budget:false,settings_can_bypass_entitlement:false});
}
export function buildIntelligenceExecutionHints(input={}){
 const p=projectAdvancedIntelligenceBehaviour(input); const provider_preference=[];
 if(p.prefer_deterministic) provider_preference.push('deterministic');
 if(p.prefer_local) provider_preference.push('local-intelligence');
 provider_preference.push('connected-intelligence');
 return Object.freeze({company_id:p.company_id,reasoning_depth:p.reasoning_depth,minimum_confidence:p.minimum_confidence,max_challenge_rounds:p.max_challenge_rounds,provider_preference:[...new Set(provider_preference)],cloud_escalation_policy:p.cloud_escalation,authority_granted:false,execution_permitted:false,cloud_execution_permitted:false,mandatory_high_risk_challenge:true});
}
export function evaluateIntelligenceEscalation(input={}){
 const p=projectAdvancedIntelligenceBehaviour(input); const risk=String(input.risk_level||'low').toLowerCase(); if(!RISKS.includes(risk)) throw new Error('advanced-intelligence-risk-level-invalid');
 const confidence=input.confidence==null?1:Number(input.confidence); if(!Number.isFinite(confidence)||confidence<0||confidence>1) throw new Error('advanced-intelligence-confidence-invalid');
 const unresolved=Array.isArray(input.unresolved)?input.unresolved.filter(Boolean):[]; const high=['high','exceptional'].includes(risk);
 const lowConfidence=confidence<p.minimum_confidence; const escalation_recommended=high||lowConfidence||unresolved.length>0;
 const cloudAllowed=p.cloud_escalation==='allowed'||(p.cloud_escalation==='when-unresolved'&&(lowConfidence||unresolved.length>0));
 return Object.freeze({company_id:p.company_id,risk_level:risk,confidence,unresolved_count:unresolved.length,high_risk_challenge_required:high,escalation_recommended,cloud_escalation_candidate:escalation_recommended&&cloudAllowed,authority_granted:false,execution_permitted:false,requires_runtime_provider_cost_budget_entitlement_and_authority_gates:true});
}
