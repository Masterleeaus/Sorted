import {normalizeWorkforcePresentationInput,type WorkforcePresentationInput} from "./contracts.js";
const componentFor=(position:string)=>position==="Orchestrator"?"outcome_coordination":position==="Manager"?"domain_control":position==="Specialist"?"specialist_analysis":"execution_status";
export function createWorkforceGenerativeUI(input:WorkforcePresentationInput){
 const v=normalizeWorkforcePresentationInput(input);
 const actions=(v.actions??[]).map(a=>{if(!String(a.intent??"").trim())throw new Error("governed-intent-required");return Object.freeze({...a,governed_intent:true,direct_effect:false});});
 return Object.freeze({schema:"titan.workforce.generative-ui.v1",company_id:v.company_id,agent_id:v.agent_id,canonical_name:v.canonical_name,
 surface:v.surface,position:v.position,purpose:v.purpose,semantic_component:componentFor(v.position),
 cards:Object.freeze([
  {kind:"outcomes",items:Object.freeze([...(v.outcome_ids??[])])},
  {kind:"signals",items:Object.freeze([...(v.signals??[])])},
  {kind:"capabilities",items:Object.freeze([...(v.capability_ids??[])])}
 ]),actions:Object.freeze(actions),chat_first:true,max_primary_cards:3,identity_source:"canonical-workforce-registry",
 projection_only:true,creates_identity:false,authority_neutral:true,authority_granted:false as const,execution_permitted:false as const,
 grants_authority:false as const,authority_effect:false as const});
}
