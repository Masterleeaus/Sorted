export type RuntimeCapabilityBinding={company_id:string;agent_id:string;capability_id:string};
export function normalizeCapabilityBinding(v:RuntimeCapabilityBinding){
 const company_id=String(v.company_id??"").trim(),agent_id=String(v.agent_id??"").trim(),capability_id=String(v.capability_id??"").trim();
 if(!company_id)throw new Error("company_id-required");if(!agent_id)throw new Error("agent_id-required");if(!capability_id)throw new Error("capability_id-required");
 return Object.freeze({schema:"titan.workforce.runtime-capability-binding.v1",company_id,agent_id,capability_id,
 authority_granted:false as const,execution_permitted:false as const,grants_authority:false as const,authority_effect:false as const});
}
