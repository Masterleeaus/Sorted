// @ts-nocheck
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from '../boundary.js';
import { canonicalSurface } from './contracts.js';
import { routeIntentToCapabilities } from '../../titan-capabilities/intent-capability-router.js';

const CAPABILITY=/^[a-z0-9][a-z0-9._:-]{2,190}$/;
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new TypeError(`${n}-required`);return s;};

export function routeInteractionCapability(registry,input,context={}){
  rejectLegacyTenantAuthority(context,'interaction-capability-context');
  const company_id=assertCanonicalCompanyId(context.company_id);
  const routed=routeIntentToCapabilities(registry,{
    text:String(input?.text??input?.intent??''),company_id,
    preferred_kinds:input?.preferred_kinds??['capability','action','workflow'],
    risk_ceiling:context.risk_ceiling??input?.risk_ceiling??null,
    limit:input?.limit??8,min_confidence:input?.min_confidence??0.55,
    context:input?.context??null,workflow_goal:input?.workflow_goal??null,agent_goal:input?.agent_goal??null,
  });
  return Object.freeze({...routed,company_id,authority_neutral:true,execution_authority_granted:false,
    requires_governed_capability_gateway:Boolean(routed.selected)});
}

export function createGovernedCapabilityIntent(command,context={}){
  rejectLegacyTenantAuthority(context,'interaction-capability-context');
  rejectLegacyTenantAuthority(command,'interaction-capability-command');
  const company_id=assertCanonicalCompanyId(context.company_id??command?.metadata?.company_id);
  if(command?.metadata?.company_id && String(command.metadata.company_id)!==company_id)throw new Error('Cross-company capability intent rejected');
  const capability=text(command?.capability,'capability');
  if(!CAPABILITY.test(capability))throw new TypeError('capability-intent-invalid');
  const actor_id=text(context.actor_id??context.user_id,'actor_id');
  const correlation_id=text(context.correlation_id??command?.metadata?.correlation_id??command?.metadata?.session_id,'correlation_id');
  const idempotency_key=text(context.idempotency_key??command?.metadata?.idempotency_key,'idempotency_key');
  return Object.freeze({
    schema:'titan.interaction.governed-capability-intent.v1',company_id,capability,
    payload:structuredClone(command?.payload??{}),
    trusted_context:Object.freeze({company_id,actor_id,actor_type:String(context.actor_type??'user'),
      roles:Object.freeze([...(context.roles??[])]),scopes:Object.freeze([...(context.scopes??context.delegated_scopes??[])]),
      source_surface:canonicalSurface(context.source_surface??context.surface??'zero'),correlation_id,
      causation_id:String(context.causation_id??command?.metadata?.causation_id??correlation_id),
      interaction_id:context.interaction_id??null,wizard_id:command?.metadata?.wizard_id??context.wizard_id??null,
      session_id:command?.metadata?.session_id??context.session_id??null,device_id:context.device_id??command?.metadata?.device_id??null,
      idempotency_key,approval_evidence:Object.freeze([...(context.approval_evidence??[])]),
    }),
    authority_neutral:true,execution_authority_granted:false,requires_governed_capability_gateway:true,
  });
}

export async function dispatchGovernedCapabilityIntent(intent,gateway){
  if(!gateway||typeof gateway.dispatch!=='function')throw new TypeError('governed-capability-gateway-required');
  rejectLegacyTenantAuthority(intent,'governed-capability-intent');
  const company_id=assertCanonicalCompanyId(intent?.company_id);
  if(intent?.trusted_context?.company_id!==company_id)throw new Error('Cross-company capability gateway dispatch rejected');
  if(intent?.requires_governed_capability_gateway!==true)throw new Error('governed-capability-gateway-marker-required');
  return gateway.dispatch(intent.capability,structuredClone(intent.payload),structuredClone(intent.trusted_context));
}
