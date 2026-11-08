// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/feed/feed-delivery-replay-guard.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { normalizeCompanyContext } from '../../titan-local/kernel/company-context.js';

const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id', 'workspace_tenant_id']);
const SURFACES = new Set(['feed', 'inbox', 'decision_feed', 'approval_queue', 'human_review']);
const CHANNELS = new Set(['IN_APP', 'DESKTOP', 'CHROME', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP']);
const STATES = new Set(['LEASED', 'DELIVERED', 'FAILED']);

export const FEED_DELIVERY_REPLAY_GUARD_SCHEMA = 'titan.feed.delivery-replay-guard.v3';
export const FEED_DELIVERY_REPLAY_MODULE_ID = 'titan.feed-delivery-replay';
export const FEED_DELIVERY_REPLAY_COLLECTION = 'delivery-state';
export const DEFAULT_DELIVERY_REPLAY_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_DELIVERY_LEASE_MS = 60 * 1000;
export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 3;
export const DEFAULT_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
export const DEFAULT_RECOVERY_PAGE_SIZE = 1000;
export const DEFAULT_RECOVERY_MAX_SCAN_RECORDS = 50000;

const text = value => String(value ?? '').trim();

function rejectLegacyTenantFields(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectLegacyTenantFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_TENANT_KEYS.has(key)) throw new Error(`legacy-tenant-authority-field:${path}.${key}`);
    rejectLegacyTenantFields(child, `${path}.${key}`);
  }
}

function contextOf(input = {}) {
  rejectLegacyTenantFields(input);
  return normalizeCompanyContext(input || {});
}

function surfaceOf(value) {
  const surface = text(value || 'feed').toLowerCase();
  if (!SURFACES.has(surface)) throw new Error('feed-delivery-surface-invalid');
  return surface;
}

function channelOf(value) {
  const channel = text(value || 'IN_APP').toUpperCase();
  if (!CHANNELS.has(channel)) throw new Error('feed-delivery-channel-invalid');
  return channel;
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

function nowOf(value, clock) {
  const raw = value === undefined || value === null || value === '' ? clock() : value;
  const now = Number(raw);
  if (!Number.isFinite(now) || now <= 0) throw new Error('feed-delivery-now-invalid');
  return now;
}

function stateClockSkew(state, now, tolerance_ms) {
  const fields = ['updated_at', 'lease_acquired_at', 'lease_expires_at', 'delivered_at', 'last_failed_at', 'next_retry_at'];
  const future = fields
    .map(field => [field, Number(state?.[field] || 0)])
    .filter(([, value]) => Number.isFinite(value) && value > now + tolerance_ms);
  return future.length ? Object.freeze({ fields: Object.freeze(future.map(([field]) => field)), max_future_at: Math.max(...future.map(([, value]) => value)) }) : null;
}

function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of String(input)) {
    hash ^= BigInt(ch.codePointAt(0));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

function semanticIdentity(input = {}) {
  const notification_id = text(input.notification_id || input.entry_id || input.message_id || input.event_id);
  const dedupe_key = text(input.dedupe_key);
  const source_event_id = text(input.source_event_id || input.event_id || input.causality?.event_id);
  const message_id = text(input.message_id);
  const operation_id = text(input.operation_id || input.causality?.operation_id);
  const semantic_state = text(input.semantic_state || input.state || input.event_state || input.lifecycle_state).toUpperCase();
  const kind = text(input.kind || input.type || input.topic || input.event_type).toLowerCase();
  const identity = dedupe_key || notification_id || message_id || source_event_id || [operation_id, kind, semantic_state].filter(Boolean).join(':');
  if (!identity) throw new Error('feed-delivery-identity-required');
  return { identity, notification_id: notification_id || null, dedupe_key: dedupe_key || null, source_event_id: source_event_id || null, message_id: message_id || null, operation_id: operation_id || null, semantic_state: semantic_state || null, kind: kind || null };
}

export function buildFeedDeliveryFingerprint(input = {}) {
  rejectLegacyTenantFields(input);
  const company_id = text(input.company_id);
  if (!company_id) throw new Error('feed-delivery-company_id-required');
  const surface = surfaceOf(input.surface);
  const channel = channelOf(input.channel);
  const semantic = semanticIdentity(input);
  const raw = [company_id, surface, channel, semantic.identity, semantic.kind || '-', semantic.semantic_state || '-'].join('|');
  return Object.freeze({
    schema: 'titan.feed.delivery-fingerprint.v1',
    company_id,
    surface,
    channel,
    fingerprint: fnv1a64(raw),
    ...semantic,
    authority_neutral: true,
    authority_effect: false
  });
}

function recordId(fingerprint) {
  return `delivery:${fingerprint}`;
}

function buildLeaseToken({ fingerprint, attempt_count, lease_acquired_at }) {
  return fnv1a64([fingerprint, attempt_count, lease_acquired_at].join('|'));
}

function validateStored(state, company_id, fingerprint) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('feed-delivery-state-invalid');
  rejectLegacyTenantFields(state);
  if (text(state.company_id) !== company_id) throw new Error('feed-delivery-cross-company-state-rejected');
  if (text(state.fingerprint) !== fingerprint) throw new Error('feed-delivery-fingerprint-mismatch');
  if (!STATES.has(text(state.state).toUpperCase())) throw new Error('feed-delivery-state-value-invalid');
  return state;
}

export function createFeedDeliveryReplayGuard({ database, clock = () => Date.now() } = {}) {
  if (!database || typeof database.getRecord !== 'function' || typeof database.putRecord !== 'function' || typeof database.listRecords !== 'function') {
    throw new Error('feed-delivery-database-required');
  }

  const locator = fingerprint => ({ module_id: FEED_DELIVERY_REPLAY_MODULE_ID, collection: FEED_DELIVERY_REPLAY_COLLECTION, record_id: recordId(fingerprint) });

  const prepareDelivery = async (contextInput, input = {}) => {
    const context = contextOf(contextInput);
    rejectLegacyTenantFields(input);
    if (input.company_id && text(input.company_id) !== context.company_id) throw new Error('feed-delivery-cross-company-prepare-rejected');
    const now = nowOf(input.now, clock);
    const fp = buildFeedDeliveryFingerprint({ ...input, company_id: context.company_id });
    const replay_window_ms = boundedInt(input.replay_window_ms, DEFAULT_DELIVERY_REPLAY_WINDOW_MS, 1000, 7 * 24 * 60 * 60 * 1000);
    const lease_ms = boundedInt(input.lease_ms, DEFAULT_DELIVERY_LEASE_MS, 1000, 10 * 60 * 1000);
    const max_attempts = boundedInt(input.max_attempts, DEFAULT_MAX_DELIVERY_ATTEMPTS, 1, 10);
    const clock_skew_tolerance_ms = boundedInt(input.clock_skew_tolerance_ms, DEFAULT_CLOCK_SKEW_TOLERANCE_MS, 1000, 60 * 60 * 1000);
    const txContext = { ...context, idempotency_key: text(input.idempotency_key) || undefined };
    return database.transaction(txContext, { stores: ['records'], mode: 'readwrite' }, async tx => {
      const row = await tx.getRecord(locator(fp.fingerprint), { includeDeleted: true });
      const prior = row?.data ? validateStored(row.data, context.company_id, fp.fingerprint) : null;
      const skew = prior ? stateClockSkew(prior, now, clock_skew_tolerance_ms) : null;
      if (skew) {
        return Object.freeze({ allowed: false, reason: 'delivery-clock-skew-requires-review', state: prior, clock_skew: skew, requires_review: true, fingerprint: fp, authority_neutral: true, authority_effect: false, automatic_effect_replay: false });
      }

      if (prior?.state === 'DELIVERED' && now - Number(prior.delivered_at || prior.updated_at || 0) < replay_window_ms) {
        return Object.freeze({ allowed: false, reason: 'already-delivered-within-replay-window', state: prior, fingerprint: fp, authority_neutral: true, authority_effect: false, automatic_effect_replay: false });
      }
      if (prior?.state === 'LEASED' && Number(prior.lease_expires_at || 0) > now) {
        return Object.freeze({ allowed: false, reason: 'delivery-already-in-flight', state: prior, fingerprint: fp, authority_neutral: true, authority_effect: false, automatic_effect_replay: false });
      }
      if (prior && Number(prior.attempt_count || 0) >= max_attempts && prior.state !== 'DELIVERED') {
        return Object.freeze({ allowed: false, reason: 'delivery-attempts-exhausted', state: prior, fingerprint: fp, requires_review: true, authority_neutral: true, authority_effect: false, automatic_effect_replay: false });
      }

      const new_delivery_epoch = prior?.state === 'DELIVERED';
      const attempt_count = new_delivery_epoch ? 1 : Number(prior?.attempt_count || 0) + 1;
      const delivery_epoch = new_delivery_epoch ? Number(prior?.delivery_epoch || 1) + 1 : Number(prior?.delivery_epoch || 1);
      const state = Object.freeze({
        schema: FEED_DELIVERY_REPLAY_GUARD_SCHEMA,
        company_id: context.company_id,
        fingerprint: fp.fingerprint,
        surface: fp.surface,
        channel: fp.channel,
        notification_id: fp.notification_id,
        dedupe_key: fp.dedupe_key,
        source_event_id: fp.source_event_id,
        message_id: fp.message_id,
        operation_id: fp.operation_id,
        semantic_state: fp.semantic_state,
        kind: fp.kind,
        state: 'LEASED',
        attempt_count,
        delivery_epoch,
        lease_token: buildLeaseToken({ fingerprint: fp.fingerprint, attempt_count, lease_acquired_at: now }),
        max_attempts,
        lease_acquired_at: now,
        lease_expires_at: now + lease_ms,
        delivered_at: null,
        last_failed_at: new_delivery_epoch ? null : prior?.last_failed_at || null,
        next_retry_at: null,
        last_error: new_delivery_epoch ? null : prior?.last_error || null,
        replay_window_ms,
        requires_explicit_resume_after_restart: true,
        automatic_effect_replay: false,
        authority_neutral: true,
        authority_effect: false,
        grants_authority: false,
        execution_permitted: false,
        updated_at: now
      });
      const stored = await tx.putRecord({ ...locator(fp.fingerprint), data: state, provenance: { source: 'titan-feed-delivery-replay-guard', company_id: context.company_id, authority_effect: false }, updated_at: now });
      return Object.freeze({ allowed: true, reason: new_delivery_epoch ? 'new-delivery-epoch-leased' : prior ? 'retry-leased' : 'first-delivery-leased', lease_token: state.lease_token, state: Object.freeze({ ...state, storage_version: stored.version }), fingerprint: fp, authority_neutral: true, authority_effect: false, automatic_effect_replay: false });
    });
  };

  const completeLease = async (contextInput, input = {}, outcome) => {
    const context = contextOf(contextInput); rejectLegacyTenantFields(input);
    const crossCompanyError = outcome === 'DELIVERED' ? 'feed-delivery-cross-company-delivered-rejected' : 'feed-delivery-cross-company-failure-rejected';
    if (input.company_id && text(input.company_id) !== context.company_id) throw new Error(crossCompanyError);
    const lease_token = text(input.lease_token);
    if (!lease_token) throw new Error('feed-delivery-lease-token-required');
    const now = nowOf(input.now, clock);
    const fp = buildFeedDeliveryFingerprint({ ...input, company_id: context.company_id });
    return database.transaction(context, { stores: ['records'], mode: 'readwrite' }, async tx => {
      const row = await tx.getRecord(locator(fp.fingerprint), { includeDeleted: true });
      if (!row?.data) throw new Error(outcome === 'DELIVERED' ? 'feed-delivery-lease-required-before-delivered' : 'feed-delivery-lease-required-before-failure');
      const prior = validateStored(row.data, context.company_id, fp.fingerprint);
      const clock_skew_tolerance_ms = boundedInt(input.clock_skew_tolerance_ms, DEFAULT_CLOCK_SKEW_TOLERANCE_MS, 1000, 60 * 60 * 1000);
      if (stateClockSkew(prior, now, clock_skew_tolerance_ms)) throw new Error('feed-delivery-clock-skew-requires-review');
      if (prior.state !== 'LEASED') throw new Error('feed-delivery-not-leased');
      if (text(prior.lease_token) !== lease_token) throw new Error('feed-delivery-stale-lease-token-rejected');
      if (Number(prior.lease_expires_at || 0) <= now) throw new Error('feed-delivery-expired-lease-token-rejected');
      let state;
      let source;
      if (outcome === 'DELIVERED') {
        state = Object.freeze({ ...prior, state: 'DELIVERED', delivered_at: now, lease_expires_at: null, next_retry_at: null, last_error: null, updated_at: now, automatic_effect_replay: false, authority_effect: false, grants_authority: false, execution_permitted: false });
        source = 'titan-feed-delivery-replay-guard-delivered';
      } else {
        const backoff_ms = boundedInt(input.backoff_ms, Math.min(5 * 60 * 1000, 1000 * (2 ** Math.max(0, Number(prior.attempt_count || 1) - 1))), 1000, 24 * 60 * 60 * 1000);
        const exhausted = Number(prior.attempt_count || 0) >= Number(prior.max_attempts || DEFAULT_MAX_DELIVERY_ATTEMPTS);
        state = Object.freeze({ ...prior, state: 'FAILED', lease_expires_at: null, last_failed_at: now, last_error: text(input.error || input.last_error).slice(0, 1000) || 'delivery-failed', next_retry_at: exhausted ? null : now + backoff_ms, requires_review: exhausted, updated_at: now, automatic_effect_replay: false, authority_effect: false, grants_authority: false, execution_permitted: false });
        source = 'titan-feed-delivery-replay-guard-failure';
      }
      await tx.putRecord({ ...locator(fp.fingerprint), data: state, provenance: { source, company_id: context.company_id, authority_effect: false }, updated_at: now });
      return state;
    });
  };

  const recordDelivered = (contextInput, input = {}) => completeLease(contextInput, input, 'DELIVERED');
  const recordFailure = (contextInput, input = {}) => completeLease(contextInput, input, 'FAILED');

  const replayCandidates = async (contextInput, input = {}) => {
    const context = contextOf(contextInput); rejectLegacyTenantFields(input);
    if (input.company_id && text(input.company_id) !== context.company_id) throw new Error('feed-delivery-cross-company-replay-rejected');
    const now = nowOf(input.now, clock);
    const recovery_max_age_ms = boundedInt(input.recovery_max_age_ms, DEFAULT_RECOVERY_MAX_AGE_MS, 60 * 1000, 30 * 24 * 60 * 60 * 1000);
    const clock_skew_tolerance_ms = boundedInt(input.clock_skew_tolerance_ms, DEFAULT_CLOCK_SKEW_TOLERANCE_MS, 1000, 60 * 60 * 1000);
    const candidate_limit = boundedInt(input.limit, 1000, 1, 10000);
    const page_size = boundedInt(input.page_size, DEFAULT_RECOVERY_PAGE_SIZE, 1, 10000);
    const max_scan_records = boundedInt(input.max_scan_records, DEFAULT_RECOVERY_MAX_SCAN_RECORDS, page_size, 100000);
    const states = [];
    const seen = new Set();
    let offset = 0;
    let scanned_record_count = 0;
    let scan_truncated = false;
    while (scanned_record_count < max_scan_records) {
      const batch_limit = Math.min(page_size, max_scan_records - scanned_record_count);
      const rows = await database.listRecords(context, { module_id: FEED_DELIVERY_REPLAY_MODULE_ID, collection: FEED_DELIVERY_REPLAY_COLLECTION, includeDeleted: false, offset, limit: batch_limit, order_by: 'updated_at', direction: 'desc' });
      if (!rows.length) break;
      scanned_record_count += rows.length;
      offset += rows.length;
      for (const row of rows) {
        const state = validateStored(row.data, context.company_id, row.data.fingerprint);
        if (seen.has(state.fingerprint)) continue;
        seen.add(state.fingerprint);
        states.push(state);
      }
      if (rows.length < batch_limit) break;
      if (scanned_record_count >= max_scan_records) {
        const probe = await database.listRecords(context, { module_id: FEED_DELIVERY_REPLAY_MODULE_ID, collection: FEED_DELIVERY_REPLAY_COLLECTION, includeDeleted: false, offset, limit: 1, order_by: 'updated_at', direction: 'desc' });
        scan_truncated = probe.length > 0;
      }
    }
    const quarantined = [];
    const eligible = states.filter(state => {
      if (state.state === 'DELIVERED') return false;
      if (Number(state.attempt_count || 0) >= Number(state.max_attempts || DEFAULT_MAX_DELIVERY_ATTEMPTS)) return false;
      const skew = stateClockSkew(state, now, clock_skew_tolerance_ms);
      if (skew) { quarantined.push({ state, reason: 'recovery-record-clock-skew', clock_skew: skew }); return false; }
      const last_activity_at = Number(state.updated_at || state.last_failed_at || state.lease_acquired_at || 0);
      if (!last_activity_at || now - last_activity_at > recovery_max_age_ms) { quarantined.push({ state, reason: 'recovery-record-too-old', clock_skew: null }); return false; }
      if (state.state === 'LEASED' && Number(state.lease_expires_at || 0) > now) return false;
      if (state.state === 'FAILED' && Number(state.next_retry_at || 0) > now) return false;
      return true;
    });
    const candidates = eligible.slice(0, candidate_limit).map(state => Object.freeze({ ...state, requires_explicit_resume: true, automatic_effect_replay: false }));
    const quarantined_refs = quarantined.map(item => Object.freeze({ fingerprint: item.state.fingerprint, state: item.state.state, attempt_count: item.state.attempt_count, updated_at: item.state.updated_at || null, reason: item.reason, clock_skew: item.clock_skew || null, requires_review: true }));
    return Object.freeze({ schema: 'titan.feed.delivery-replay-candidates.v3', company_id: context.company_id, candidates: Object.freeze(candidates), candidate_count: candidates.length, eligible_candidate_count: eligible.length, candidate_limit, quarantined: Object.freeze(quarantined_refs), quarantined_count: quarantined_refs.length, recovery_max_age_ms, clock_skew_tolerance_ms, page_size, max_scan_records, scanned_record_count, scan_truncated, requires_explicit_resume: candidates.length > 0, requires_review: quarantined_refs.length > 0 || scan_truncated, automatic_dispatch: false, automatic_effect_replay: false, authority_neutral: true, authority_effect: false });
  };

  return Object.freeze({ prepareDelivery, recordDelivered, recordFailure, replayCandidates });
}
