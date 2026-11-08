import {normalizeWorkforcePresentationInput,type WorkforcePresentationInput} from "./contracts.js";
export function createWorkforceInteractionIntent(input:WorkforcePresentationInput){
 const v=normalizeWorkforcePresentationInput(input);
 return Object.freeze({schema:"titan.workforce.interaction-intent.v1",company_id:v.company_id,agent_id:v.agent_id,surface:v.surface,
 purpose:v.purpose,position:v.position,outcome_ids:Object.freeze([...(v.outcome_ids??[])]),pain_point_ids:Object.freeze([...(v.pain_point_ids??[])]),
 capability_ids:Object.freeze([...(v.capability_ids??[])]),projection_only:true,authority_neutral:true,
 authority_granted:false as const,execution_permitted:false as const,grants_authority:false as const,authority_effect:false as const});
}
