// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/settings-action-bridge.mjs
/**
 * Titan Zero AI -> Settings Action Bridge.
 *
 * Turns explicit natural-language Settings requests into validated, scoped,
 * owner-aware actions. The bridge does not grant runtime authority.
 */

import { interpretSettingsLanguage } from './settings-ai-language.js';
import { resolveSetting } from './settings-resolution.js';
import { validateScopeContext, LEGACY_COMPANY_BOUNDARY_ALIASES } from './settings-scope.js';

export const SETTINGS_ACTION_BRIDGE_VERSION = '1.0.0';

function assertObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function assertCanonicalContext(input = {}) {
  const context = assertObject('settings action context', input);
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(context, alias)) throw new TypeError(`legacy company boundary alias is not accepted: ${alias}`);
  }
  if (typeof context.company_id !== 'string' || context.company_id.trim() === '') {
    throw new TypeError('company_id is required for settings actions');
  }
  return Object.freeze({
    ...context,
    company_id: context.company_id.trim(),
    user_id: context.user_id ?? context.actor_id ?? null,
  });
}

function registryEntry(registry, key) {
  assertObject('registry', registry);
  if (registry.company_boundary !== 'company_id') throw new TypeError('registry company boundary must be company_id');
  if (!Array.isArray(registry.settings)) throw new TypeError('registry.settings must be an array');
  const entry = registry.settings.find((candidate) => candidate?.key === key);
  if (!entry) throw new TypeError(`unknown canonical setting: ${key}`);
  if (entry.editable === false) throw new TypeError(`setting is not editable: ${key}`);
  if (entry.sensitivity === 'secret' || entry.type === 'credential_reference') throw new TypeError(`generic AI settings writes cannot modify secret setting: ${key}`);
  return entry;
}

function layerFor(scope, context, key, value) {
  const validated = validateScopeContext(scope, context);
  return { ...validated, values: { [key]: value } };
}

function currentValue(entry, registry, context, layers = {}) {
  return resolveSetting(entry.key, { registry, context, layers }).value;
}

function validateProposedValue(entry, registry, context, value) {
  const layers = { [entry.scope]: layerFor(entry.scope, context, entry.key, value) };
  return resolveSetting(entry.key, { registry, context, layers }).value;
}

function safeValue(entry, value) {
  if (entry.sensitivity === 'sensitive') return '[redacted-sensitive-setting]';
  return value;
}

function authorizationRequired(entry) {
  return entry.authority_effect === 'policy_projection';
}

export function interpretSettingsRequest(text, options = {}) {
  return interpretSettingsLanguage(text, options);
}

export function proposeSettingsAction(input) {
  assertObject('settings action input', input);
  const registry = input.registry;
  const context = assertCanonicalContext(input.context);
  const parsed = interpretSettingsLanguage(input.text, { registry });
  if (!parsed.confident || parsed.intent !== 'settings.change' || !parsed.setting_key) {
    return Object.freeze({
      schema: 'titan-zero-settings-action-proposal/v1',
      version: SETTINGS_ACTION_BRIDGE_VERSION,
      status: 'clarification_required',
      company_id: context.company_id,
      actor_id: context.actor_id ?? null,
      interpretation: parsed,
      grants_authority: false,
    });
  }

  const entry = registryEntry(registry, parsed.setting_key);
  validateScopeContext(entry.scope, context);
  const newValue = validateProposedValue(entry, registry, context, parsed.value);
  const oldValue = currentValue(entry, registry, context, input.current_layers ?? {});

  return Object.freeze({
    schema: 'titan-zero-settings-action-proposal/v1',
    version: SETTINGS_ACTION_BRIDGE_VERSION,
    status: 'ready',
    company_id: context.company_id,
    actor_id: context.actor_id ?? null,
    setting_key: entry.key,
    owner: entry.owner,
    declared_scope: entry.scope,
    old_value: safeValue(entry, oldValue),
    new_value: safeValue(entry, newValue),
    raw_old_value: oldValue,
    raw_new_value: newValue,
    requires_authorization: authorizationRequired(entry),
    authority_effect: entry.authority_effect ?? 'none',
    sensitivity: entry.sensitivity ?? 'standard',
    interpretation: parsed,
    grants_authority: false,
  });
}

async function normalizeAuthorization(result) {
  const value = await result;
  if (!value || typeof value !== 'object') return Object.freeze({ allowed: false, reason: 'invalid-authorization-result' });
  return Object.freeze({ allowed: value.allowed === true, reason: value.reason ?? (value.allowed === true ? 'allowed' : 'denied') });
}

function receiptBase(proposal, authorization) {
  return {
    schema: 'titan-zero-settings-change-receipt/v1',
    version: SETTINGS_ACTION_BRIDGE_VERSION,
    company_id: proposal.company_id,
    actor_id: proposal.actor_id,
    setting_key: proposal.setting_key,
    owner: proposal.owner,
    scope: proposal.declared_scope,
    old_value: proposal.old_value,
    new_value: proposal.new_value,
    rollback_value: proposal.old_value,
    authorization,
    grants_authority: false,
  };
}

export async function executeSettingsAction(input) {
  assertObject('settings action input', input);
  const registry = input.registry;
  const context = assertCanonicalContext(input.context);
  const parsed = interpretSettingsLanguage(input.text, { registry });

  if (parsed.intent === 'settings.list' && parsed.confident) {
    return Object.freeze({
      schema: 'titan-zero-settings-list-result/v1', status: 'read', company_id: context.company_id,
      settings: Object.freeze(registry.settings.filter((entry) => entry.editable !== false && entry.sensitivity !== 'secret').map((entry) => Object.freeze({ key: entry.key, category: entry.category, scope: entry.scope, owner: entry.owner }))),
      grants_authority: false,
    });
  }

  if (parsed.intent === 'settings.read' && parsed.confident && parsed.setting_key) {
    const entry = registryEntry(registry, parsed.setting_key);
    validateScopeContext(entry.scope, context);
    if (!input.adapter || typeof input.adapter.read !== 'function') throw new TypeError('settings adapter read function is required');
    const stored = await input.adapter.read({ key: entry.key, scope: entry.scope, context, owner: entry.owner });
    const value = stored === undefined ? entry.default : stored;
    return Object.freeze({
      schema: 'titan-zero-settings-read-result/v1', status: 'read', company_id: context.company_id,
      setting_key: entry.key, owner: entry.owner, scope: entry.scope, value: safeValue(entry, value), grants_authority: false,
    });
  }

  const preliminary = proposeSettingsAction({ ...input, context });
  if (preliminary.status !== 'ready') return preliminary;
  const entry = registryEntry(registry, preliminary.setting_key);
  const adapter = input.adapter;
  if (!adapter || typeof adapter.read !== 'function' || typeof adapter.write !== 'function') {
    throw new TypeError('settings adapter with read/write functions is required');
  }

  const storedOld = await adapter.read({ key: entry.key, scope: entry.scope, context, owner: entry.owner });
  const oldRaw = storedOld === undefined ? preliminary.raw_old_value : storedOld;
  const proposal = Object.freeze({
    ...preliminary,
    old_value: safeValue(entry, oldRaw),
    raw_old_value: oldRaw,
  });

  let authorization = Object.freeze({ allowed: true, reason: 'not-required' });
  if (proposal.requires_authorization) {
    if (typeof input.authorize !== 'function') {
      authorization = Object.freeze({ allowed: false, reason: 'authorization-required' });
    } else {
      authorization = await normalizeAuthorization(input.authorize({ proposal, context, registry_entry: entry }));
    }
  }

  if (!authorization.allowed) {
    return Object.freeze({
      ...receiptBase(proposal, authorization),
      status: 'not_applied', verified: false, rollback_value: safeValue(entry, oldRaw), reason: authorization.reason,
    });
  }

  await adapter.write({
    key: entry.key,
    value: proposal.raw_new_value,
    scope: entry.scope,
    context,
    owner: entry.owner,
    setting: entry,
  });
  const readBack = await adapter.read({ key: entry.key, scope: entry.scope, context, owner: entry.owner });
  const verified = Object.is(readBack, proposal.raw_new_value) || JSON.stringify(readBack) === JSON.stringify(proposal.raw_new_value);

  return Object.freeze({
    ...receiptBase(proposal, authorization),
    status: verified ? 'applied' : 'verification_failed',
    verified,
    rollback_value: safeValue(entry, oldRaw),
    verified_value: safeValue(entry, readBack),
  });
}
