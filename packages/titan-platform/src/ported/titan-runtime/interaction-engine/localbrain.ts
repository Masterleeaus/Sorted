// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/localbrain.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';
import { classifyDeterministicIntent } from './deterministic-intent-classifier.js';
import { routeIntentToCapabilities } from '../../titan-capabilities/intent-capability-router.js';

export const LOCALBRAIN_VERSION = 'titan.localbrain.v1';
export const DEFAULT_LOCALBRAIN_MIN_CONFIDENCE = 0.65;

function freeze(value){
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,freeze(v)])));
  return value;
}

export function reasonWithLocalBrain(input,{capability_registry=null,min_confidence=DEFAULT_LOCALBRAIN_MIN_CONFIDENCE}={}){
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new TypeError('localbrain-input-object-required');
  rejectLegacyTenantAuthorityDeep(input,'localbrain-input');
  const company_id=assertCanonicalCompanyId(input.company_id ?? input.context?.company_id);
  const context={...(input.context??{}),company_id};
  const classification=classifyDeterministicIntent({company_id,context,text:input.text ?? input.message});
  const confidence=Number(classification.intent?.confidence ?? 0);
  const needs_clarification=Boolean(classification.interpretation?.needs_clarification || !classification.resolved);
  const capability_requirement=classification.interpretation?.capability_requirements?.[0] ?? null;
  let routing=null;
  if(capability_registry){
    routing=routeIntentToCapabilities(capability_registry,{
      text:classification.normalized,
      company_id,
      preferred_kinds:['capability','action','tool','workflow'],
      risk_ceiling:input.risk_ceiling ?? null,
      workflow_goal:classification.interpretation?.goals?.[0]?.description ?? null,
      context:input.page_context ?? null,
    });
  }
  const selected_capability=routing?.selected?.id ?? capability_requirement?.capability ?? null;
  const sufficiently_confident=classification.resolved && confidence >= Number(min_confidence);
  const ready_for_decision=Boolean(sufficiently_confident && selected_capability && !needs_clarification);
  const escalation=ready_for_decision
    ? {status:'not_required',target:null,reason:null}
    : {status:input.online===true?'recommended':'deferred',target:'model-enhancement',reason:needs_clarification?'local-clarification-required':'local-confidence-insufficient'};
  const suggestions=[];
  if(ready_for_decision) suggestions.push(`Prepare decision input for capability ${selected_capability}.`);
  else if(needs_clarification) suggestions.push('Gather the missing or ambiguous information before any governed action is prepared.');
  else suggestions.push('Keep the interaction local and defer optional model enhancement until policy and connectivity allow it.');
  return freeze({
    schema:'titan.interaction.localbrain-result.v1',
    version:LOCALBRAIN_VERSION,
    company_id,
    mode:'offline-first',
    classification,
    routing,
    reasoning:{
      confidence,
      needs_clarification,
      selected_capability,
      ready_for_decision,
      execution_ready:false,
      authority_granted:false,
    },
    suggestions,
    escalation,
    audit:{cloud_used:false,local_model_used:false,deterministic_first:true},
    authority_neutral:true,
    execution_authority:false,
  });
}
