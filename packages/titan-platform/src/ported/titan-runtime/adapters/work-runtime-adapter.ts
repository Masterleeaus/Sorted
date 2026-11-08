// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/adapters/work-runtime-adapter.mjs
import {
  TITAN_ADAPTER_CAPABILITIES,
  TITAN_ADAPTER_MESSAGE_TYPES,
  TITAN_EXECUTION_ADAPTER_VERSION,
  createAdapterEnvelope
} from './execution-adapter-protocol.js';

export const WORK_RUNTIME_ADAPTER_SCHEMA = 'titan-zero-work-runtime-adapter/v1';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function rejectLegacyBoundary(input) {
  if (!input || typeof input !== 'object') return;
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new TypeError('legacy tenant boundaries are not accepted');
  }
}

export function validateExternalExecutionGate(input = {}) {
  rejectLegacyBoundary(input);
  const company_id=clean(input.company_id);
  if (!company_id) throw new TypeError('execution gate company_id is required');
  if (input.execution_allowed !== true) throw new TypeError('external execution gate must explicitly allow execution');
  const decision_id=clean(input.decision_id);
  const authority_source=clean(input.authority_source);
  const policy_version=clean(input.policy_version);
  if (!decision_id || !authority_source || !policy_version) throw new TypeError('external execution gate evidence is incomplete');
  if (input.identity_only === true || input.ai_identity_granted === true) throw new TypeError('identity cannot grant execution authority');
  return Object.freeze({
    company_id,
    execution_allowed:true,
    decision_id,
    authority_source,
    policy_version,
    approval_state:clean(input.approval_state) ?? 'policy-governed',
    externally_authorized:true
  });
}

export class WorkRuntimeAdapter {
  constructor({ runtime, version=TITAN_EXECUTION_ADAPTER_VERSION, capabilities=TITAN_ADAPTER_CAPABILITIES }={}) {
    this.runtime=clean(runtime);
    if (!this.runtime) throw new TypeError('runtime is required');
    this.version=version;
    this.capabilities=Object.freeze([...new Set(capabilities)]);
  }

  descriptor() {
    return Object.freeze({
      schema:WORK_RUNTIME_ADAPTER_SCHEMA,
      runtime:this.runtime,
      version:this.version,
      capabilities:this.capabilities,
      company_boundary:'company_id',
      identity_grants_authority:false,
      adapter_grants_authority:false,
      execution_authority:false
    });
  }

  prepareSubmission(input = {}) {
    rejectLegacyBoundary(input);
    const gate=validateExternalExecutionGate(input.execution_gate || {});
    const envelope=createAdapterEnvelope({
      type:TITAN_ADAPTER_MESSAGE_TYPES.WORK_SUBMIT,
      version:this.version,
      company_id:input.company_id,
      work_id:input.work_id,
      correlation_id:input.correlation_id,
      operation_id:input.operation_id,
      idempotency_key:input.idempotency_key,
      source:input.source ?? 'titan-work-runtime',
      context:input.context,
      payload:input.payload,
      capabilities:this.capabilities
    });
    if (gate.company_id !== envelope.company_id) throw new TypeError('execution gate company_id must match work envelope company_id');
    return Object.freeze({
      schema:'titan-zero-work-runtime-prepared-submission/v1',
      adapter:this.descriptor(),
      envelope,
      gate,
      transport_performed:false,
      adapter_granted_authority:false,
      execution_authority:false
    });
  }
}
