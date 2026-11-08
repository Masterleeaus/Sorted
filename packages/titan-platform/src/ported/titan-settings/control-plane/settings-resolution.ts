// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/settings-resolution.mjs
/**
 * Titan Zero canonical Settings resolution engine.
 *
 * Resolution is deterministic and explanatory. Settings values are configuration
 * inputs only: resolving a value never grants runtime authority.
 */

import {
  buildScopedStorageKey,
  LEGACY_COMPANY_BOUNDARY_ALIASES
} from './settings-scope.js';

export const SETTINGS_RESOLUTION_ORDER = Object.freeze([
  'default',
  'global',
  'company',
  'user',
  'device',
  'session'
]);

const LAYER_DIMENSIONS = Object.freeze({
  global: Object.freeze([]),
  company: Object.freeze(['company_id']),
  user: Object.freeze(['company_id', 'user_id']),
  device: Object.freeze(['company_id', 'device_id']),
  session: Object.freeze(['company_id', 'session_id'])
});

function assertPlainObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function assertNoLegacyAliases(context) {
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(context, alias)) {
      throw new TypeError(`legacy company boundary alias is not accepted: ${alias}; normalise to company_id before settings resolution`);
    }
  }
}

function registryEntryFor(registry, settingKey) {
  assertPlainObject('registry', registry);
  if (registry.company_boundary !== 'company_id') {
    throw new TypeError('registry must declare company_id as the sole company boundary');
  }
  if (!Array.isArray(registry.settings)) {
    throw new TypeError('registry.settings must be an array');
  }
  const entry = registry.settings.find((candidate) => candidate?.key === settingKey);
  if (!entry) throw new TypeError(`unknown canonical setting: ${settingKey}`);
  return entry;
}

export function validateSettingValue(entry, value) {
  const label = `setting ${entry.key}`;
  switch (entry.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a number`);
      break;
    case 'string':
      if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
      break;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
      break;
    case 'array':
      if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
      break;
    case 'enum':
      if (!Array.isArray(entry.allowed_values) || !entry.allowed_values.includes(value)) {
        throw new TypeError(`${label} value ${JSON.stringify(value)} is not an allowed value`);
      }
      break;
    default:
      throw new TypeError(`${label} has unsupported registry type: ${String(entry.type)}`);
  }
  return value;
}

function validateLayerContext(scope, layer, targetContext) {
  assertPlainObject(`${scope} layer`, layer);
  assertNoLegacyAliases(layer);

  for (const dimension of LAYER_DIMENSIONS[scope]) {
    const layerValue = layer[dimension];
    const targetValue = targetContext[dimension];
    if (typeof layerValue !== 'string' || layerValue.trim() === '') {
      throw new TypeError(`${scope} layer ${dimension} is required`);
    }
    if (typeof targetValue !== 'string' || targetValue.trim() === '') {
      throw new TypeError(`resolution context ${dimension} is required for ${scope} layer`);
    }
    if (layerValue !== targetValue) {
      throw new TypeError(`${dimension} mismatch for ${scope} settings layer`);
    }
  }
}

function provenanceEntry(settingKey, scope, value, layer) {
  const context = {};
  for (const dimension of LAYER_DIMENSIONS[scope]) context[dimension] = layer[dimension];
  return Object.freeze({
    scope,
    value,
    storage_key: buildScopedStorageKey(settingKey, scope, context),
    company_id: scope === 'global' ? null : layer.company_id,
    grants_authority: false
  });
}

/**
 * Resolve one setting from default -> global -> company -> user -> device -> session.
 *
 * `entry.scope` remains the setting's canonical persistence target from Pass 3.
 * Pass 4 resolution layers are overlays/projections; they do not redefine ownership,
 * persistence scope, permissions or runtime authority.
 */
export function resolveSetting(settingKey, options = {}) {
  if (typeof settingKey !== 'string' || settingKey.trim() === '') {
    throw new TypeError('settingKey is required');
  }

  const entry = registryEntryFor(options.registry, settingKey);
  const context = options.context ?? {};
  assertPlainObject('resolution context', context);
  assertNoLegacyAliases(context);
  const layers = options.layers ?? {};
  assertPlainObject('settings layers', layers);

  let value = validateSettingValue(entry, entry.default);
  let sourceScope = 'default';
  const appliedLayers = [Object.freeze({
    scope: 'default',
    value,
    storage_key: null,
    company_id: null,
    grants_authority: false
  })];

  for (const scope of SETTINGS_RESOLUTION_ORDER.slice(1)) {
    const layer = layers[scope];
    if (layer == null) continue;
    validateLayerContext(scope, layer, context);
    const values = layer.values ?? {};
    assertPlainObject(`${scope} layer values`, values);
    if (!Object.hasOwn(values, settingKey)) continue;

    const candidate = validateSettingValue(entry, values[settingKey]);
    value = candidate;
    sourceScope = scope;
    appliedLayers.push(provenanceEntry(settingKey, scope, candidate, layer));
  }

  return Object.freeze({
    setting_key: settingKey,
    declared_scope: entry.scope,
    value,
    source_scope: sourceScope,
    company_id: typeof context.company_id === 'string' && context.company_id.trim() !== '' ? context.company_id : null,
    applied_layers: Object.freeze(appliedLayers),
    grants_authority: false
  });
}

export function resolveSettings(settingKeys, options = {}) {
  if (!Array.isArray(settingKeys)) throw new TypeError('settingKeys must be an array');
  const results = {};
  for (const settingKey of settingKeys) results[settingKey] = resolveSetting(settingKey, options);
  return Object.freeze(results);
}
