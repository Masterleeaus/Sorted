// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/settings-scope.mjs
/**
 * Titan Zero canonical Settings scope primitives.
 *
 * This module only establishes configuration ownership/isolation. It does
 * not grant runtime authority. All non-global scopes are company_id-bound.
 */

export const SETTINGS_SCOPES = Object.freeze(['global', 'company', 'user', 'device', 'session']);
export const SETTINGS_SCOPE_PRECEDENCE = Object.freeze(['session', 'device', 'user', 'company', 'global']);
export const COMPANY_BOUNDARY = 'company_id';
export const LEGACY_COMPANY_BOUNDARY_ALIASES = Object.freeze(['tenant_id', 'tenant_company_id']);

const REQUIRED_DIMENSIONS = Object.freeze({
  global: Object.freeze([]),
  company: Object.freeze(['company_id']),
  user: Object.freeze(['company_id', 'user_id']),
  device: Object.freeze(['company_id', 'device_id']),
  session: Object.freeze(['company_id', 'session_id'])
});

function assertNonEmptyString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} is required and must be a non-empty string`);
  }
  return value.trim();
}

function assertScope(scope) {
  if (!SETTINGS_SCOPES.includes(scope)) {
    throw new TypeError(`unsupported settings scope: ${String(scope)}`);
  }
}

function assertNoLegacyCompanyBoundaryAliases(context) {
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(context, alias)) {
      throw new TypeError(`legacy company boundary alias is not accepted: ${alias}; normalise to company_id before settings scope resolution`);
    }
  }
}

export function validateScopeContext(scope, context = {}) {
  assertScope(scope);
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('settings scope context must be an object');
  }

  assertNoLegacyCompanyBoundaryAliases(context);

  const validated = {};
  for (const dimension of REQUIRED_DIMENSIONS[scope]) {
    validated[dimension] = assertNonEmptyString(dimension, context[dimension]);
  }

  return Object.freeze(validated);
}

export function requiredDimensionsForScope(scope) {
  assertScope(scope);
  return [...REQUIRED_DIMENSIONS[scope]];
}

export function buildScopedStorageKey(settingKey, scope, context = {}) {
  const key = assertNonEmptyString('settingKey', settingKey);
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) {
    throw new TypeError(`invalid settingKey: ${key}`);
  }

  const validated = validateScopeContext(scope, context);
  const dimensions = REQUIRED_DIMENSIONS[scope].map((dimension) => encodeURIComponent(validated[dimension]));
  return ['tz.settings', scope, ...dimensions, key].join('.');
}

export function scopeDescriptor(scope, context = {}) {
  const dimensions = validateScopeContext(scope, context);
  return Object.freeze({
    scope,
    company_boundary: scope === 'global' ? null : COMPANY_BOUNDARY,
    dimensions,
    grants_authority: false
  });
}
