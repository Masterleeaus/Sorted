// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/adapters/adapter-negotiation.mjs
import {
  TITAN_ADAPTER_CAPABILITIES,
  TITAN_EXECUTION_ADAPTER_VERSION,
  createAdapterHello,
  negotiateAdapterCapabilities,
  negotiateAdapterVersion
} from './execution-adapter-protocol.js';

export const ADAPTER_NEGOTIATION_SCHEMA = 'titan-zero-adapter-negotiation/v1';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const list = (value) => Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : [];

function rejectLegacy(input) {
  if (!input || typeof input !== 'object') return;
  if ('tenant_id' in input || 'tenant_company_id' in input) throw new TypeError('legacy tenant boundaries are not accepted');
}

export function detectAdapterFeatures(input = {}) {
  rejectLegacy(input);
  const runtime=clean(input.runtime);
  if (!runtime) throw new TypeError('runtime is required');
  const features=Object.freeze({
    typed_adapter_hello: input.typed_adapter_hello === true,
    message_transport: input.message_transport === true,
    legacy_dom_fallback: input.legacy_dom_fallback === true,
    cancellation: input.cancellation === true,
    progress_observation: input.progress_observation === true,
    result_delivery: input.result_delivery === true
  });
  return Object.freeze({
    schema:'titan-zero-adapter-feature-detection/v1',
    runtime,
    features,
    detected_capabilities:Object.freeze([
      ...(features.message_transport ? ['work_submission'] : []),
      ...(features.progress_observation ? ['progress_observation'] : []),
      ...(features.result_delivery ? ['result_delivery'] : []),
      ...(features.cancellation ? ['cancellation'] : [])
    ]),
    discovery_grants_permission:false,
    discovery_grants_authority:false,
    execution_authority:false
  });
}

export function negotiateRuntimeAdapter(input = {}) {
  rejectLegacy(input);
  const localRuntime=clean(input.local_runtime);
  const remoteRuntime=clean(input.remote_runtime);
  if (!localRuntime || !remoteRuntime) throw new TypeError('local_runtime and remote_runtime are required');

  const localHello=createAdapterHello({
    runtime:localRuntime,
    version:input.local_version ?? TITAN_EXECUTION_ADAPTER_VERSION,
    capabilities:input.local_capabilities ?? TITAN_ADAPTER_CAPABILITIES
  });
  const remoteVersion=clean(input.remote_version);
  if (!remoteVersion) {
    return Object.freeze({
      schema:ADAPTER_NEGOTIATION_SCHEMA,
      status:'typed_adapter_unavailable',
      local_runtime:localRuntime,
      remote_runtime:remoteRuntime,
      selected_version:null,
      selected_capabilities:Object.freeze([]),
      fallback_allowed:input.legacy_fallback_available === true,
      fallback_reason:'remote_version_missing',
      capability_negotiation_grants_permission:false,
      capability_negotiation_grants_authority:false,
      execution_authority:false
    });
  }

  const version=negotiateAdapterVersion(localHello.version, remoteVersion);
  if (!version.compatible) {
    return Object.freeze({
      schema:ADAPTER_NEGOTIATION_SCHEMA,
      status:'incompatible',
      local_runtime:localRuntime,
      remote_runtime:remoteRuntime,
      selected_version:null,
      selected_capabilities:Object.freeze([]),
      fallback_allowed:input.legacy_fallback_available === true,
      fallback_reason:'major_version_incompatible',
      error:version.error,
      capability_negotiation_grants_permission:false,
      capability_negotiation_grants_authority:false,
      execution_authority:false
    });
  }

  const remoteCapabilities=list(input.remote_capabilities);
  const selected=negotiateAdapterCapabilities(localHello.capabilities,remoteCapabilities);
  const required=list(input.required_capabilities ?? ['work_submission']);
  const missing=required.filter((capability)=>!selected.includes(capability));
  const compatible=missing.length===0;

  return Object.freeze({
    schema:ADAPTER_NEGOTIATION_SCHEMA,
    status:compatible?'ready':'capability_mismatch',
    local_runtime:localRuntime,
    remote_runtime:remoteRuntime,
    selected_version:version.selected_version,
    selected_capabilities:Object.freeze(selected),
    missing_required_capabilities:Object.freeze(missing),
    fallback_allowed:!compatible && input.legacy_fallback_available === true,
    fallback_reason:compatible?null:'required_capability_missing',
    permission_state_not_inferred:true,
    authority_state_not_inferred:true,
    capability_negotiation_grants_permission:false,
    capability_negotiation_grants_authority:false,
    execution_authority:false
  });
}

export function selectAdapterPath(input = {}) {
  rejectLegacy(input);
  const negotiation=input.negotiation;
  if (!negotiation || negotiation.schema!==ADAPTER_NEGOTIATION_SCHEMA) throw new TypeError('valid negotiation result is required');

  if (negotiation.status==='ready') {
    return Object.freeze({
      path:'typed',
      reason:'compatible_version_and_required_capabilities',
      selected_version:negotiation.selected_version,
      selected_capabilities:negotiation.selected_capabilities,
      permission_granted:false,
      authority_granted:false,
      execution_authority:false
    });
  }
  if (negotiation.fallback_allowed===true) {
    return Object.freeze({
      path:'legacy_fallback',
      reason:negotiation.fallback_reason ?? negotiation.status,
      selected_version:null,
      selected_capabilities:Object.freeze([]),
      permission_granted:false,
      authority_granted:false,
      execution_authority:false
    });
  }
  return Object.freeze({
    path:'unavailable',
    reason:negotiation.fallback_reason ?? negotiation.status,
    selected_version:null,
    selected_capabilities:Object.freeze([]),
    permission_granted:false,
    authority_granted:false,
    execution_authority:false
  });
}
