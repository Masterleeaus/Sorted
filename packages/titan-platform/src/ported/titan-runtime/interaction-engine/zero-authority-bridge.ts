// @ts-nocheck
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { createGovernedCapabilityIntent, dispatchGovernedCapabilityIntent } from "./capability-intent-bridge.js";

export const ZERO_AUTHORITY_BRIDGE_SCHEMA = "titan.zero.authority-bridge.v1";

function text(value:any,name:string){const result=String(value??"").trim();if(!result)throw new TypeError(`${name}-required`);return result;}

export function createZeroAuthorityRequest(command:any, context:any={}) {
  rejectLegacyTenantAuthority(context,"zero-authority-context");
  rejectLegacyTenantAuthority(command,"zero-authority-command");
  const company_id=assertCanonicalCompanyId(context.company_id??command?.metadata?.company_id);
  const intent=createGovernedCapabilityIntent(command,{...context,company_id});
  return Object.freeze({
    schema:ZERO_AUTHORITY_BRIDGE_SCHEMA,
    company_id,
    request_id:text(context.request_id??intent.trusted_context.correlation_id,"request_id"),
    intent,
    decision_required:true,
    approval_required:context.approval_required!==false,
    decision_owner:"decision-engine",
    execution_owner:"governed-capability-gateway",
    zero_role:"request_and_present",
    authority_granted:false,
    execution_authority_granted:false,
  });
}

export async function dispatchZeroAuthorityRequest(request:any, boundary:any={}) {
  if(!request||request.schema!==ZERO_AUTHORITY_BRIDGE_SCHEMA)throw new TypeError("zero-authority-request-invalid");
  rejectLegacyTenantAuthority(request,"zero-authority-request");
  const company_id=assertCanonicalCompanyId(request.company_id);
  if(request.intent?.company_id!==company_id)throw new Error("Cross-company Zero authority request rejected");
  if(request.authority_granted!==false||request.execution_authority_granted!==false)throw new Error("Zero cannot self-grant execution authority");
  if(typeof boundary.decide!=="function")throw new TypeError("canonical-decision-boundary-required");
  const decision=await boundary.decide(Object.freeze({company_id,request_id:request.request_id,intent:request.intent,approval_required:request.approval_required}));
  if(!decision?.allowed)return Object.freeze({schema:"titan.zero.authority-result.v1",company_id,request_id:request.request_id,status:"denied",reason:String(decision?.reason??"decision-denied"),authority_granted:false,execution_authority_granted:false});
  if(request.approval_required&&decision.approved!==true)return Object.freeze({schema:"titan.zero.authority-result.v1",company_id,request_id:request.request_id,status:"approval_required",decision_id:decision.decision_id??null,authority_granted:false,execution_authority_granted:false});
  if(!boundary.gateway)throw new TypeError("governed-capability-gateway-required");
  const result=await dispatchGovernedCapabilityIntent(request.intent,boundary.gateway);
  return Object.freeze({schema:"titan.zero.authority-result.v1",company_id,request_id:request.request_id,status:"executed",decision_id:decision.decision_id??null,result,authority_granted:false,execution_authority_granted:false,execution_owner:"governed-capability-gateway"});
}

export function assertZeroOfflineExecutionBoundary(value:any){
  if(!value||typeof value!=="object")throw new TypeError("zero-offline-boundary-required");
  if(value.automatic_effect_replay!==false)throw new Error("Zero offline effects must not replay automatically");
  if(value.reconnect_revalidation_required!==true)throw new Error("Zero offline replay requires authority revalidation");
  if(value.execution_authority!==false)throw new Error("Zero offline state cannot confer execution authority");
  return true;
}
