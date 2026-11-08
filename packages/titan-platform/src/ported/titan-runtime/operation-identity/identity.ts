// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/operation-identity/identity.mjs
import { assertCanonicalCompanyId } from '../boundary.js';

export const OPERATION_IDENTITY_SCHEMA_VERSION = '1.0';
export const OPERATION_STAGES = Object.freeze([
  'interaction',
  'prime',
  'decision',
  'authority',
  'command_bus',
  'execution',
  'result',
  'rewind',
  'signal',
  'wisdom',

]);

export const OPERATION_STATES = Object.freeze([
  'created','accepted','deciding','authorized','commanded','executing','completed','failed','rejected','cancelled',
]);

const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id']);

function rejectLegacyTenantAuthorityDeep(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectLegacyTenantAuthorityDeep(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_TENANT_KEYS.has(key)) throw new Error(`legacy-tenant-authority-field:${path}.${key}`);
    rejectLegacyTenantAuthorityDeep(child, `${path}.${key}`);
  }
}

function requiredId(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field}-required`);
  return normalized;
}

function optionalId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function generatedId(makeId, kind, context) {
  if (typeof makeId === 'function') return requiredId(makeId(kind, context), `${kind}-id`);
  if (globalThis.crypto?.randomUUID) return `${kind}_${globalThis.crypto.randomUUID()}`;
  throw new Error(`${kind}-id-required`);
}

export function createOperationIdentity(input, { makeId = null, now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('operation-identity-input-required');
  rejectLegacyTenantAuthorityDeep(input);
  const company_id = assertCanonicalCompanyId(input.company_id);
  const created_at = optionalId(input.created_at) || now();
  const seed = { company_id, created_at, source: optionalId(input.source) || 'titan-runtime' };
  const request_id = optionalId(input.request_id) || generatedId(makeId, 'request', seed);
  const operation_id = optionalId(input.operation_id) || generatedId(makeId, 'operation', { ...seed, request_id });
  const correlation_id = optionalId(input.correlation_id) || operation_id;
  const trace_id = optionalId(input.trace_id) || correlation_id;
  const idempotency_key = optionalId(input.idempotency_key) || `${company_id}:${request_id}`;

  const identity = {
    schema_version: OPERATION_IDENTITY_SCHEMA_VERSION,
    company_id,
    operation_id,
    request_id,
    correlation_id,
    trace_id,
    idempotency_key,
    root_operation_id: operation_id,
    parent_operation_id: optionalId(input.parent_operation_id),
    actor_id: optionalId(input.actor_id),
    capability: optionalId(input.capability),
    state: optionalId(input.state) || 'created',
    updated_at: optionalId(input.updated_at) || created_at,
    decision_id: optionalId(input.decision_id),
    authority_ref: optionalId(input.authority_ref),
    action_id: optionalId(input.action_id),
    command_id: optionalId(input.command_id),
    receipt_id: optionalId(input.receipt_id),
    source: seed.source,
    created_at,
    authority_neutral: true,
    identity_confers_authority: false,
  };
  rejectLegacyTenantAuthorityDeep(identity);
  return Object.freeze(identity);
}

export function assertOperationIdentity(identity, expected = {}) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new Error('operation-identity-required');
  rejectLegacyTenantAuthorityDeep(identity);
  const company_id = assertCanonicalCompanyId(identity.company_id);
  const operation_id = requiredId(identity.operation_id, 'operation-id');
  const request_id = requiredId(identity.request_id, 'request-id');
  const correlation_id = requiredId(identity.correlation_id, 'correlation-id');
  const trace_id = requiredId(identity.trace_id, 'trace-id');
  requiredId(identity.idempotency_key, 'idempotency-key');
  if (identity.state != null && !OPERATION_STATES.includes(String(identity.state))) throw new Error(`operation-state-invalid:${identity.state}`);

  if (identity.root_operation_id != null && String(identity.root_operation_id) !== operation_id) {
    throw new Error('root-operation-id-mismatch');
  }
  if (identity.authority_neutral !== true || identity.identity_confers_authority !== false) {
    throw new Error('operation-identity-authority-invariant-failed');
  }
  if (expected.company_id != null && String(expected.company_id) !== company_id) throw new Error('operation-company-mismatch');
  if (expected.operation_id != null && String(expected.operation_id) !== operation_id) throw new Error('operation-id-mismatch');
  if (expected.request_id != null && String(expected.request_id) !== request_id) throw new Error('request-id-mismatch');
  if (expected.correlation_id != null && String(expected.correlation_id) !== correlation_id) throw new Error('correlation-id-mismatch');
  if (expected.trace_id != null && String(expected.trace_id) !== trace_id) throw new Error('trace-id-mismatch');
  return identity;
}

export function operationIdentityKey(identity) {
  const valid = assertOperationIdentity(identity);
  return `${valid.company_id}::${valid.operation_id}`;
}


const OPERATION_TRANSITIONS = Object.freeze({
  created: new Set(['accepted', 'rejected', 'cancelled']),
  accepted: new Set(['deciding', 'cancelled']),
  deciding: new Set(['authorized', 'rejected', 'cancelled']),
  authorized: new Set(['commanded', 'cancelled']),
  commanded: new Set(['executing', 'cancelled']),
  executing: new Set(['completed', 'failed']),
  completed: new Set([]),
  failed: new Set([]),
  rejected: new Set([]),
  cancelled: new Set([]),
});

const IMMUTABLE_OPERATION_FIELDS = Object.freeze([
  'company_id','operation_id','request_id','correlation_id','trace_id','idempotency_key','root_operation_id','created_at'
]);

export function transitionOperationIdentity(identity, nextState, patch = {}, { now = () => new Date().toISOString() } = {}) {
  const current = assertOperationIdentity(identity);
  const target = requiredId(nextState, 'operation-state');
  const allowed = OPERATION_TRANSITIONS[current.state || 'created'];
  if (!allowed || !allowed.has(target)) throw new Error(`invalid-operation-transition:${current.state || 'created'}->${target}`);
  rejectLegacyTenantAuthorityDeep(patch);
  for (const field of IMMUTABLE_OPERATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && String(patch[field] ?? '') !== String(current[field] ?? '')) {
      throw new Error(`immutable-operation-field:${field}`);
    }
  }
  const next = {
    ...current,
    ...patch,
    state: target,
    updated_at: now(),
    authority_neutral: true,
    identity_confers_authority: false,
  };
  rejectLegacyTenantAuthorityDeep(next);
  assertOperationIdentity(next, { company_id: current.company_id, operation_id: current.operation_id, request_id: current.request_id });
  return Object.freeze(next);
}

export function operationStorageRecord(identity) {
  const valid = assertOperationIdentity(identity);
  return Object.freeze({ id: valid.operation_id, status: valid.state || 'created', ...valid });
}

export function operationEventFields(identity) {
  const valid = assertOperationIdentity(identity);
  return Object.freeze({
    company_id: valid.company_id,
    operation_id: valid.operation_id,
    request_id: valid.request_id,
    correlation_id: valid.correlation_id,
    trace_id: valid.trace_id,
    idempotency_key: valid.idempotency_key,
    root_operation_id: valid.root_operation_id,
    state: valid.state || 'created',
    decision_id: valid.decision_id || null,
    authority_ref: valid.authority_ref || null,
    action_id: valid.action_id || null,
    command_id: valid.command_id || null,
    receipt_id: valid.receipt_id || null,
    authority_neutral: true,
    identity_confers_authority: false,
  });
}

export function sameOperation(left, right) {
  try {
    const a = assertOperationIdentity(left);
    const b = assertOperationIdentity(right);
    return IMMUTABLE_OPERATION_FIELDS.every((field) => String(a[field] ?? '') === String(b[field] ?? ''));
  } catch {
    return false;
  }
}
