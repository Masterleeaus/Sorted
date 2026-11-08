import type { TrustCycleEvidence } from "./trust-cycle.js";
export type UnlockTier="proactive_specialist"|"manager"|"predictive";
export type UnlockGateInput={
 company_id:string;agent_id:string;capability:string;variant?:string|null;workflow?:string|null;context_ref?:string|null;cycles:TrustCycleEvidence[];
 required_cycles?:number;user_approved?:boolean;worker_accepted?:boolean;
 manager_approved?:boolean;governance_approved?:boolean;assurance_approved?:boolean;
};
const clamp=(n:number)=>Math.max(3,Math.min(5,Math.floor(n)));
export function evaluateUnlockEligibility(input:UnlockGateInput,tier:UnlockTier){
 const required=clamp(input.required_cycles??5);
 const same=(a:unknown,b:unknown)=>String(a??"").trim()===String(b??"").trim();
 const scoped=input.cycles.filter(c=>c.company_id===input.company_id&&c.agent_id===input.agent_id&&c.capability===input.capability&&same(c.variant,input.variant)&&same(c.workflow,input.workflow)&&same(c.context_ref,input.context_ref));
 const successful=scoped.filter(c=>c.successful).length;
 const system_unblocked=successful>=required;
 const gates:any={system_unblocked,user_approved:input.user_approved===true,worker_accepted:input.worker_accepted===true};
 if(tier==="manager"||tier==="predictive")gates.manager_approved=input.manager_approved===true;
 if(tier==="predictive"){gates.governance_approved=input.governance_approved===true;gates.assurance_approved=input.assurance_approved===true;}
 const eligible=Object.values(gates).every(Boolean);
 return Object.freeze({schema:"titan.workforce.unlock-eligibility.v1",company_id:input.company_id,agent_id:input.agent_id,
 capability:input.capability,variant:input.variant??null,workflow:input.workflow??null,context_ref:input.context_ref??null,tier,required_cycles:required,successful_cycles:successful,gates,
 eligible_for_authority_evaluation:eligible,authority_owner:"titan-autonomy",
 authority_granted:false as const,execution_permitted:false as const,authority_effect:false as const,grants_authority:false as const});
}
