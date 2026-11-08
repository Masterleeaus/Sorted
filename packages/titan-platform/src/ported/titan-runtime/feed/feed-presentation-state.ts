// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/feed/feed-presentation-state.mjs
import { normalizeCompanyContext } from '../../titan-local/kernel/company-context.js';

const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id', 'workspace_tenant_id']);
const SURFACES = new Set(['feed', 'inbox']);
const ACTIONS = new Set(['MARK_READ', 'MARK_UNREAD', 'ACKNOWLEDGE_PRESENTATION', 'SNOOZE', 'UNSNOOZE']);

export const FEED_PRESENTATION_STATE_SCHEMA = 'titan.feed.presentation-state.v1';
export const FEED_PRESENTATION_STATE_MODULE_ID = 'titan.feed-presentation-state';
export const FEED_PRESENTATION_STATE_COLLECTION = 'entry-state';

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

const text = value => String(value ?? '').trim();

function contextOf(input = {}) {
  rejectLegacyTenantFields(input);
  return normalizeCompanyContext(input || {});
}

function surfaceOf(value) {
  const surface = text(value || 'feed').toLowerCase();
  if (!SURFACES.has(surface)) throw new Error('feed-presentation-surface-invalid');
  return surface;
}

function entryIdOf(value) {
  const entry_id = text(value);
  if (!entry_id) throw new Error('feed-presentation-entry-id-required');
  if (entry_id.length > 220) throw new Error('feed-presentation-entry-id-too-long');
  return entry_id;
}

function recordId(surface, entry_id) {
  return `${surface}:${entry_id}`;
}

function defaultState(company_id, surface, entry_id) {
  return Object.freeze({
    schema: FEED_PRESENTATION_STATE_SCHEMA,
    company_id,
    surface,
    entry_id,
    read_at: null,
    presentation_acknowledged_at: null,
    presentation_acknowledged_by_ref: null,
    snoozed_at: null,
    snoozed_until: null,
    snoozed_by_ref: null,
    acknowledgement_scope: 'presentation_only',
    notification_lifecycle_acknowledged: false,
    lifecycle_ack_ref: null,
    authority_neutral: true,
    acknowledgement_confers_authority: false,
    snooze_confers_authority: false,
    updated_at: null
  });
}

function validateState(state, company_id, surface, entry_id) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('feed-presentation-state-invalid');
  rejectLegacyTenantFields(state);
  if (text(state.company_id) !== company_id) throw new Error('feed-presentation-cross-company-state-rejected');
  if (surfaceOf(state.surface) !== surface) throw new Error('feed-presentation-surface-mismatch');
  if (entryIdOf(state.entry_id) !== entry_id) throw new Error('feed-presentation-entry-mismatch');
  return state;
}

function transitionState(prior, actionInput = {}, now = Date.now()) {
  rejectLegacyTenantFields(actionInput);
  const action = text(actionInput.action).toUpperCase();
  if (!ACTIONS.has(action)) throw new Error('feed-presentation-action-invalid');
  const actor = text(actionInput.actor_ref || actionInput.acknowledged_by_ref || actionInput.snoozed_by_ref) || null;
  let next = { ...prior, updated_at: now };

  if (action === 'MARK_READ') {
    next.read_at = Number(actionInput.read_at || now);
  } else if (action === 'MARK_UNREAD') {
    next.read_at = null;
  } else if (action === 'ACKNOWLEDGE_PRESENTATION') {
    if (!actor) throw new Error('feed-presentation-ack-actor-required');
    next.presentation_acknowledged_at = Number(actionInput.acknowledged_at || now);
    next.presentation_acknowledged_by_ref = actor;
    next.acknowledgement_scope = 'presentation_only';
    next.notification_lifecycle_acknowledged = actionInput.notification_lifecycle_acknowledged === true;
    next.lifecycle_ack_ref = text(actionInput.lifecycle_ack_ref) || null;
  } else if (action === 'SNOOZE') {
    if (!actor) throw new Error('feed-presentation-snooze-actor-required');
    const until = Number(actionInput.snoozed_until);
    if (!Number.isFinite(until) || until <= now) throw new Error('feed-presentation-snooze-until-invalid');
    next.snoozed_at = Number(actionInput.snoozed_at || now);
    next.snoozed_until = until;
    next.snoozed_by_ref = actor;
  } else if (action === 'UNSNOOZE') {
    next.snoozed_at = null;
    next.snoozed_until = null;
    next.snoozed_by_ref = null;
  }

  return Object.freeze({
    ...next,
    schema: FEED_PRESENTATION_STATE_SCHEMA,
    acknowledgement_scope: 'presentation_only',
    authority_neutral: true,
    acknowledgement_confers_authority: false,
    snooze_confers_authority: false
  });
}

export function isFeedEntrySnoozed(state, now = Date.now()) {
  if (!state?.snoozed_until) return false;
  return Number(state.snoozed_until) > Number(now);
}

export function createFeedPresentationStateStore({ database, clock = () => Date.now() } = {}) {
  if (!database || typeof database.getRecord !== 'function' || typeof database.putRecord !== 'function' || typeof database.listRecords !== 'function') {
    throw new Error('feed-presentation-database-required');
  }

  const locator = (surface, entry_id) => ({
    module_id: FEED_PRESENTATION_STATE_MODULE_ID,
    collection: FEED_PRESENTATION_STATE_COLLECTION,
    record_id: recordId(surface, entry_id)
  });

  const read = async (contextInput, input = {}) => {
    const context = contextOf(contextInput);
    rejectLegacyTenantFields(input);
    if (input.company_id && text(input.company_id) !== context.company_id) throw new Error('feed-presentation-cross-company-read-rejected');
    const surface = surfaceOf(input.surface);
    const entry_id = entryIdOf(input.entry_id);
    const row = await database.getRecord(context, locator(surface, entry_id));
    if (!row?.data) return defaultState(context.company_id, surface, entry_id);
    return Object.freeze({ ...validateState(row.data, context.company_id, surface, entry_id), storage_version: row.version });
  };

  const transition = async (contextInput, input = {}) => {
    const context = contextOf(contextInput);
    rejectLegacyTenantFields(input);
    if (input.company_id && text(input.company_id) !== context.company_id) throw new Error('feed-presentation-cross-company-transition-rejected');
    const surface = surfaceOf(input.surface);
    const entry_id = entryIdOf(input.entry_id);
    const row = await database.getRecord(context, locator(surface, entry_id));
    const prior = row?.data ? validateState(row.data, context.company_id, surface, entry_id) : defaultState(context.company_id, surface, entry_id);
    const now = Number(input.now || clock());
    const next = transitionState(prior, input, now);
    const stored = await database.putRecord(
      { ...context, idempotency_key: text(input.idempotency_key) || undefined },
      {
        ...locator(surface, entry_id),
        data: next,
        provenance: { source: 'titan-feed-presentation-state', company_id: context.company_id, authority_effect: false },
        updated_at: now
      }
    );
    return Object.freeze({ ...next, storage_version: stored.version });
  };

  const list = async (contextInput, input = {}) => {
    const context = contextOf(contextInput);
    rejectLegacyTenantFields(input);
    if (input.company_id && text(input.company_id) !== context.company_id) throw new Error('feed-presentation-cross-company-list-rejected');
    const surface = input.surface == null ? null : surfaceOf(input.surface);
    const rows = await database.listRecords(context, {
      module_id: FEED_PRESENTATION_STATE_MODULE_ID,
      collection: FEED_PRESENTATION_STATE_COLLECTION,
      limit: Math.min(10000, Math.max(1, Number(input.limit) || 1000)),
      order_by: 'updated_at',
      direction: 'desc'
    });
    const states = rows
      .map(row => ({ ...row.data, storage_version: row.version }))
      .filter(state => state.company_id === context.company_id && (!surface || state.surface === surface));
    return Object.freeze({
      schema: 'titan.feed.presentation-state-list.v1',
      company_id: context.company_id,
      surface,
      states: Object.freeze(states),
      authority_neutral: true,
      authority_effect: false
    });
  };

  const importLegacyReadIds = async (contextInput, input = {}) => {
    const context = contextOf(contextInput);
    rejectLegacyTenantFields(input);
    if (text(input.source_company_id) !== context.company_id) throw new Error('feed-presentation-legacy-import-company-proof-required');
    const ids = Array.isArray(input.read_ids) ? [...new Set(input.read_ids.map(text).filter(Boolean))] : [];
    const surface = surfaceOf(input.surface || 'feed');
    const imported = [];
    for (const entry_id of ids) {
      imported.push(await transition(context, {
        company_id: context.company_id,
        surface,
        entry_id,
        action: 'MARK_READ',
        read_at: Number(input.read_at || clock()),
        idempotency_key: `legacy-feed-read:${context.company_id}:${surface}:${entry_id}`
      }));
    }
    return Object.freeze({ schema: 'titan.feed.presentation-state-legacy-import.v1', company_id: context.company_id, imported_count: imported.length, authority_neutral: true, authority_effect: false });
  };

  return Object.freeze({ read, transition, list, importLegacyReadIds });
}
