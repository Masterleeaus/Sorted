// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/ai-budget-controls.mjs
/**
 * Titan Zero AI Budget Controls.
 * Settings describe budget preferences only. Existing workforce financial-resource
 * guardrails remain the enforcement owner and all protected spend still needs fresh authority.
 */
import { LEGACY_COMPANY_BOUNDARY_ALIASES } from './settings-scope.js';

export const AI_BUDGET_MODES = Object.freeze(['disabled', 'approval-required', 'hard-limit']);
export const AI_BUDGET_PERIODS = Object.freeze(['TASK', 'DAILY', 'WEEKLY', 'MONTHLY']);

function assertObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function assertCompany(input, label = 'AI budget input') {
  assertObject(label, input);
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(input, alias)) throw new TypeError(`legacy company boundary alias is not accepted: ${alias}; normalise to company_id first`);
  }
  if (typeof input.company_id !== 'string' || !input.company_id.trim()) throw new TypeError('company_id is required');
  return input.company_id.trim();
}
function amount(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a finite non-negative number`);
  return value;
}
function cleanKey(value) {
  const key = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(key)) throw new TypeError(`invalid AI budget category: ${String(value)}`);
  return key;
}
function normalizeThresholds(category, raw) {
  assertObject(`aiBudgetControls.categories.${category}`, raw);
  const enabled = raw.enabled !== false;
  const hard_limit = amount(`${category}.hard_limit`, raw.hard_limit ?? 0);
  const warning_threshold = amount(`${category}.warning_threshold`, raw.warning_threshold ?? hard_limit);
  const review_threshold = amount(`${category}.review_threshold`, raw.review_threshold ?? hard_limit);
  if (warning_threshold > review_threshold || review_threshold > hard_limit) {
    throw new TypeError(`invalid threshold ordering for ${category}: warning_threshold <= review_threshold <= hard_limit is required`);
  }
  return Object.freeze({ enabled, warning_threshold, review_threshold, hard_limit });
}
function normalizeControls(input) {
  const raw = input.aiBudgetControls ?? {};
  assertObject('aiBudgetControls', raw);
  const categoriesRaw = raw.categories ?? {};
  assertObject('aiBudgetControls.categories', categoriesRaw);
  const categories = {};
  for (const [key, value] of Object.entries(categoriesRaw)) categories[cleanKey(key)] = normalizeThresholds(cleanKey(key), value);
  let mode = raw.mode ?? (Object.keys(categories).length ? 'approval-required' : 'disabled');
  if (!AI_BUDGET_MODES.includes(mode)) throw new TypeError(`unsupported AI budget mode: ${String(mode)}`);
  const currency = String(raw.currency ?? 'AUD').trim().toUpperCase() || 'AUD';
  const period = String(raw.period ?? 'MONTHLY').trim().toUpperCase();
  if (!AI_BUDGET_PERIODS.includes(period)) throw new TypeError(`unsupported AI budget period: ${period}`);
  if (mode === 'hard-limit') {
    for (const [key, value] of Object.entries(categories)) categories[key] = Object.freeze({ ...value, review_threshold: value.hard_limit });
  }
  return { mode, currency, period, categories: Object.freeze(categories) };
}
function legacyCeiling(input) {
  const limit = amount('creditCeiling', input.creditCeiling ?? 0);
  return Object.freeze({ enabled: input.creditCeilingEnabled === true && limit > 0, limit });
}

export function projectAIBudgetSettings(input = {}) {
  const company_id = assertCompany(input);
  const normalized = normalizeControls(input);
  return Object.freeze({
    schema: 'titan-zero-ai-budget-settings-view/v1',
    company_id,
    mode: normalized.mode,
    currency: normalized.currency,
    period: normalized.period,
    categories: normalized.categories,
    legacy_credit_ceiling: legacyCeiling(input),
    execution_policy_owner: 'titan-workforce-financial-resource-guardrail-runtime',
    runtime_budget_still_required: true,
    runtime_entitlement_still_required: true,
    automatic_spend: false,
    automatic_spend_approval: false,
    execution_permitted: false,
    grants_authority: false
  });
}

export function buildAIBudgetGuardrailProjection(input = {}) {
  const view = projectAIBudgetSettings(input);
  const limits = [];
  const warning_thresholds = {};
  for (const [category, cfg] of Object.entries(view.categories)) {
    if (!cfg.enabled || view.mode === 'disabled') continue;
    limits.push(Object.freeze({
      company_id: view.company_id,
      resource_key: `ai-budget:${category}`,
      resource_kind: 'MONEY',
      currency: view.currency,
      period: view.period,
      hard_limit: cfg.hard_limit,
      review_threshold: view.mode === 'hard-limit' ? cfg.hard_limit : cfg.review_threshold,
      requires_explicit_paid_opt_in: true,
      paid_opt_in: false,
      automatic_spend: false,
      authority_granted: false,
      execution_permitted: false,
      grants_authority: false
    }));
    warning_thresholds[category] = cfg.warning_threshold;
  }
  if (!limits.length && view.legacy_credit_ceiling.enabled) {
    const hard = view.legacy_credit_ceiling.limit;
    limits.push(Object.freeze({
      company_id: view.company_id,
      resource_key: 'ai-budget:system_ai',
      resource_kind: 'MONEY',
      currency: view.currency,
      period: 'TASK',
      hard_limit: hard,
      review_threshold: hard,
      requires_explicit_paid_opt_in: true,
      paid_opt_in: false,
      automatic_spend: false,
      authority_granted: false,
      execution_permitted: false,
      grants_authority: false
    }));
    warning_thresholds.system_ai = hard;
  }
  return Object.freeze({
    schema: 'titan-zero-ai-budget-guardrail-projection/v1',
    company_id: view.company_id,
    mode: view.mode,
    limits: Object.freeze(limits),
    warning_thresholds: Object.freeze(warning_thresholds),
    execution_policy_owner: 'titan-workforce-financial-resource-guardrail-runtime',
    runtime_must_revalidate: Object.freeze(['budget-ledger', 'provider-cost', 'paid-opt-in', 'entitlement', 'approval', 'authority']),
    runtime_usage_state_required: true,
    automatic_spend: false,
    automatic_authority_change: false,
    execution_permitted: false,
    grants_authority: false
  });
}

export function evaluateAIBudgetAdvisory(settingsInput = {}, usage = {}) {
  const view = projectAIBudgetSettings(settingsInput);
  const usageCompany = assertCompany(usage, 'AI budget usage');
  if (usageCompany !== view.company_id) throw new TypeError('cross-company AI budget advisory is not permitted');
  const category = cleanKey(usage.category);
  const spent = amount('spent', usage.spent ?? 0);
  const reserved = amount('reserved', usage.reserved ?? 0);
  const current_commitment = spent + reserved;
  let cfg = view.categories[category];
  if (!cfg && category === 'system_ai' && view.legacy_credit_ceiling.enabled) {
    const x = view.legacy_credit_ceiling.limit;
    cfg = { enabled: true, warning_threshold: x, review_threshold: x, hard_limit: x };
  }
  if (!cfg || !cfg.enabled || view.mode === 'disabled') {
    return Object.freeze({schema:'titan-zero-ai-budget-advisory/v1',company_id:view.company_id,category,state:'UNCONFIGURED',current_commitment,grants_authority:false,execution_permitted:false});
  }
  const review = view.mode === 'hard-limit' ? cfg.hard_limit : cfg.review_threshold;
  let state = 'WITHIN_BUDGET';
  if (current_commitment > cfg.hard_limit) state = 'HARD_LIMIT_BLOCKED';
  else if (current_commitment >= review && review < cfg.hard_limit) state = 'REVIEW_REQUIRED';
  else if (current_commitment >= cfg.warning_threshold) state = 'WARNING';
  return Object.freeze({schema:'titan-zero-ai-budget-advisory/v1',company_id:view.company_id,category,state,current_commitment,warning_threshold:cfg.warning_threshold,review_threshold:review,hard_limit:cfg.hard_limit,automatic_spend:false,grants_authority:false,execution_permitted:false});
}

// Compatibility aliases for early Pass 8 callers.
export const projectAIBudgetControls = projectAIBudgetSettings;
export const buildAIBudgetRuntimeProjection = buildAIBudgetGuardrailProjection;
export function evaluateAIBudgetGuard(input = {}) {
  const settings = { ...input };
  const usage = { company_id: input.company_id, category: input.capability, spent: input.spent ?? 0, reserved: input.estimated_cost ?? 0 };
  return evaluateAIBudgetAdvisory(settings, usage);
}
