export type NexusPlanState='PROPOSED'|'APPROVED'|'VERIFIED';

type Facet=Readonly<{provider:string;facet:string;available:boolean}>;

const required=(value:unknown,name:string)=>{const s=String(value??'').trim();if(!s)throw new Error(`${name}-required`);return s;};

export function resolveNexusPlan(input:Readonly<{company_id:string;plan_id:string;idempotency_key:string;configuration_revision:string;native_capabilities:readonly string[];requested_facets?:readonly Facet[]}>){
  const facets=Object.freeze([...(input.requested_facets??[])].map(f=>Object.freeze({provider:required(f.provider,'provider'),facet:required(f.facet,'facet'),available:f.available===true})).sort((a,b)=>a.provider.localeCompare(b.provider)||a.facet.localeCompare(b.facet)));
  const unavailable=facets.filter(f=>!f.available);
  if(unavailable.length)throw new Error('provider-facet-unavailable');
  return Object.freeze({schema:'titan.nexus-plan.v1',company_id:required(input.company_id,'company_id'),plan_id:required(input.plan_id,'plan_id'),idempotency_key:required(input.idempotency_key,'idempotency_key'),configuration_revision:required(input.configuration_revision,'configuration_revision'),native_capabilities:Object.freeze([...input.native_capabilities].map(String).sort()),requested_facets:facets,execution_target:'TYPED_CAPABILITY_GATEWAY',state:'PROPOSED' as const,authority_granted:false as const});
}

export function approveNexusPlan(plan:ReturnType<typeof resolveNexusPlan>,approval:Readonly<{company_id:string;approval_ref:string;configuration_revision:string}>){
  if(approval.company_id!==plan.company_id)throw new Error('company-mismatch');
  if(approval.configuration_revision!==plan.configuration_revision)throw new Error('configuration-revision-stale');
  return Object.freeze({...plan,approval_ref:required(approval.approval_ref,'approval_ref'),state:'APPROVED' as const,authority_granted:false as const});
}

export function acceptNexusVerification(plan:ReturnType<typeof approveNexusPlan>,observation:Readonly<{company_id:string;plan_id:string;idempotency_key:string;status:string;observed_ref:string}>){
  if(plan.state!=='APPROVED')throw new Error('approval-required');
  if(observation.company_id!==plan.company_id||observation.plan_id!==plan.plan_id||observation.idempotency_key!==plan.idempotency_key)throw new Error('identity-mismatch');
  if(observation.status!=='VERIFIED')throw new Error('observed-verification-required');
  return Object.freeze({...plan,observed_ref:required(observation.observed_ref,'observed_ref'),state:'VERIFIED' as const,authority_granted:false as const});
}
