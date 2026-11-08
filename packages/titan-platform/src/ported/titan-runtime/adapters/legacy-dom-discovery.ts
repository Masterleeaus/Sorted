// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/adapters/legacy-dom-discovery.mjs
export const LEGACY_DOM_DISCOVERY_SCHEMA = 'titan-zero-legacy-dom-discovery/v1';
export const LEGACY_DOM_DEPRECATION_CODE = 'TITAN_LEGACY_DOM_FALLBACK_DEPRECATED';
const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
function rejectLegacyBoundary(input) { if (!input || typeof input !== 'object') return; if ('tenant_id' in input || 'tenant_company_id' in input) throw new TypeError('legacy tenant boundaries are not accepted'); }
function requireCompanyId(input) { rejectLegacyBoundary(input); const company_id=clean(input?.company_id); if (!company_id) throw new TypeError('canonical company_id is required'); return company_id; }
export function createLegacyDomDeprecationTelemetry(input = {}) {
  const company_id=requireCompanyId(input); const runtime=clean(input.runtime) ?? 'Retriever'; const reason=clean(input.reason) ?? 'typed_adapter_unavailable';
  return Object.freeze({ schema:'titan-zero-adapter-deprecation-telemetry/v1', code:LEGACY_DOM_DEPRECATION_CODE, runtime, company_id, reason, path:'legacy_dom_fallback', deprecated:true, fallback_only:true, removal_target:'v0.20.0', contains_customer_content:false, permission_state_not_inferred:true, authority_state_not_inferred:true, grants_permission:false, grants_authority:false, execution_authority:false });
}
export function prepareLegacyDomFallback(input = {}) {
  rejectLegacyBoundary(input); const company_id=requireCompanyId(input); const negotiation=input.negotiation;
  if (!negotiation || typeof negotiation !== 'object') throw new TypeError('negotiation result is required');
  if (negotiation.status === 'ready') throw new TypeError('legacy DOM fallback is prohibited when typed adapter path is ready');
  if (negotiation.fallback_allowed !== true) throw new TypeError('legacy DOM fallback was not explicitly allowed');
  const requestId=clean(input.work_id), outcome=clean(input.outcome), correlation_id=clean(input.correlation_id), operation_id=clean(input.operation_id), idempotency_key=clean(input.idempotency_key);
  if (!requestId || !outcome || !correlation_id || !operation_id || !idempotency_key) throw new TypeError('legacy fallback requires work_id, outcome, correlation_id, operation_id and idempotency_key');
  const telemetry=createLegacyDomDeprecationTelemetry({company_id,runtime:input.runtime ?? 'Retriever',reason:negotiation.fallback_reason ?? negotiation.status});
  return Object.freeze({ schema:LEGACY_DOM_DISCOVERY_SCHEMA, company_id, fallback_only:true, typed_path_preferred:true, protected_bridge_modified:false,
    transport:Object.freeze({ type:'TITAN_EXECUTE_OUTCOME', requestId, company_id, outcome, displayOutcome:clean(input.display_outcome) ?? outcome,
      context:Object.freeze({company_id,correlation_id,operation_id,idempotency_key,titan_adapter:Object.freeze({path:'legacy_dom_fallback',deprecation_code:LEGACY_DOM_DEPRECATION_CODE})})}),
    telemetry, transport_performed:false, grants_permission:false, grants_authority:false, execution_authority:false });
}
export async function submitLegacyDomFallback(input = {}, transport) {
  if (!transport || typeof transport.send !== 'function') throw new TypeError('legacy fallback transport.send is required');
  const prepared=prepareLegacyDomFallback(input); if (typeof transport.telemetry === 'function') await transport.telemetry(prepared.telemetry); const receipt=await transport.send(prepared.transport);
  return Object.freeze({ schema:'titan-zero-legacy-dom-fallback-receipt/v1', company_id:prepared.company_id, requestId:prepared.transport.requestId, transport_performed:true, telemetry_emitted:typeof transport.telemetry === 'function', receipt:receipt ?? null, deprecated_path_used:true, grants_permission:false, grants_authority:false, execution_authority:false });
}
