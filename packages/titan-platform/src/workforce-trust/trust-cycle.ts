export type TrustCycleInput = {
  company_id: string; agent_id: string; capability: string;
  variant?: string | null; workflow?: string | null; context_ref?: string | null;
  outcome_success: boolean; outcome_verified?: boolean; policy_compliant: boolean;
  human_correction: boolean; reversed: boolean;
  evidence_refs?: string[];
};
export type TrustCycleEvidence = TrustCycleInput & {
  schema: "titan.workforce.trust-cycle.v1";
  successful: boolean; verified_outcome: boolean; evidence_refs: string[];
  authority_effect: false; grants_authority: false;
};
const required=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
export function evaluateTrustCycle(input:TrustCycleInput):TrustCycleEvidence{
  const company_id=required(input.company_id,"company_id");
  const agent_id=required(input.agent_id,"agent_id");
  const capability=required(input.capability,"capability");
  const evidence_refs=[...new Set((input.evidence_refs??[]).map(v=>String(v).trim()).filter(Boolean))].sort();
  const verified_outcome=input.outcome_verified===true&&evidence_refs.length>0;
  const successful=input.outcome_success===true&&verified_outcome&&input.policy_compliant===true&&input.human_correction!==true&&input.reversed!==true;
  return Object.freeze({...input,company_id,agent_id,capability,evidence_refs,verified_outcome,successful,
    schema:"titan.workforce.trust-cycle.v1",authority_effect:false as const,grants_authority:false as const});
}
export function trustScopeKey(v:{company_id:string;agent_id:string;capability:string;variant?:string|null;workflow?:string|null;context_ref?:string|null}){
  const part=(x:unknown)=>String(x??"").trim()||"*";
  return `${required(v.company_id,"company_id")}::${required(v.agent_id,"agent_id")}::${required(v.capability,"capability")}::${part(v.variant)}::${part(v.workflow)}::${part(v.context_ref)}`;
}
