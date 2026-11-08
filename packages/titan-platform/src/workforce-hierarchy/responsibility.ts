export type WorkforcePosition="Orchestrator"|"Manager"|"Specialist"|"Worker";
export type ResponsibilityKind="bounded_execution"|"complex_judgement"|"outcome_family"|"cross_domain_coordination";
export type ResponsibilityContract={
 company_id:string;agent_id:string;position:WorkforcePosition;responsibility_kind:ResponsibilityKind;
 pain_ids:readonly string[];outcome_ids:readonly string[];domain_refs:readonly string[];
 authority_granted:false;grants_authority:false;authority_effect:false;
};
const expected:Record<WorkforcePosition,ResponsibilityKind>={
 Worker:"bounded_execution",Specialist:"complex_judgement",Manager:"outcome_family",Orchestrator:"cross_domain_coordination"
};
const req=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
const uniq=(xs:readonly string[]|undefined)=>Object.freeze([...new Set((xs??[]).map(x=>String(x).trim()).filter(Boolean))]);
export function createResponsibilityContract(input:Omit<ResponsibilityContract,"authority_granted"|"grants_authority"|"authority_effect">){
 const company_id=req(input.company_id,"company_id"),agent_id=req(input.agent_id,"agent_id");
 if(expected[input.position]!==input.responsibility_kind)throw new Error("workforce-responsibility-tier-mismatch");
 const pain_ids=uniq(input.pain_ids),outcome_ids=uniq(input.outcome_ids),domain_refs=uniq(input.domain_refs);
 if(!pain_ids.length&&!outcome_ids.length)throw new Error("workforce-responsibility-unowned");
 if(input.position==="Orchestrator"&&domain_refs.length<2)throw new Error("orchestrator-cross-domain-required");
 return Object.freeze({...input,company_id,agent_id,pain_ids,outcome_ids,domain_refs,
  authority_granted:false as const,grants_authority:false as const,authority_effect:false as const});
}
export function expectedResponsibilityKind(position:WorkforcePosition){return expected[position];}
