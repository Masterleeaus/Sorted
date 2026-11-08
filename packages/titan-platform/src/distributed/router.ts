import type { DataLocality } from './contracts.js';
import type { PlacementCandidate, PlacementRequest } from './placement.js';
import { dataEgressForLocality, createRoutingReceipt, type RoutingDecisionReceipt } from './receipts.js';
import { selectWithFailover, selectGovernedWithFailover } from './execution.js';
import type { DistributedAuthorityDecision } from './authority.js';

export type FabricKind='edge'|'storage'|'intelligence';
export interface CrossFabricRouteRequest extends PlacementRequest { request_id:string; fabric:FabricKind; explicitly_authorised_egress?:boolean; }
export interface CrossFabricRouteDecision { target?:PlacementCandidate; receipt:RoutingDecisionReceipt; }

export function routeAcrossFabric(request:CrossFabricRouteRequest,candidates:readonly PlacementCandidate[],unavailable:ReadonlySet<string>=new Set(),now=new Date()):CrossFabricRouteDecision {
  const decision=selectWithFailover(request,candidates,unavailable);
  const target=decision.selected;
  const locality:DataLocality=target?.locality ?? 'device';
  return {target,receipt:createRoutingReceipt({company_id:request.company_id,receipt_id:`route:${request.request_id}`,capability:request.capability,locality,data_egress:dataEgressForLocality(locality,request.explicitly_authorised_egress),created_at:now.toISOString(),decision:target?(decision.fallback_from?'fallback':'selected'):(request.network==='offline'?'queued':'denied'),selected_target_id:target?.target_id,sovereignty_profile:request.profile,fallback_from:decision.fallback_from,reason_codes:[`FABRIC_${request.fabric.toUpperCase()}`,...decision.reason_codes]})};
}


export function routeGovernedAcrossFabric(request:CrossFabricRouteRequest,candidates:readonly PlacementCandidate[],authority:DistributedAuthorityDecision,unavailable:ReadonlySet<string>=new Set(),now=new Date()):CrossFabricRouteDecision {
  const decision=selectGovernedWithFailover(request,candidates,authority,unavailable);
  const target=decision.selected;
  const locality:DataLocality=target?.locality ?? 'device';
  return {target,receipt:createRoutingReceipt({company_id:request.company_id,receipt_id:`route:${request.request_id}`,capability:request.capability,locality,data_egress:dataEgressForLocality(locality,request.explicitly_authorised_egress),created_at:now.toISOString(),decision:target?(decision.fallback_from?'fallback':'selected'):(request.network==='offline'?'queued':'denied'),selected_target_id:target?.target_id,sovereignty_profile:request.profile,fallback_from:decision.fallback_from,reason_codes:[`FABRIC_${request.fabric.toUpperCase()}`,`AUTHORITY_REF:${authority.authority_ref}`,...decision.reason_codes]})};
}
