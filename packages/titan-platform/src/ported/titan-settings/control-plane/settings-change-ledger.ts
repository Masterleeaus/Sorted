// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/settings-change-ledger.mjs
/**
 * Titan Zero Settings change ledger.
 *
 * Records configuration changes without becoming an authorization system.
 * Sensitive registry values are redacted before the event record is returned.
 */

import {
  buildScopedStorageKey,
  validateScopeContext,
  LEGACY_COMPANY_BOUNDARY_ALIASES
} from './settings-scope.js';
import { validateSettingValue } from './settings-resolution.js';

const ALLOWED_ACTOR_TYPES = Object.freeze(['human', 'ai', 'system', 'integration']);

function assertPlainObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function assertNonEmptyString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} is required and must be a non-empty string`);
  }
  return value.trim();
}

function assertIsoTimestamp(value) {
  const timestamp = assertNonEmptyString('occurred_at', value);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new TypeError('occurred_at must be a valid ISO-8601 timestamp');
  return timestamp;
}

function registryEntryFor(registry, settingKey) {
  assertPlainObject('registry', registry);
  if (registry.company_boundary !== 'company_id') {
    throw new TypeError('registry must declare company_id as the sole company boundary');
  }
  if (!Array.isArray(registry.settings)) throw new TypeError('registry.settings must be an array');
  const entry = registry.settings.find((candidate) => candidate?.key === settingKey);
  if (!entry) throw new TypeError(`unknown canonical setting: ${settingKey}`);
  if (entry.sensitivity === 'secret') {
    throw new TypeError(`secret setting ${settingKey} cannot be recorded by the generic settings ledger`);
  }
  return entry;
}

function validateActor(actor) {
  assertPlainObject('actor', actor);
  const actor_id = assertNonEmptyString('actor.actor_id', actor.actor_id);
  const actor_type = assertNonEmptyString('actor.actor_type', actor.actor_type);
  if (!ALLOWED_ACTOR_TYPES.includes(actor_type)) {
    throw new TypeError(`unsupported actor.actor_type: ${actor_type}`);
  }
  return Object.freeze({ actor_id, actor_type });
}

function validateSource(source) {
  assertPlainObject('source', source);
  const surface = assertNonEmptyString('source.surface', source.surface);
  const action = assertNonEmptyString('source.action', source.action);
  return Object.freeze({ surface, action });
}

function assertNoLegacyAliases(context) {
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(context, alias)) {
      throw new TypeError(`legacy company boundary alias is not accepted: ${alias}; normalise to company_id before settings ledger write`);
    }
  }
}

function cloneSafe(value) {
  if (value == null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function valuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function safeAuditValue(entry, value) {
  validateSettingValue(entry, value);
  if (entry.sensitivity === 'sensitive') {
    return Object.freeze({ redacted: true, type: entry.type });
  }
  return cloneSafe(value);
}

export function createSettingsChangeRecord(input = {}) {
  assertPlainObject('settings change input', input);
  const event_id = assertNonEmptyString('event_id', input.event_id);
  const occurred_at = assertIsoTimestamp(input.occurred_at);
  const setting_key = assertNonEmptyString('setting_key', input.setting_key);
  const scope = assertNonEmptyString('scope', input.scope);
  const context = input.context ?? {};
  assertPlainObject('context', context);
  assertNoLegacyAliases(context);

  const entry = registryEntryFor(input.registry, setting_key);
  const validatedContext = validateScopeContext(scope, context);
  const company_id = scope === 'global' ? null : validatedContext.company_id;

  if (input.expected_company_id != null) {
    const expected = assertNonEmptyString('expected_company_id', input.expected_company_id);
    if (company_id !== expected) throw new TypeError('company_id mismatch for settings change event');
  }

  const before = safeAuditValue(entry, input.before);
  const after = safeAuditValue(entry, input.after);
  const changed = !valuesEqual(input.before, input.after);
  const actor = validateActor(input.actor);
  const source = validateSource(input.source);
  const authorization_ref = input.authorization_ref == null
    ? null
    : assertNonEmptyString('authorization_ref', input.authorization_ref);

  return Object.freeze({
    schema: 'titan-zero-settings-change-event/v1',
    event_id,
    occurred_at,
    setting_key,
    declared_scope: entry.scope,
    scope,
    company_id,
    storage_key: buildScopedStorageKey(setting_key, scope, validatedContext),
    actor,
    source,
    authorization_ref,
    before,
    after,
    changed,
    redacted: entry.sensitivity === 'sensitive',
    sensitivity: entry.sensitivity,
    authority_effect: entry.authority_effect,
    grants_authority: false
  });
}

export function appendSettingsChangeRecord(ledger, input = {}) {
  if (!Array.isArray(ledger)) throw new TypeError('ledger must be an array');
  const event_id = assertNonEmptyString('event_id', input.event_id);
  if (ledger.some((event) => event?.event_id === event_id)) {
    throw new TypeError(`duplicate settings change event_id: ${event_id}`);
  }
  const event = createSettingsChangeRecord(input);
  return Object.freeze([...ledger, event]);
}
