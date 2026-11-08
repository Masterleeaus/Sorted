import type { DataLocality, ExecutionReceipt } from './contracts.js';
export interface RoutingDecisionReceipt extends ExecutionReceipt {
  decision: 'selected'|'fallback'|'denied'|'queued';
  selected_target_id?: string;
  sovereignty_profile: 'maximum_privacy'|'private_hybrid'|'managed';
  fallback_from?: string;
  reason_codes: readonly string[];
}
export function createRoutingReceipt(input: Omit<RoutingDecisionReceipt,'authority_effect'>): RoutingDecisionReceipt {
  return {...input,authority_effect:false};
}
export function dataEgressForLocality(locality: DataLocality, explicitlyAuthorised=false): 'none'|'minimised'|'authorised' {
  if (locality==='device'||locality==='edge'||locality==='customer_hosted') return 'none';
  return explicitlyAuthorised?'authorised':'minimised';
}

export interface DurableDistributedReceipt extends RoutingDecisionReceipt {
  execution_id:string;
  command_id?:string;
  placement_ref?:string;
  lease_ref?:string;
  authority_recheck_ref?:string;
  command_bus_receipt_ref?:string;
  signal_ref?:string;
  assurance_ref?:string;
  governance_ref?:string;
  risk_ref?:string;
  autonomy_ref?:string;
  failover_chain:readonly string[];
}
export function createDurableDistributedReceipt(input:Omit<DurableDistributedReceipt,'authority_effect'>):DurableDistributedReceipt {
  return {...input,authority_effect:false};
}
