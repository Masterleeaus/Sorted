// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-follow-up-policy.mjs
import { normalizeSalesSettings } from './sales-agent-contract.js';

export const SALES_FOLLOW_UP_POLICY_SCHEMA = 'titan-zero-starter-sales-follow-up-policy/v1';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const uniq = (values) => Object.freeze([...new Set(values.filter(Boolean))]);

function rejectLegacyBoundary(input) {
  if (!input || typeof input !== 'object') return;
  for (const key of ['tenant_id', 'tenant_company_id']) {
    if (key in input) throw new TypeError('legacy tenant boundaries are not accepted by Sales follow-up policy');
  }
}

function parseIso(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} must be a valid ISO date-time`);
  return date;
}

function parseHm(value, label) {
  const match = clean(value)?.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new TypeError(`${label} must use HH:MM`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new TypeError(`${label} must use a valid 24-hour time`);
  return hours * 60 + minutes;
}

function inQuietHours(localMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes
    ? localMinutes >= startMinutes && localMinutes < endMinutes
    : localMinutes >= startMinutes || localMinutes < endMinutes;
}

function quietHoursEndUtc(now, offsetMinutes, endMinutes) {
  const local = new Date(now.getTime() + offsetMinutes * 60000);
  const localMidnightUtcMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let endLocalMs = localMidnightUtcMs + endMinutes * 60000;
  const localNowMs = local.getTime();
  if (endLocalMs <= localNowMs) endLocalMs += 24 * 60 * 60000;
  return new Date(endLocalMs - offsetMinutes * 60000);
}

function normalizeContactPolicy(policy = {}) {
  rejectLegacyBoundary(policy);
  const allowedChannels = Array.isArray(policy.allowed_channels)
    ? uniq(policy.allowed_channels.map(clean)) : Object.freeze([]);
  const optedOutChannels = Array.isArray(policy.opted_out_channels)
    ? uniq(policy.opted_out_channels.map(clean)) : Object.freeze([]);
  const utcOffsetMinutes = policy.utc_offset_minutes === undefined || policy.utc_offset_minutes === null
    ? null : Number(policy.utc_offset_minutes);
  if (utcOffsetMinutes !== null && (!Number.isInteger(utcOffsetMinutes) || utcOffsetMinutes < -840 || utcOffsetMinutes > 840)) {
    throw new TypeError('contact_policy.utc_offset_minutes must be an integer between -840 and 840');
  }
  return Object.freeze({
    outbound_allowed: policy.outbound_allowed === true,
    globally_opted_out: policy.globally_opted_out === true,
    allowed_channels: allowedChannels,
    opted_out_channels: optedOutChannels,
    do_not_contact_until: parseIso(policy.do_not_contact_until, 'contact_policy.do_not_contact_until'),
    utc_offset_minutes: utcOffsetMinutes
  });
}

function assertAuthorityNeutralProjection(projection, companyId, label) {
  if (!projection || typeof projection !== 'object') throw new TypeError(`${label} is required`);
  rejectLegacyBoundary(projection);
  if (clean(projection.company_id) !== companyId) throw new TypeError(`cross-company ${label} rejected`);
  if (projection.authority_neutral !== true || projection.execution_authority !== false) {
    throw new TypeError(`${label} must remain authority-neutral`);
  }
}

export function planSalesFollowUp(input = {}) {
  rejectLegacyBoundary(input);
  rejectLegacyBoundary(input.follow_up_state);
  const companyId = clean(input.company_id);
  if (!companyId) throw new TypeError('company_id is required');
  const now = parseIso(input.now, 'now');
  if (!now) throw new TypeError('now is required');

  const recommendation = input.next_best_action;
  assertAuthorityNeutralProjection(recommendation, companyId, 'next_best_action');
  const leadId = clean(recommendation.lead_ref?.lead_id);
  if (!leadId) throw new TypeError('next_best_action.lead_ref.lead_id is required');

  const settings = normalizeSalesSettings(input.settings ?? recommendation.recommendation?.settings ?? {});
  const contact = normalizeContactPolicy(input.contact_policy ?? {});
  const channel = clean(input.channel);
  if (!channel) throw new TypeError('channel is required');

  const state = input.follow_up_state && typeof input.follow_up_state === 'object' ? input.follow_up_state : {};
  const touchCount = Number(state.touch_count ?? 0);
  if (!Number.isInteger(touchCount) || touchCount < 0) throw new TypeError('follow_up_state.touch_count must be a non-negative integer');
  const lastTouchAt = parseIso(state.last_touch_at, 'follow_up_state.last_touch_at');
  const priorDedupeKeys = Array.isArray(state.prior_dedupe_keys) ? uniq(state.prior_dedupe_keys.map(clean)) : Object.freeze([]);
  const dedupeKey = clean(input.dedupe_key) ?? `sales-followup:${leadId}:touch:${touchCount + 1}`;

  const reasons = [];
  let status = 'eligible';
  let nextEligibleAt = now;

  if (contact.globally_opted_out || contact.opted_out_channels.includes(channel) || recommendation.recommendation?.recommendation?.action === 'no_action') {
    status = 'blocked';
    reasons.push('contact_opted_out_or_sales_no_action');
  } else if (!contact.outbound_allowed) {
    status = 'blocked';
    reasons.push('contact_policy_does_not_allow_outbound');
  } else if (contact.allowed_channels.length && !contact.allowed_channels.includes(channel)) {
    status = 'blocked';
    reasons.push('channel_not_allowed_by_contact_policy');
  } else if (contact.do_not_contact_until && contact.do_not_contact_until > now) {
    status = 'deferred';
    nextEligibleAt = contact.do_not_contact_until;
    reasons.push('do_not_contact_until_active');
  } else if (touchCount >= settings.max_follow_up_touches) {
    status = 'blocked';
    reasons.push('maximum_follow_up_touches_reached');
  } else if (priorDedupeKeys.includes(dedupeKey)) {
    status = 'suppressed';
    reasons.push('duplicate_follow_up_suppressed');
  }

  if (status === 'eligible' && lastTouchAt && touchCount > 0) {
    const cadenceIndex = Math.min(touchCount - 1, settings.follow_up_cadence_hours.length - 1);
    const cadenceHours = settings.follow_up_cadence_hours[cadenceIndex] ?? 0;
    const cadenceAt = new Date(lastTouchAt.getTime() + cadenceHours * 3600000);
    if (cadenceAt > now) {
      status = 'deferred';
      nextEligibleAt = cadenceAt;
      reasons.push('follow_up_cadence_not_elapsed');
    }
  }

  if (status === 'eligible') {
    if (contact.utc_offset_minutes === null) {
      status = 'deferred';
      nextEligibleAt = null;
      reasons.push('quiet_hours_timezone_offset_missing');
    } else {
      const quietStart = parseHm(settings.quiet_hours.start, 'settings.quiet_hours.start');
      const quietEnd = parseHm(settings.quiet_hours.end, 'settings.quiet_hours.end');
      const localNow = new Date(now.getTime() + contact.utc_offset_minutes * 60000);
      const localMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
      if (inQuietHours(localMinutes, quietStart, quietEnd)) {
        status = 'deferred';
        nextEligibleAt = quietHoursEndUtc(now, contact.utc_offset_minutes, quietEnd);
        reasons.push('inside_quiet_hours');
      }
    }
  }

  const connectRequest = status === 'eligible' ? Object.freeze({
    owner: 'Titan Connect',
    operation: 'request_outbound_message',
    company_id: companyId,
    channel,
    lead_id: leadId,
    customer_id: clean(recommendation.lead_ref?.customer_id),
    correlation_id: clean(recommendation.lead_ref?.correlation_id),
    journey_id: clean(recommendation.lead_ref?.journey_id),
    dedupe_key: dedupeKey,
    purpose: 'sales_follow_up',
    touch_number: touchCount + 1,
    authority_neutral_request: true,
    execution_authority: false
  }) : null;

  return Object.freeze({
    schema: SALES_FOLLOW_UP_POLICY_SCHEMA,
    company_id: companyId,
    lead_ref: recommendation.lead_ref,
    status,
    channel,
    dedupe_key: dedupeKey,
    touch_count: touchCount,
    next_eligible_at: nextEligibleAt ? nextEligibleAt.toISOString() : null,
    reasons: Object.freeze(reasons.length ? reasons : ['contact_policy_cadence_and_quiet_hours_satisfied']),
    titan_connect_request: connectRequest,
    controls: Object.freeze({
      canonical_messaging_owner: 'Titan Connect',
      cadence_enforced: true,
      quiet_hours_enforced: true,
      opt_out_enforced: true,
      duplicate_suppression_enforced: true,
      contact_policy_enforced: true,
      direct_send_performed: false,
      persistence_performed: false
    }),
    authority_neutral: true,
    execution_authority: false
  });
}
