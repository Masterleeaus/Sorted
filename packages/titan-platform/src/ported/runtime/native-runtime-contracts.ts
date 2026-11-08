// @ts-nocheck
// Ported from Titan Zero extension (portable-core): runtime/native-runtime-contracts.mjs
export const TITAN_RUNTIME_PROTOCOL = 'titan.runtime.v1';
export const TITAN_RUNTIME_ADAPTER_VERSION = 2;

const LEGACY_COMPANY_KEYS = Object.freeze([
  'tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId',
  'organisation_id','organization_id','workspace_tenant_id'
]);

export const LEGACY_TO_NATIVE_RUNTIME = Object.freeze({
  RTRVR_NETWORK_RUNNER_RESULT: 'titan.network.runner.result',
  RTRVR_NETWORK_RUNNER_KEEPALIVE: 'titan.network.runner.keepalive',
  RTRVR_NETWORK_HARVEST_PREPARE: 'titan.network.harvest.prepare',
  RTRVR_NETWORK_HARVEST_INSPECT: 'titan.network.harvest.inspect',
  RTRVR_NETWORK_HARVEST_RELEASE: 'titan.network.harvest.release',
  RTRVR_INTERNAL_CREATE_WEBSITE_AUTH_HANDOFF: 'titan.auth.website.handoff',
  workflow_complete: 'titan.workflow.complete',
  TITAN_WORK_ACCEPTED: 'titan.work.execute.accepted',
  TITAN_WORK_PROGRESS: 'titan.work.progress',
  TITAN_WORK_ERROR: 'titan.work.error',
});

const text = value => String(value ?? '').trim();
const clone = value => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function assertNoLegacyCompanyBoundary(value, path = 'payload') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoLegacyCompanyBoundary(child, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_COMPANY_KEYS.includes(key)) throw new Error(`legacy-company-boundary:${path}.${key}`);
    assertNoLegacyCompanyBoundary(child, `${path}.${key}`);
  }
}

function resolveCompanyId(input, expected = {}) {
  const supplied = text(input?.company_id);
  const required = text(expected?.company_id);
  if (!supplied && !required) throw new Error('company_id-required');
  if (supplied && required && supplied !== required) throw new Error('cross-company-runtime-envelope');
  return supplied || required;
}

export function normalizeRuntimeEnvelope(input, expected = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('runtime-envelope-required');
  assertNoLegacyCompanyBoundary(input);
  const company_id = resolveCompanyId(input, expected);
  const type = text(input.type || input.event_type);
  if (!type) throw new Error('runtime-event-type-required');
  return Object.freeze({
    protocol: TITAN_RUNTIME_PROTOCOL,
    adapter_version: TITAN_RUNTIME_ADAPTER_VERSION,
    type,
    company_id,
    event_id: text(input.event_id) || null,
    correlation_id: text(input.correlation_id) || null,
    operation_id: text(input.operation_id) || null,
    idempotency_key: text(input.idempotency_key) || null,
    actor_id: text(input.actor_id) || null,
    source: text(input.source) || 'titan-runtime',
    legacy_type: text(input.legacy_type) || null,
    compatibility: Boolean(input.compatibility),
    at: Number(input.at) || Date.now(),
    payload: clone(input.payload ?? null),
    grants_authority: false,
    direct_mutation: false,
    authority_effect: false,
  });
}

export function mirrorLegacyRuntimeMessage(message, expected = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  assertNoLegacyCompanyBoundary(message);
  const legacy_type = [message.type, message.event, message.action, message.name]
    .map(text)
    .find(value => LEGACY_TO_NATIVE_RUNTIME[value]);
  if (!legacy_type) return null;
  return normalizeRuntimeEnvelope({
    type: LEGACY_TO_NATIVE_RUNTIME[legacy_type],
    company_id: message.company_id,
    event_id: message.event_id,
    correlation_id: message.correlation_id,
    operation_id: message.operation_id,
    idempotency_key: message.idempotency_key,
    actor_id: message.actor_id,
    source: expected.source || 'compatibility-runtime',
    legacy_type,
    compatibility: true,
    at: message.at || Date.now(),
    payload: null,
  }, expected);
}

export function normalizeWorkforceControlIntent(input, expected = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('workforce-control-intent-required');
  assertNoLegacyCompanyBoundary(input, 'workforce_control');
  if (text(input.schema) !== 'titan.client.workforce.control-intent.v1') throw new Error('workforce-control-schema-invalid');
  const company_id = resolveCompanyId(input, expected);
  const intent_id = text(input.intent_id);
  const action = text(input.action);
  const target_ref = text(input.target_ref);
  if (!intent_id) throw new Error('workforce-control-intent-id-required');
  if (!action) throw new Error('workforce-control-action-required');
  if (!target_ref) throw new Error('workforce-control-target-required');
  if (input.grants_authority !== false || input.auto_execute !== false) throw new Error('workforce-control-authority-invalid');
  return Object.freeze({
    ...clone(input),
    schema: 'titan.client.workforce.control-intent.v1',
    company_id,
    intent_id,
    action,
    target_ref,
    state: text(input.state) || 'prepared',
    grants_authority: false,
    auto_execute: false,
    direct_mutation: false,
    authority_effect: false,
  });
}

export function assertRuntimeCompanyId(value, expectedCompanyId) {
  return resolveCompanyId(value || {}, { company_id: expectedCompanyId });
}
