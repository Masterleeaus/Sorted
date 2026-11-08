// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/ai-provider-control-centre.mjs
/**
 * Titan Zero AI Provider Control Centre.
 *
 * This is a settings/control projection over the existing BYO provider records.
 * It never moves credentials into generic Settings and never grants execution
 * authority. Existing provider records are preserved in place when order or
 * enabled state changes.
 */

import { LEGACY_COMPANY_BOUNDARY_ALIASES } from './settings-scope.js';

export const PROVIDER_FALLBACK_POLICIES = Object.freeze(['manual', 'ordered-enabled']);

const CREDENTIAL_FIELD_PATTERN = /(api[-_]?keys?|token|password|secret|credential)/i;

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

function assertNoLegacyAliases(input) {
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(input, alias)) {
      throw new TypeError(`legacy company boundary alias is not accepted: ${alias}; normalise to company_id before provider control`);
    }
  }
}

function validateCompanyInput(input) {
  assertPlainObject('provider control input', input);
  assertNoLegacyAliases(input);
  return assertNonEmptyString('company_id', input.company_id);
}

function validateFallbackPolicy(policy) {
  if (!PROVIDER_FALLBACK_POLICIES.includes(policy)) {
    throw new TypeError(`unsupported provider fallback policy: ${String(policy)}`);
  }
  return policy;
}

function validateProviderConfigs(providerConfigs) {
  if (!Array.isArray(providerConfigs)) throw new TypeError('providerConfigs must be an array');
  const seen = new Set();
  return providerConfigs.map((record, index) => {
    assertPlainObject(`providerConfigs[${index}]`, record);
    const providerId = assertNonEmptyString(`providerConfigs[${index}].providerId`, record.providerId);
    if (seen.has(providerId)) throw new TypeError(`duplicate provider id in providerConfigs: ${providerId}`);
    seen.add(providerId);
    return record;
  });
}

function hasCredentialMaterial(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value)) {
    if (CREDENTIAL_FIELD_PATTERN.test(key)) {
      if (Array.isArray(nested)) return nested.some((item) => typeof item === 'string' && item.trim() !== '');
      return nested != null && String(nested).trim() !== '';
    }
    if (nested && typeof nested === 'object' && hasCredentialMaterial(nested)) return true;
  }
  return false;
}

function publicProviderProjection(record, priority) {
  return Object.freeze({
    provider_id: record.providerId,
    name: typeof record.name === 'string' && record.name.trim() !== '' ? record.name : record.providerId,
    model_id: typeof record.modelId === 'string' && record.modelId.trim() !== '' ? record.modelId : null,
    enabled: record.enabled !== false,
    priority,
    base_url: typeof record.baseUrl === 'string' && record.baseUrl.trim() !== '' ? record.baseUrl : null,
    has_credentials: hasCredentialMaterial(record),
    grants_authority: false
  });
}

function assertUniqueIdList(name, ids) {
  if (!Array.isArray(ids)) throw new TypeError(`${name} must be an array`);
  const seen = new Set();
  return ids.map((id, index) => {
    const normalized = assertNonEmptyString(`${name}[${index}]`, id);
    if (seen.has(normalized)) throw new TypeError(`duplicate provider id in ${name}: ${normalized}`);
    seen.add(normalized);
    return normalized;
  });
}

export function projectProviderControlCentre(input = {}) {
  const company_id = validateCompanyInput(input);
  const providerConfigs = validateProviderConfigs(input.providerConfigs ?? []);
  const fallback_policy = validateFallbackPolicy(input.fallbackPolicy ?? 'manual');

  return Object.freeze({
    schema: 'titan-zero-ai-provider-control-view/v1',
    company_id,
    fallback_policy,
    providers: Object.freeze(providerConfigs.map((record, index) => publicProviderProjection(record, index + 1))),
    credential_storage: 'existing-byo-provider-records',
    credentials_exposed: false,
    grants_authority: false
  });
}

export function applyProviderControlChange(input = {}) {
  const company_id = validateCompanyInput(input);
  const providerConfigs = validateProviderConfigs(input.providerConfigs ?? []);
  const fallbackPolicy = validateFallbackPolicy(input.fallbackPolicy ?? 'manual');
  const orderedProviderIds = assertUniqueIdList(
    'orderedProviderIds',
    input.orderedProviderIds ?? providerConfigs.map((record) => record.providerId)
  );
  const enabledProviderIds = assertUniqueIdList(
    'enabledProviderIds',
    input.enabledProviderIds ?? providerConfigs.filter((record) => record.enabled !== false).map((record) => record.providerId)
  );

  const byId = new Map(providerConfigs.map((record) => [record.providerId, record]));
  for (const providerId of orderedProviderIds) {
    if (!byId.has(providerId)) throw new TypeError(`unknown provider id in orderedProviderIds: ${providerId}`);
  }
  if (orderedProviderIds.length !== providerConfigs.length) {
    throw new TypeError('orderedProviderIds must contain every existing provider exactly once');
  }
  for (const providerId of enabledProviderIds) {
    if (!byId.has(providerId)) throw new TypeError(`unknown provider id in enabledProviderIds: ${providerId}`);
  }

  const enabled = new Set(enabledProviderIds);
  const updatedProviderConfigs = orderedProviderIds.map((providerId) => {
    const original = byId.get(providerId);
    const cloned = structuredClone(original);
    cloned.enabled = enabled.has(providerId);
    return cloned;
  });

  return Object.freeze({
    schema: 'titan-zero-ai-provider-control-change/v1',
    company_id,
    providerConfigs: Object.freeze(updatedProviderConfigs),
    settingsPatch: Object.freeze({ aiProviderFallbackPolicy: fallbackPolicy }),
    existing_provider_storage_preserved: true,
    credentials_moved: false,
    grants_authority: false
  });
}

export function buildProviderFallbackPlan(input = {}) {
  assertPlainObject('provider fallback input', input);
  const providerConfigs = validateProviderConfigs(input.providerConfigs ?? []);
  const fallbackPolicy = validateFallbackPolicy(input.fallbackPolicy ?? 'manual');
  if (fallbackPolicy === 'manual') return Object.freeze([]);

  const currentProviderId = input.currentProviderId == null
    ? null
    : assertNonEmptyString('currentProviderId', input.currentProviderId);
  const enabledIds = providerConfigs
    .filter((record) => record.enabled !== false)
    .map((record) => record.providerId);

  if (currentProviderId == null) return Object.freeze(enabledIds);
  const currentIndex = enabledIds.indexOf(currentProviderId);
  if (currentIndex === -1) return Object.freeze(enabledIds);
  return Object.freeze(enabledIds.slice(currentIndex + 1));
}
