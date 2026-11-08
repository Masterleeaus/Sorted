// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/adapters/execution-adapter-protocol.mjs
export const TITAN_EXECUTION_ADAPTER_PROTOCOL = 'TITAN_EXECUTION_ADAPTER';
export const TITAN_EXECUTION_ADAPTER_VERSION = '1.0';
export const TITAN_EXECUTION_ADAPTER_SCHEMA = 'titan-zero-execution-adapter-envelope/v1';

export const TITAN_ADAPTER_MESSAGE_TYPES = Object.freeze({
  HELLO: 'TITAN_ADAPTER_HELLO',
  HELLO_ACK: 'TITAN_ADAPTER_HELLO_ACK',
  WORK_SUBMIT: 'TITAN_WORK_SUBMIT',
  WORK_ACCEPTED: 'TITAN_WORK_ACCEPTED',
  WORK_PROGRESS: 'TITAN_WORK_PROGRESS',
  WORK_COMPLETE: 'TITAN_WORK_COMPLETE',
  WORK_ERROR: 'TITAN_WORK_ERROR',
  WORK_CANCEL: 'TITAN_WORK_CANCEL',
  WORK_CANCELLED: 'TITAN_WORK_CANCELLED'
});

export const TITAN_ADAPTER_CAPABILITIES = Object.freeze([
  'work_submission',
  'progress_observation',
  'result_delivery',
  'cancellation'
]);

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const list = (value) => Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : [];

function rejectLegacyBoundary(input) {
  if (!input || typeof input !== 'object') return;
  for (const key of ['tenant_id', 'tenant_company_id']) {
    if (key in input) throw new TypeError('legacy tenant boundaries are not accepted by TITAN execution adapters');
  }
}

function requireCompanyId(input) {
  rejectLegacyBoundary(input);
  const company_id = clean(input?.company_id);
  if (!company_id) throw new TypeError('canonical company_id is required');
  return company_id;
}

function requireTrace(input, key) {
  const value = clean(input?.[key]);
  if (!value) throw new TypeError(`${key} is required`);
  return value;
}

function normalizeVersion(version) {
  const value = clean(version);
  if (!value || !/^\d+\.\d+$/.test(value)) throw new TypeError('adapter version must use major.minor form');
  const [major, minor] = value.split('.').map(Number);
  return Object.freeze({ raw:value, major, minor });
}

export function negotiateAdapterVersion(localVersion, remoteVersion) {
  const local = normalizeVersion(localVersion);
  const remote = normalizeVersion(remoteVersion);
  if (local.major !== remote.major) {
    return Object.freeze({
      compatible:false,
      selected_version:null,
      error:Object.freeze({ code:'ADAPTER_VERSION_INCOMPATIBLE', retryable:false })
    });
  }
  return Object.freeze({
    compatible:true,
    selected_version:`${local.major}.${Math.min(local.minor, remote.minor)}`,
    error:null
  });
}

export function negotiateAdapterCapabilities(localCapabilities, remoteCapabilities) {
  const local = new Set(list(localCapabilities));
  const remote = new Set(list(remoteCapabilities));
  return Object.freeze([...local].filter((capability) => remote.has(capability)).sort());
}

export function createAdapterHello(input = {}) {
  rejectLegacyBoundary(input);
  const runtime = clean(input.runtime);
  if (!runtime) throw new TypeError('runtime is required');
  const version = normalizeVersion(input.version ?? TITAN_EXECUTION_ADAPTER_VERSION).raw;
  const capabilities = Object.freeze(list(input.capabilities ?? TITAN_ADAPTER_CAPABILITIES).sort());
  return Object.freeze({
    schema:TITAN_EXECUTION_ADAPTER_SCHEMA,
    protocol:TITAN_EXECUTION_ADAPTER_PROTOCOL,
    type:TITAN_ADAPTER_MESSAGE_TYPES.HELLO,
    runtime,
    version,
    capabilities,
    authority_neutral:true,
    execution_authority:false,
    capability_advertisement_grants_authority:false
  });
}

export function createAdapterEnvelope(input = {}) {
  rejectLegacyBoundary(input);
  const type = clean(input.type);
  if (!Object.values(TITAN_ADAPTER_MESSAGE_TYPES).includes(type)) throw new TypeError('unsupported TITAN adapter message type');
  if ([TITAN_ADAPTER_MESSAGE_TYPES.HELLO,TITAN_ADAPTER_MESSAGE_TYPES.HELLO_ACK].includes(type)) {
    throw new TypeError('use createAdapterHello for adapter handshake messages');
  }
  const company_id = requireCompanyId(input);
  const work_id = requireTrace(input,'work_id');
  const correlation_id = requireTrace(input,'correlation_id');
  const operation_id = requireTrace(input,'operation_id');
  const idempotency_key = requireTrace(input,'idempotency_key');
  if (input.execution_authority === true || input.authority_granted === true || input.auto_execute === true) {
    throw new TypeError('adapter envelope cannot grant execution authority');
  }
  const capabilities = Object.freeze(list(input.capabilities));
  return Object.freeze({
    schema:TITAN_EXECUTION_ADAPTER_SCHEMA,
    protocol:TITAN_EXECUTION_ADAPTER_PROTOCOL,
    version:normalizeVersion(input.version ?? TITAN_EXECUTION_ADAPTER_VERSION).raw,
    type,
    company_id,
    work_id,
    correlation_id,
    operation_id,
    idempotency_key,
    source:clean(input.source) ?? 'titan',
    context:Object.freeze(input.context && typeof input.context === 'object' ? {...input.context, company_id} : {company_id}),
    payload:input.payload ?? null,
    capabilities,
    authority:Object.freeze({
      authority_neutral:true,
      execution_authority:false,
      adapter_activation_grants_authority:false,
      capability_negotiation_grants_authority:false
    })
  });
}

export function createAdapterError(input = {}) {
  rejectLegacyBoundary(input);
  const code = clean(input.code);
  if (!code) throw new TypeError('adapter error code is required');
  const company_id = input.company_id == null ? null : requireCompanyId(input);
  return Object.freeze({
    schema:'titan-zero-execution-adapter-error/v1',
    protocol:TITAN_EXECUTION_ADAPTER_PROTOCOL,
    version:normalizeVersion(input.version ?? TITAN_EXECUTION_ADAPTER_VERSION).raw,
    type:TITAN_ADAPTER_MESSAGE_TYPES.WORK_ERROR,
    company_id,
    work_id:clean(input.work_id),
    correlation_id:clean(input.correlation_id),
    code,
    message:clean(input.message) ?? code,
    retryable:input.retryable === true,
    fatal:input.fatal === true,
    fail_closed:true,
    execution_authority:false
  });
}

export function validateAdapterEnvelope(envelope = {}) {
  try {
    const normalized=createAdapterEnvelope(envelope);
    return Object.freeze({ ok:true, value:normalized, error:null });
  } catch (error) {
    return Object.freeze({
      ok:false,
      value:null,
      error:createAdapterError({
        company_id:clean(envelope?.company_id),
        work_id:clean(envelope?.work_id),
        correlation_id:clean(envelope?.correlation_id),
        code:'ADAPTER_ENVELOPE_INVALID',
        message:error instanceof Error ? error.message : String(error),
        retryable:false,
        fatal:false
      })
    });
  }
}
