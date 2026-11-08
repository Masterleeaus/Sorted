// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/ai-cost-routing-settings.mjs
/**
 * Titan Zero AI Cost Routing Settings.
 *
 * Settings only express routing preferences. They do not grant entitlement,
 * budget, approval, privacy clearance, availability or execution authority.
 * The existing workforce intelligence router remains the execution policy owner.
 */
import { LEGACY_COMPANY_BOUNDARY_ALIASES } from './settings-scope.js';

export const AI_COST_ROUTE_ORDER = Object.freeze([
  'DEVICE_LOCAL',
  'CUSTOMER_LOCAL',
  'BYO_API',
  'BYO_SERVICE',
  'TITAN_ENTITLED',
  'TITAN_METERED_ADDON'
]);

export const TITAN_MANAGED_USAGE_POLICIES = Object.freeze(['never', 'entitled-only', 'approval-required']);

const DEFAULT_PREFERENCES = Object.freeze({
  device_local: true,
  customer_local: true,
  byo_api: true,
  byo_service: true,
  titan_entitled: false,
  titan_metered: false
});

const KEY_TO_TIER = Object.freeze({
  device_local: 'DEVICE_LOCAL',
  customer_local: 'CUSTOMER_LOCAL',
  byo_api: 'BYO_API',
  byo_service: 'BYO_SERVICE',
  titan_entitled: 'TITAN_ENTITLED',
  titan_metered: 'TITAN_METERED_ADDON'
});

function assertObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function validateCompany(input) {
  assertObject('AI cost routing input', input);
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(input, alias)) throw new TypeError(`legacy company boundary alias is not accepted: ${alias}; normalise to company_id before AI cost routing`);
  }
  if (typeof input.company_id !== 'string' || input.company_id.trim() === '') throw new TypeError('company_id is required');
  return input.company_id.trim();
}

function validateTitanPolicy(policy) {
  if (!TITAN_MANAGED_USAGE_POLICIES.includes(policy)) throw new TypeError(`unsupported Titan managed usage policy: ${String(policy)}`);
  return policy;
}

function normalizePreferences(value = {}) {
  assertObject('aiCostRoutingPreferences', value);
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'boolean') throw new TypeError(`aiCostRoutingPreferences.${key} must be boolean`);
      result[key] = value[key];
    }
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) throw new TypeError(`unknown AI cost routing preference: ${key}`);
  }
  return result;
}

function effectivePreferences(input) {
  const preferences = normalizePreferences(input.aiCostRoutingPreferences ?? {});
  const policy = validateTitanPolicy(input.aiTitanManagedUsagePolicy ?? 'never');
  if (policy === 'never') {
    preferences.titan_entitled = false;
    preferences.titan_metered = false;
  } else if (policy === 'entitled-only') {
    preferences.titan_metered = false;
  }
  return { preferences, policy };
}

export function projectAICostRoutingSettings(input = {}) {
  const company_id = validateCompany(input);
  const { preferences, policy } = effectivePreferences(input);
  return Object.freeze({
    schema: 'titan-zero-ai-cost-routing-settings-view/v1',
    company_id,
    route_order: AI_COST_ROUTE_ORDER,
    preferences: Object.freeze({ ...preferences }),
    titan_managed_usage_policy: policy,
    free_mode_enabled: input.freeModeEnabled !== false,
    execution_policy_owner: 'titan-workforce-intelligence-routing-runtime',
    automatic_titan_spend: false,
    authority_granted: false,
    execution_permitted: false,
    grants_authority: false
  });
}

export function buildAICostRoutePreferencePlan(input = {}) {
  const view = projectAICostRoutingSettings(input);
  const preferred = [];
  const blocked = [];
  const byTier = new Map(Object.entries(KEY_TO_TIER).map(([key, tier]) => [tier, key]));

  for (const tier of AI_COST_ROUTE_ORDER) {
    const key = byTier.get(tier);
    if (!view.preferences[key]) {
      blocked.push(Object.freeze({ tier, reason: 'disabled-by-settings-preference' }));
      continue;
    }
    if (tier === 'TITAN_METERED_ADDON' && view.free_mode_enabled) {
      blocked.push(Object.freeze({ tier, reason: 'free-tier-no-silent-titan-variable-cost' }));
      continue;
    }
    preferred.push(tier);
  }

  return Object.freeze({
    schema: 'titan-zero-ai-cost-route-preference-plan/v1',
    company_id: view.company_id,
    preferred_tiers: Object.freeze(preferred),
    blocked: Object.freeze(blocked),
    runtime_must_revalidate: Object.freeze(['availability', 'privacy', 'capability', 'entitlement', 'budget', 'metered-opt-in', 'authority']),
    automatic_titan_spend: false,
    grants_authority: false
  });
}

export function buildAICostRoutingPolicyProjection(input = {}) {
  const view = projectAICostRoutingSettings(input);
  const plan = buildAICostRoutePreferencePlan(input);
  return Object.freeze({
    schema: 'titan-zero-ai-cost-routing-policy-projection/v1',
    company_id: view.company_id,
    preference_plan: plan,
    runtime_policy_patch: Object.freeze({
      route_preference: plan.preferred_tiers,
      free_tier: view.free_mode_enabled,
      allow_metered_titan_by_default: false,
      automatic_titan_spend: false,
      automatic_authority_change: false,
      authority_granted: false,
      execution_permitted: false
    }),
    gates: Object.freeze({
      titan_entitled: 'runtime-entitlement-required',
      titan_metered: 'explicit-runtime-approval-required',
      budget: 'runtime-budget-required',
      authority: 'runtime-authority-required'
    }),
    settings_can_bypass_entitlements: false,
    settings_can_bypass_authority: false,
    settings_can_enable_silent_titan_spend: false,
    grants_authority: false
  });
}
