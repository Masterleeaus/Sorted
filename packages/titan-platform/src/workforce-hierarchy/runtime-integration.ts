import {getHierarchyNode,validateDelegationEdge} from "./hierarchy.js";
import {prepareDelegation} from "./delegation.js";
import {createResponsibilityContract,type ResponsibilityKind} from "./responsibility.js";
import {validateRoleBoundary} from "./role-leakage.js";
import {prepareUpwardEvidence} from "./propagation.js";
import {bindHumanParticipant,attachHumanToWork,type HumanParticipant} from "./human-participant.js";
import {getWorkforceAgent} from "../workforce-registry/registry.js";

const req=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
const kindByPosition={Worker:"bounded_execution",Specialist:"complex_judgement",Manager:"outcome_family",Orchestrator:"cross_domain_coordination"} as const;

export function resolveGovernedWorkforceIdentity(company_id:string,agent_id:string){
 const company=req(company_id,"company_id"),agent=getWorkforceAgent(req(agent_id,"agent_id")),node=getHierarchyNode(agent.agent_id);
 if(agent.position!==node.position)throw new Error("registry-hierarchy-position-drift");
 return Object.freeze({schema:"titan.workforce.governed-identity.v1",company_id:company,agent_id:agent.agent_id,
  position:node.position,parent_agent_id:node.parent_agent_id,child_agent_ids:Object.freeze([...node.child_agent_ids]),
  authority_granted:false as const,grants_authority:false as const,authority_effect:false as const});
}

export function prepareGovernedDelegation(input:{company_id:string;from_agent_id:string;to_agent_id:string;capability_id:string;scope_ref:string;evidence_refs?:string[]}){
 resolveGovernedWorkforceIdentity(input.company_id,input.from_agent_id);resolveGovernedWorkforceIdentity(input.company_id,input.to_agent_id);
 validateDelegationEdge(input.from_agent_id,input.to_agent_id);
 return prepareDelegation(input);
}

export function evaluateRuntimeResponsibility(input:{company_id:string;owner_agent_id:string;actor_agent_id:string;pain_ids:string[];outcome_ids:string[];domain_refs:string[]}){
 const owner=resolveGovernedWorkforceIdentity(input.company_id,input.owner_agent_id);
 const actor=resolveGovernedWorkforceIdentity(input.company_id,input.actor_agent_id);
 const mk=(x:typeof owner)=>createResponsibilityContract({company_id:x.company_id,agent_id:x.agent_id,position:x.position as any,
  responsibility_kind:kindByPosition[x.position as keyof typeof kindByPosition] as ResponsibilityKind,pain_ids:input.pain_ids,outcome_ids:input.outcome_ids,domain_refs:input.domain_refs});
 return validateRoleBoundary(mk(owner),mk(actor));
}

export function propagateRuntimeOutcome(input:{company_id:string;source_agent_id:string;target_agent_id:string;outcome_id:string;evidence_refs:string[];correlation_id:string}){
 resolveGovernedWorkforceIdentity(input.company_id,input.source_agent_id);resolveGovernedWorkforceIdentity(input.company_id,input.target_agent_id);
 return prepareUpwardEvidence(input);
}

export function attachRuntimeHuman(input:{company_id:string;human:HumanParticipant;accountable_agent_id:string;correlation_id:string}){
 const accountable=resolveGovernedWorkforceIdentity(input.company_id,input.accountable_agent_id);
 const human=bindHumanParticipant(input.human);
 return Object.freeze({accountable,work_binding:attachHumanToWork({company_id:input.company_id,human,accountable_agent_id:accountable.agent_id,correlation_id:input.correlation_id}),
  authority_granted:false as const,grants_authority:false as const,authority_effect:false as const});
}
