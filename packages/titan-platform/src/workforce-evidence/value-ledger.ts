import {normalizeVerifiedOutcome,type VerifiedOutcome} from "./contracts.js";
export function createVerifiedValueReceipt(input:VerifiedOutcome){
 const v=normalizeVerifiedOutcome(input);
 const financial=Number.isFinite(v.financial_value)?Number(v.financial_value):0;
 const risk=Number.isFinite(v.risk_cost_avoided)?Number(v.risk_cost_avoided):0;
 const minutes=Number.isFinite(v.time_saved_minutes)?Number(v.time_saved_minutes):0;
 return Object.freeze({schema:"titan.workforce.verified-value-receipt.v1",company_id:v.company_id,agent_id:v.agent_id,capability_id:v.capability_id,
 outcome_id:v.outcome_id,correlation_id:v.correlation_id,receipt_refs:v.receipt_refs,value:Object.freeze({financial_value:financial,risk_cost_avoided:risk,time_saved_minutes:minutes,currency:v.currency??null}),
 attribution_basis:"verified_outcome_and_receipts",estimated:false,authority_effect:false as const,grants_authority:false as const});
}
