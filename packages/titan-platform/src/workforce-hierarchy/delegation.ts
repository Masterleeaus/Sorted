import {validateDelegationEdge} from "./hierarchy.js";
export type DelegationRequest={company_id:string;from_agent_id:string;to_agent_id:string;capability_id:string;scope_ref:string;evidence_refs?:string[]};
const req=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
export function prepareDelegation(input:DelegationRequest){
 const company_id=req(input.company_id,"company_id"),capability_id=req(input.capability_id,"capability_id"),scope_ref=req(input.scope_ref,"scope_ref");
 const edge=validateDelegationEdge(input.from_agent_id,input.to_agent_id);
 return Object.freeze({schema:"titan.workforce.delegation-request.v1",company_id,from_agent_id:edge.parent_agent_id,to_agent_id:edge.child_agent_id,
 capability_id,scope_ref,evidence_refs:Object.freeze([...(input.evidence_refs??[])]),canonical_hierarchy_verified:true,
 requires_external_authority_evaluation:true,authority_owner:"titan-autonomy",
 authority_granted:false as const,execution_permitted:false as const,grants_authority:false as const,authority_effect:false as const});
}
export function acceptDelegation(request:ReturnType<typeof prepareDelegation>,worker_accepted:boolean){
 return Object.freeze({...request,worker_accepted:worker_accepted===true,eligible_for_authority_evaluation:worker_accepted===true,
 authority_granted:false as const,execution_permitted:false as const,grants_authority:false as const,authority_effect:false as const});
}
