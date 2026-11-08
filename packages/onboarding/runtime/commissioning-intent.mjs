import { normalizeCompanyContext } from "@titan-zero/storage/company-context";
const required=(value,name)=>{const normalized=String(value??'').trim();if(!normalized)throw new Error(`${name}-required`);return normalized;};

export function createCommissioningIntent(input){
  const { company_id } = normalizeCompanyContext(input);
  const operations=(input.operations??[]).map((operation)=>{
    const capability_id=required(operation.capability_id,'capability_id');
    const serialized=JSON.stringify(operation.parameters??{});
    if(/(^|[_-])(shell|command|root|sudo|ssh|path)([_-]|$)/i.test(capability_id)||/\b(sudo|rm\s+-|sh\s+-c|bash\s+-c)\b/i.test(serialized))throw new Error('untyped-host-mechanics-forbidden');
    return Object.freeze({capability_id,parameters:Object.freeze({...operation.parameters})});
  });
  if(!operations.length)throw new Error('operations-required');
  return Object.freeze({schema:'titan.onboarding-commissioning-intent.v1',intent_id:required(input.intent_id,'intent_id'),company_id,idempotency_key:required(input.idempotency_key,'idempotency_key'),correlation_id:required(input.correlation_id,'correlation_id'),authority_decision_ref:required(input.authority_decision_ref,'authority_decision_ref'),provider_facets:Object.freeze((input.provider_facets??[]).map((facet)=>Object.freeze({provider:required(facet.provider,'provider'),facet:required(facet.facet,'facet'),enabled:facet.enabled===true}))),operations:Object.freeze(operations),authority_granted:false,state:'PREPARED'});
}

export function acceptCommissioningObservation(intent,observation){
  const { company_id } = normalizeCompanyContext(observation);
  if(company_id!==intent.company_id)throw new Error('company-mismatch');
  if(observation.intent_id!==intent.intent_id||observation.idempotency_key!==intent.idempotency_key)throw new Error('intent-mismatch');
  if(observation.status!=='VERIFIED')throw new Error('observed-verification-required');
  return Object.freeze({...intent,state:'VERIFIED',observed_ref:required(observation.observed_ref,'observed_ref'),authority_granted:false});
}
