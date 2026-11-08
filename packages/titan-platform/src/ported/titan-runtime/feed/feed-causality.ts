// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/feed/feed-causality.mjs
const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id']);
const CAUSAL_FIELDS = Object.freeze([
  'event_id', 'causation_id', 'operation_id', 'root_operation_id', 'parent_operation_id',
  'request_id', 'correlation_id', 'trace_id', 'decision_id', 'action_id', 'mission_id',
  'command_id', 'receipt_id', 'job_id', 'work_order_id', 'booking_id', 'source_ref'
]);

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

function requiredText(value, error) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(error);
  return normalized;
}

function optionalText(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function firstDefined(...values) {
  for (const value of values) if (value != null && String(value).trim()) return value;
  return null;
}

function assertSame(field, values) {
  const normalized = values.map(optionalText).filter(Boolean);
  if (new Set(normalized).size > 1) throw new Error(`feed-causality-conflict:${field}`);
  return normalized[0] || null;
}

function entityValue(source, key) {
  return firstDefined(source?.[key], source?.payload?.[key], source?.entity_refs?.[key], source?.metadata?.[key]);
}

export const FEED_CAUSALITY_SCHEMA = 'titan.feed.causality.v1';
export const FEED_CAUSALITY_FIELDS = CAUSAL_FIELDS;

export function buildFeedCausality(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('feed-causality-input-required');
  rejectLegacyTenantAuthorityDeep(input);

  const event = input.event && typeof input.event === 'object' ? input.event : {};
  const operation = input.operation && typeof input.operation === 'object' ? input.operation : {};
  const feed = input.feed && typeof input.feed === 'object' ? input.feed : {};

  const company_id = assertSame('company_id', [input.company_id, event.company_id, operation.company_id, feed.company_id]);
  if (!company_id) throw new Error('company_id_required');

  const refs = {};
  for (const field of CAUSAL_FIELDS) {
    const value = assertSame(field, [
      input[field],
      entityValue(event, field),
      entityValue(operation, field),
      entityValue(feed, field)
    ]);
    if (value) refs[field] = value;
  }

  const event_id = refs.event_id || null;
  const causation_id = refs.causation_id || null;
  const operation_id = refs.operation_id || null;
  const root_operation_id = refs.root_operation_id || operation_id;
  const correlation_id = refs.correlation_id || operation_id || event_id;

  const entity_refs = Object.freeze({
    job_id: refs.job_id || null,
    work_order_id: refs.work_order_id || null,
    booking_id: refs.booking_id || null
  });

  const chain = Object.freeze([
    root_operation_id ? {kind:'root_operation', ref:root_operation_id} : null,
    refs.parent_operation_id ? {kind:'parent_operation', ref:refs.parent_operation_id} : null,
    operation_id ? {kind:'operation', ref:operation_id} : null,
    causation_id ? {kind:'caused_by_event', ref:causation_id} : null,
    event_id ? {kind:'event', ref:event_id} : null
  ].filter(Boolean).map(item => Object.freeze(item)));

  const result = {
    schema: FEED_CAUSALITY_SCHEMA,
    company_id,
    event_id,
    causation_id,
    operation_id,
    root_operation_id: root_operation_id || null,
    parent_operation_id: refs.parent_operation_id || null,
    request_id: refs.request_id || null,
    correlation_id: correlation_id || null,
    trace_id: refs.trace_id || null,
    decision_id: refs.decision_id || null,
    action_id: refs.action_id || null,
    mission_id: refs.mission_id || null,
    command_id: refs.command_id || null,
    receipt_id: refs.receipt_id || null,
    source_ref: refs.source_ref || null,
    entity_refs,
    chain,
    authority_neutral: true,
    identity_confers_authority: false,
    causality_confers_authority: false
  };
  rejectLegacyTenantAuthorityDeep(result);
  return Object.freeze(result);
}

export function attachFeedCausality(entry = {}, causalInput = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('feed-entry-required');
  rejectLegacyTenantAuthorityDeep(entry);
  const company_id = requiredText(entry.company_id ?? causalInput.company_id, 'company_id_required');
  const causality = buildFeedCausality({...causalInput, company_id, feed:entry});
  if (entry.company_id != null && String(entry.company_id).trim() !== company_id) throw new Error('feed-causality-company-mismatch');
  return Object.freeze({
    ...entry,
    company_id,
    operation_id: entry.operation_id || causality.operation_id || undefined,
    correlation_id: entry.correlation_id || causality.correlation_id || undefined,
    source_event_id: entry.source_event_id || causality.event_id || undefined,
    causality,
    authority_neutral: true,
    causality_confers_authority: false
  });
}

export function projectOperationalEventToFeedEntry(event = {}, presentation = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event-required');
  rejectLegacyTenantAuthorityDeep(event);
  rejectLegacyTenantAuthorityDeep(presentation);
  const company_id = requiredText(event.company_id, 'company_id_required');
  const event_id = requiredText(event.event_id || event.id, 'event-id-required');
  const entry = {
    entry_id: optionalText(presentation.entry_id) || `event:${event_id}`,
    company_id,
    kind: optionalText(presentation.kind) || 'operational_event',
    title: optionalText(presentation.title) || optionalText(event.event_type) || 'Operational event',
    body: optionalText(presentation.body) || '',
    severity: presentation.severity ?? event.risk ?? 'NORMAL',
    occurred_at: optionalText(event.occurred_at) || null,
    source: optionalText(event.source) || null,
    source_event_id: event_id,
    projection_only: true,
    read_state_authority: 'visible_feed',
    event_lifecycle_authority: 'event_ledger',
    authority_neutral: true
  };
  return attachFeedCausality(entry, {company_id, event});
}
