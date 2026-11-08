// @ts-nocheck
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';
import { validatePresentationMetadata } from './presentation-guard.js';

const AUTHORITY_KEYS = new Set(['execute','direct_effect','authority_granted','execution_authority_granted','permissions','entitlements','autonomy_authority']);
const EXECUTABLE_SCHEMES = /^(?:javascript|data|vbscript|file):/i;

function text(value,name){const s=String(value??'').trim();if(!s)throw new TypeError(`${name}-required`);return s;}
function walk(value,path='payload',seen=new WeakSet()){
  if(!value||typeof value!=='object') return;
  if(seen.has(value)) return; seen.add(value);
  for(const [key,item] of Object.entries(value)){
    const lower=key.toLowerCase();
    if(AUTHORITY_KEYS.has(lower) && (item===true || (Array.isArray(item)&&item.length) || (item&&typeof item==='object'&&Object.keys(item).length)))
      throw new Error(`interaction-authority-escalation-rejected:${path}.${key}`);
    if(typeof item==='string' && EXECUTABLE_SCHEMES.test(item.trim())) throw new Error(`interaction-executable-uri-rejected:${path}.${key}`);
    if(item&&typeof item==='object') walk(item,`${path}.${key}`,seen);
  }
}

/** Security gate for untrusted Interaction Engine boundary input. It validates evidence only and grants no authority. */
export function assertInteractionSecurityBoundary(input={},expected={}){
  rejectLegacyTenantAuthorityDeep(input,'interaction-security-boundary');
  rejectLegacyTenantAuthorityDeep(expected,'interaction-security-expected');
  const company_id=assertCanonicalCompanyId(input.company_id);
  if(expected.company_id && assertCanonicalCompanyId(expected.company_id)!==company_id) throw new Error('interaction-cross-company-boundary-rejected');
  walk(input);
  if(input.authority_neutral!==true) throw new Error('interaction-boundary-must-be-authority-neutral');
  return Object.freeze({schema:'titan.interaction.security-boundary.v1',company_id,accepted:true,authority_neutral:true,execution_authority_granted:false});
}

/** Rejects replay/correlation substitution before a governed action may be considered for dispatch. */
export function assertInteractionReplayBoundary(input={},expected={}){
  rejectLegacyTenantAuthorityDeep({input,expected},'interaction-replay-boundary');
  const company_id=assertCanonicalCompanyId(input.company_id);
  if(expected.company_id && assertCanonicalCompanyId(expected.company_id)!==company_id) throw new Error('interaction-replay-cross-company-rejected');
  const correlation_id=text(input.correlation_id,'correlation_id');
  const idempotency_key=text(input.idempotency_key,'idempotency_key');
  if(expected.correlation_id && text(expected.correlation_id,'expected.correlation_id')!==correlation_id) throw new Error('interaction-correlation-substitution-rejected');
  if(expected.idempotency_key && text(expected.idempotency_key,'expected.idempotency_key')!==idempotency_key) throw new Error('interaction-idempotency-substitution-rejected');
  if(input.previously_dispatched===true && input.confirmed_receipt!==true) throw new Error('interaction-replay-requires-confirmed-receipt');
  return Object.freeze({schema:'titan.interaction.replay-boundary.v1',company_id,correlation_id,idempotency_key,replay_authorized:false,fresh_authority_required:true});
}

/** Defense-in-depth validation for PresentationIntent crossing into rendering surfaces. */
export function assertInteractionPresentationBoundary(intent={},expected={}){
  assertInteractionSecurityBoundary(intent,expected);
  validatePresentationMetadata({
    semantic_components:intent?.payload?.semantic_components??[],
    data_requirements:intent?.payload?.data_requirements??[],
    visual_hints:intent?.payload?.visual_hints??{},
    actions:intent?.actions??[],
  });
  for(const action of intent.actions??[]){
    if(action?.execute===true || action?.direct_effect===true) throw new Error('interaction-presentation-direct-execution-rejected');
    if(action?.governed_intent!==true) throw new Error('interaction-presentation-action-must-be-governed-intent');
  }
  return true;
}

/** Cross-surface movement may preserve interaction context but never expands roles/capabilities/authority. */
export function assertInteractionSurfaceTransition(input={}){
  rejectLegacyTenantAuthorityDeep(input,'interaction-surface-transition');
  const company_id=assertCanonicalCompanyId(input.company_id);
  const from=text(input.from_surface,'from_surface'); const to=text(input.to_surface,'to_surface');
  const before=new Set(input.before_capabilities??[]); const after=new Set(input.after_capabilities??[]);
  for(const capability of after) if(!before.has(capability)) throw new Error(`interaction-cross-surface-capability-escalation-rejected:${capability}`);
  return Object.freeze({schema:'titan.interaction.surface-transition.v1',company_id,from_surface:from,to_surface:to,authority_expanded:false,requires_surface_policy_revalidation:from!==to});
}
