// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/operation-identity/envelope.mjs
import { OPERATION_STAGES, assertOperationIdentity } from './identity.js';

const STAGE_SET = new Set(OPERATION_STAGES);
const IMMUTABLE_IDENTITY_FIELDS = Object.freeze([
  'company_id', 'operation_id', 'request_id', 'correlation_id', 'trace_id', 'idempotency_key', 'root_operation_id'
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

function cleanOptional(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function bindOperationStage(identity, stage, payload = {}) {
  const valid = assertOperationIdentity(identity);
  const normalizedStage = String(stage || '').trim().toLowerCase();
  if (!STAGE_SET.has(normalizedStage)) throw new Error(`operation-stage-invalid:${normalizedStage || 'missing'}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('operation-stage-payload-required');
  rejectLegacyTenantAuthorityDeep(payload);

  for (const field of IMMUTABLE_IDENTITY_FIELDS) {
    if (payload[field] != null && String(payload[field]) !== String(valid[field])) {
      throw new Error(`operation-identity-fork:${field}`);
    }
  }

  const envelope = {
    schema_version: '1.0',
    stage: normalizedStage,
    company_id: valid.company_id,
    operation_id: valid.operation_id,
    request_id: valid.request_id,
    correlation_id: valid.correlation_id,
    trace_id: valid.trace_id,
    idempotency_key: valid.idempotency_key,
    root_operation_id: valid.root_operation_id,
    parent_operation_id: valid.parent_operation_id || null,
    decision_id: cleanOptional(payload.decision_id),
    action_id: cleanOptional(payload.action_id),
    mission_id: cleanOptional(payload.mission_id),
    command_id: cleanOptional(payload.command_id),
    receipt_id: cleanOptional(payload.receipt_id),
    event_id: cleanOptional(payload.event_id),
    status: cleanOptional(payload.status),
    payload: payload.payload == null ? null : structuredClone(payload.payload),
    authority_ref: cleanOptional(payload.authority_ref),
    evidence_refs: Array.isArray(payload.evidence_refs)
      ? Object.freeze([...new Set(payload.evidence_refs.map((v) => String(v || '').trim()).filter(Boolean))])
      : Object.freeze([]),
    authority_neutral: true,
    identity_confers_authority: false,
  };
  rejectLegacyTenantAuthorityDeep(envelope);
  return Object.freeze(envelope);
}

export function assertOperationContinuity(identity, envelope) {
  const valid = assertOperationIdentity(identity);
  if (!envelope || typeof envelope !== 'object') throw new Error('operation-stage-envelope-required');
  for (const field of IMMUTABLE_IDENTITY_FIELDS) {
    if (String(envelope[field] ?? '') !== String(valid[field] ?? '')) throw new Error(`operation-continuity-failed:${field}`);
  }
  if (!STAGE_SET.has(String(envelope.stage || ''))) throw new Error('operation-continuity-stage-invalid');
  if (envelope.authority_neutral !== true || envelope.identity_confers_authority !== false) {
    throw new Error('operation-continuity-authority-invariant-failed');
  }
  return true;
}

export function toLedgerIdentity(envelope) {
  if (!envelope || typeof envelope !== 'object') throw new Error('operation-stage-envelope-required');
  return Object.freeze({
    company_id: envelope.company_id,
    operation_id: envelope.operation_id,
    correlation_id: envelope.correlation_id,
    decision_id: envelope.decision_id || null,
    action_id: envelope.action_id || null,
    authority_ref: envelope.authority_ref || null,
    evidence_refs: Object.freeze([...(envelope.evidence_refs || [])]),
    provenance: Object.freeze({
      request_id: envelope.request_id,
      trace_id: envelope.trace_id,
      idempotency_key: envelope.idempotency_key,
      root_operation_id: envelope.root_operation_id,
      stage: envelope.stage,
    }),
  });
}
