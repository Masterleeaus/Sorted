export type VerifiedOutcome={
 company_id:string;agent_id:string;capability_id:string;outcome_id:string;correlation_id:string;
 receipt_refs:string[];expected_state_ref:string;verified_state_ref:string;verified:boolean;
 financial_value?:number;currency?:string;time_saved_minutes?:number;risk_cost_avoided?:number;
};
const req=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
export function normalizeVerifiedOutcome(v:VerifiedOutcome){
 const x={...v,company_id:req(v.company_id,"company_id"),agent_id:req(v.agent_id,"agent_id"),capability_id:req(v.capability_id,"capability_id"),
 outcome_id:req(v.outcome_id,"outcome_id"),correlation_id:req(v.correlation_id,"correlation_id"),expected_state_ref:req(v.expected_state_ref,"expected_state_ref"),
 verified_state_ref:req(v.verified_state_ref,"verified_state_ref"),receipt_refs:Object.freeze([...(v.receipt_refs??[])])};
 if(!x.verified||x.receipt_refs.length===0)throw new Error("verified-receipt-required");
 return Object.freeze(x);
}
