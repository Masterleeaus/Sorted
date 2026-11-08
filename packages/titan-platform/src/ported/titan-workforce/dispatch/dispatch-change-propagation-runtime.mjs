import { routeFeedInboxRecord } from '../../titan-runtime/feed/feed-inbox-routing.mjs';
import { buildWorkforceNotificationEscalation } from '../notifications/workforce-notification-escalation-runtime.mjs';

const CHANGE_KINDS = new Set(['ASSIGNMENT_CHANGED','SCHEDULE_CHANGED','STATUS_CHANGED','LOCATION_CHANGED','CANCELLATION','OTHER']);
const LEGACY_TENANT_KEYS = new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId']);
const text = value => String(value ?? '').trim();

function rejectLegacy(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((item, index) => rejectLegacy(item, `${path}[${index}]`));
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_TENANT_KEYS.has(key)) throw new Error(`legacy-company-boundary:${path}.${key}`);
    rejectLegacy(child, `${path}.${key}`);
  }
}

function companyId(input = {}) {
  const id = text(input.company_id);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('dispatch-change-company_id-required');
  return id;
}

function assertCompany(record, company_id, label) {
  if (!record || typeof record !== 'object') return;
  const id = text(record.company_id);
  if (id && id !== company_id) throw new Error(`dispatch-change-cross-company-${label}`);
}

function workItemId(input = {}) {
  const id = text(input.work_item_id || input.job_id || input.work_order_id || input.id);
  if (!id) throw new Error('dispatch-change-work_item_id-required');
  return id;
}

function normalizeKind(value) {
  const kind = text(value || 'OTHER').toUpperCase();
  if (!CHANGE_KINDS.has(kind)) throw new Error('dispatch-change-kind-invalid');
  return kind;
}

function normalizeAudienceRefs(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(text).filter(Boolean))].sort();
}

function sameDay(changeAt, serviceAt, tzOffsetMinutes = 0) {
  if (!Number.isFinite(changeAt) || !Number.isFinite(serviceAt)) return false;
  const offset = Number(tzOffsetMinutes || 0) * 60000;
  const day = ms => new Date(ms + offset).toISOString().slice(0,10);
  return day(changeAt) === day(serviceAt);
}

function titleFor(kind) {
  if (kind === 'ASSIGNMENT_CHANGED') return 'Dispatch assignment updated';
  if (kind === 'SCHEDULE_CHANGED') return 'Service time updated';
  if (kind === 'STATUS_CHANGED') return 'Job status updated';
  if (kind === 'LOCATION_CHANGED') return 'Service location updated';
  if (kind === 'CANCELLATION') return 'Service cancelled';
  return 'Dispatch update';
}

function bodyFor(kind, input = {}) {
  const explicit = text(input.summary || input.message || input.body);
  if (explicit) return explicit;
  if (kind === 'ASSIGNMENT_CHANGED') return 'The assigned worker or crew has changed.';
  if (kind === 'SCHEDULE_CHANGED') return 'The service schedule has changed.';
  if (kind === 'STATUS_CHANGED') return 'The job status has changed.';
  if (kind === 'LOCATION_CHANGED') return 'The service location has changed.';
  if (kind === 'CANCELLATION') return 'The service has been cancelled.';
  return 'Dispatch details have changed.';
}

export function buildDispatchChangePropagation(input = {}) {
  rejectLegacy(input);
  const company_id = companyId(input);
  const work_item_id = workItemId(input.work_item || input);
  const change_kind = normalizeKind(input.change_kind || input.kind);
  const change_at = Number(input.change_at || input.occurred_at || input.now || Date.now());
  const service_at = Number(input.service_at || input.service_start_at || input.work_item?.service_start_at || 0) || null;
  const timezone_offset_minutes = Number(input.timezone_offset_minutes || 0);

  assertCompany(input.work_item, company_id, 'work-item');
  assertCompany(input.assignment, company_id, 'assignment');
  assertCompany(input.customer, company_id, 'customer');
  assertCompany(input.change_event, company_id, 'event');

  if (input.same_day_only !== false && service_at && !sameDay(change_at, service_at, timezone_offset_minutes)) {
    return Object.freeze({
      schema: 'titan.workforce.dispatch.change-propagation.v1',
      company_id,
      work_item_id,
      change_id: text(input.change_id || input.change_event?.event_id || `dispatch-change:${company_id}:${work_item_id}:${change_kind}:${change_at}`),
      change_kind,
      state: 'NOT_SAME_DAY',
      worker_projection: null,
      customer_projection: null,
      notification_draft: null,
      propagation_required: false,
      projection_only: true,
      automatic_send: false,
      direct_mutation: false,
      execution_permitted: false,
      identity_confers_authority: false,
      grants_authority: false
    });
  }

  const worker_refs = normalizeAudienceRefs(input.worker_refs || input.assignment?.worker_id || input.worker_id);
  const customer_refs = normalizeAudienceRefs(input.customer_refs || input.customer?.customer_id || input.customer_id);
  const title = titleFor(change_kind);
  const body = bodyFor(change_kind, input);
  const change_id = text(input.change_id || input.change_event?.event_id || `dispatch-change:${company_id}:${work_item_id}:${change_kind}:${change_at}`);
  const causality = Object.freeze({
    event_id: text(input.change_event?.event_id || input.event_id) || change_id,
    operation_id: text(input.operation_id) || null,
    correlation_id: text(input.correlation_id) || `dispatch:${company_id}:${work_item_id}`,
    job_id: text(input.job_id || input.work_item?.job_id) || null,
    work_order_id: text(input.work_order_id || input.work_item?.work_order_id) || null
  });

  const worker_record = Object.freeze({
    company_id,
    event_type: 'workforce_event',
    operational: true,
    source: 'titan-workforce-dispatch',
    kind: 'dispatch_same_day_change',
    entry_id: `dispatch-change:${change_id}:worker`,
    title,
    body,
    occurred_at: new Date(change_at).toISOString(),
    work_item_id,
    job_id: causality.job_id,
    work_order_id: causality.work_order_id,
    recipient_refs: worker_refs,
    presentation_surface: 'feed',
    projection_only: true,
    source_event_id: causality.event_id,
    operation_id: causality.operation_id,
    correlation_id: causality.correlation_id,
    authority_neutral: true,
    grants_authority: false
  });
  const worker_routing = routeFeedInboxRecord(worker_record);
  if (worker_routing.destination !== 'feed') throw new Error('dispatch-worker-projection-not-feed');

  const customer_projection = Object.freeze({
    schema: 'titan.workforce.dispatch.customer-update-projection.v1',
    company_id,
    work_item_id,
    change_id,
    change_kind,
    customer_refs,
    title,
    body,
    source_event_id: causality.event_id,
    operation_id: causality.operation_id,
    correlation_id: causality.correlation_id,
    communication_owner: 'existing_customer_communication_runtime',
    consent_and_channel_policy_required: true,
    verified_customer_context_required: true,
    outbound_send_requested: false,
    automatic_send: false,
    projection_only: true,
    execution_permitted: false,
    grants_authority: false
  });

  const notificationInput = {
    company_id,
    now: change_at,
    notifications: worker_refs.length ? [{
      notification_id: `dispatch-change:${change_id}:worker-notification`,
      company_id,
      topic: 'DISPATCH_SAME_DAY_CHANGE',
      source_ref: change_id,
      urgency: change_kind === 'CANCELLATION' ? 'HIGH' : 'NORMAL',
      recipient_refs: worker_refs,
      channels: ['IN_APP'],
      ack_required: false,
      dedupe_key: `dispatch-change:${company_id}:${work_item_id}:${change_id}`,
      event_id: causality.event_id,
      operation_id: causality.operation_id,
      correlation_id: causality.correlation_id,
      job_id: causality.job_id,
      work_order_id: causality.work_order_id
    }] : []
  };
  const notification_draft = buildWorkforceNotificationEscalation(notificationInput);

  return Object.freeze({
    schema: 'titan.workforce.dispatch.change-propagation.v1',
    company_id,
    work_item_id,
    change_id,
    change_kind,
    state: 'PROJECTED',
    same_day: service_at ? sameDay(change_at, service_at, timezone_offset_minutes) : null,
    worker_projection: Object.freeze({ ...worker_record, routing: worker_routing }),
    customer_projection,
    notification_draft,
    propagation_required: true,
    projection_only: true,
    automatic_send: false,
    direct_mutation: false,
    execution_permitted: false,
    identity_confers_authority: false,
    grants_authority: false
  });
}

export function summarizeDispatchChangePropagation(value = {}) {
  return Object.freeze({
    company_id: value.company_id || null,
    work_item_id: value.work_item_id || null,
    change_id: value.change_id || null,
    change_kind: value.change_kind || null,
    state: value.state || null,
    worker_projected: Boolean(value.worker_projection),
    customer_projected: Boolean(value.customer_projection),
    automatic_send: false,
    execution_permitted: false,
    grants_authority: false
  });
}
