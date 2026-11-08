const req=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
export type HumanParticipant={company_id:string;human_actor_ref:string;role_ref:string;participation:"observe"|"review"|"approve"|"perform";canonical_agent_id?:never};
export function bindHumanParticipant(input:HumanParticipant){
 const anyInput=input as any;
 if(anyInput.canonical_agent_id||anyInput.agent_id)throw new Error("human-cannot-substitute-canonical-agent-identity");
 return Object.freeze({schema:"titan.workforce.human-participant.v1",company_id:req(input.company_id,"company_id"),
  human_actor_ref:req(input.human_actor_ref,"human_actor_ref"),role_ref:req(input.role_ref,"role_ref"),participation:input.participation,
  identity_kind:"human_participant" as const,is_canonical_workforce_agent:false as const,can_mint_agent_identity:false as const,
  authority_granted:false as const,grants_authority:false as const,authority_effect:false as const});
}
export function attachHumanToWork(input:{company_id:string;human:ReturnType<typeof bindHumanParticipant>;accountable_agent_id:string;correlation_id:string}){
 if(req(input.company_id,"company_id")!==input.human.company_id)throw new Error("cross-company-human-participation");
 return Object.freeze({schema:"titan.workforce.human-work-binding.v1",company_id:input.company_id,human_actor_ref:input.human.human_actor_ref,
  accountable_agent_id:req(input.accountable_agent_id,"accountable_agent_id"),correlation_id:req(input.correlation_id,"correlation_id"),
  human_is_substitute_agent:false as const,accountability_transferred:false as const,authority_granted:false as const,grants_authority:false as const,authority_effect:false as const});
}
