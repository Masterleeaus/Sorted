// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/model-selection-policy.mjs
/**
 * Titan Zero Model Selection Policy.
 *
 * Company-scoped Settings may express preferred provider/model pairs by workload.
 * This module only builds a deterministic selection plan from candidates that the
 * real runtime reports. It does not discover providers, move credentials, spend,
 * approve, entitle, or execute model calls.
 */
import { LEGACY_COMPANY_BOUNDARY_ALIASES } from './settings-scope.js';
import { PROVIDER_FALLBACK_POLICIES } from './ai-provider-control-centre.js';

export const MODEL_WORKLOADS = Object.freeze(['chat', 'research', 'reasoning', 'extraction', 'vision']);
const CREDENTIAL_FIELD_PATTERN = /(api[-_]?keys?|token|password|secret|credential)/i;

function object(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function text(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}
function company(input, label = 'model selection input') {
  object(label, input);
  for (const alias of LEGACY_COMPANY_BOUNDARY_ALIASES) {
    if (Object.hasOwn(input, alias)) throw new TypeError(`legacy company boundary alias is not accepted: ${alias}; normalise to company_id first`);
  }
  return text('company_id', input.company_id);
}
function workload(value) {
  const normalized = text('workload', value).toLowerCase();
  if (!MODEL_WORKLOADS.includes(normalized)) throw new TypeError(`unsupported model workload: ${normalized}`);
  return normalized;
}
function selector(raw, label = 'model selector') {
  object(label, raw);
  return Object.freeze({
    provider_id: text(`${label}.provider_id`, raw.provider_id),
    model_id: text(`${label}.model_id`, raw.model_id)
  });
}
function normalizeProfiles(raw = {}) {
  object('aiModelSelectionPolicy.profiles', raw);
  const result = {};
  for (const key of MODEL_WORKLOADS) {
    const list = raw[key] ?? [];
    if (!Array.isArray(list)) throw new TypeError(`aiModelSelectionPolicy.profiles.${key} must be an array`);
    const seen = new Set();
    result[key] = Object.freeze(list.map((item, i) => {
      const out = selector(item, `aiModelSelectionPolicy.profiles.${key}[${i}]`);
      const id = `${out.provider_id}\u0000${out.model_id}`;
      if (seen.has(id)) throw new TypeError(`duplicate model selector in ${key}: ${out.provider_id}/${out.model_id}`);
      seen.add(id);
      return out;
    }));
  }
  for (const key of Object.keys(raw)) {
    if (!MODEL_WORKLOADS.includes(key)) throw new TypeError(`unsupported workload profile: ${key}`);
  }
  return Object.freeze(result);
}
function normalizePolicy(input = {}) {
  const raw = input.aiModelSelectionPolicy ?? {};
  object('aiModelSelectionPolicy', raw);
  return Object.freeze({
    profiles: normalizeProfiles(raw.profiles ?? {}),
    preserve_current_chat_model: raw.preserve_current_chat_model !== false
  });
}
function validateProviderConfigs(providerConfigs = []) {
  if (!Array.isArray(providerConfigs)) throw new TypeError('providerConfigs must be an array');
  const seen = new Set();
  return providerConfigs.map((record, i) => {
    object(`providerConfigs[${i}]`, record);
    const providerId = text(`providerConfigs[${i}].providerId`, record.providerId);
    if (seen.has(providerId)) throw new TypeError(`duplicate provider id in providerConfigs: ${providerId}`);
    seen.add(providerId);
    return record;
  });
}
function providerPublic(record, priority) {
  return Object.freeze({
    provider_id: record.providerId,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : record.providerId,
    model_id: typeof record.modelId === 'string' && record.modelId.trim() ? record.modelId.trim() : null,
    enabled: record.enabled !== false,
    priority,
    has_credentials: Object.entries(record).some(([key, value]) => CREDENTIAL_FIELD_PATTERN.test(key) && value != null && (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '')),
    grants_authority: false
  });
}
function candidate(raw, i) {
  object(`candidateModels[${i}]`, raw);
  const workloads = raw.workloads ?? MODEL_WORKLOADS;
  if (!Array.isArray(workloads)) throw new TypeError(`candidateModels[${i}].workloads must be an array`);
  const normalizedWorkloads = workloads.map(workload);
  return Object.freeze({
    route_kind: text(`candidateModels[${i}].route_kind`, raw.route_kind),
    provider_id: text(`candidateModels[${i}].provider_id`, raw.provider_id),
    model_id: text(`candidateModels[${i}].model_id`, raw.model_id),
    workloads: Object.freeze(normalizedWorkloads),
    available: raw.available === true,
    cost_gate_allowed: raw.cost_gate_allowed === true,
    index: i
  });
}
function validateFallbackPolicy(value) {
  const policy = value ?? 'manual';
  if (!PROVIDER_FALLBACK_POLICIES.includes(policy)) throw new TypeError(`unsupported provider fallback policy: ${String(policy)}`);
  return policy;
}
function publicCandidate(c) {
  return Object.freeze({ route_kind: c.route_kind, provider_id: c.provider_id, model_id: c.model_id });
}
function rejection(c, reason) {
  return Object.freeze({ ...publicCandidate(c), reason });
}
function isProviderBacked(c) {
  return c.route_kind === 'byo_api' || c.route_kind === 'byo_service';
}
function assess(c, enabledProviders) {
  if (!c.available) return 'MODEL_NOT_AVAILABLE';
  if (!c.cost_gate_allowed) return 'COST_GATE_BLOCKED';
  if (isProviderBacked(c) && !enabledProviders.has(c.provider_id)) return 'PROVIDER_DISABLED';
  return null;
}

export function projectModelSelectionPolicy(input = {}) {
  const company_id = company(input);
  const policy = normalizePolicy(input);
  const providers = validateProviderConfigs(input.providerConfigs ?? []).map(providerPublic);
  return Object.freeze({
    schema: 'titan-zero-model-selection-policy-view/v1',
    company_id,
    workloads: MODEL_WORKLOADS,
    profiles: policy.profiles,
    preserve_current_chat_model: policy.preserve_current_chat_model,
    providers: Object.freeze(providers),
    provider_credentials_exposed: false,
    selection_is_preference_only: true,
    runtime_must_revalidate: Object.freeze(['provider-availability', 'cost-route', 'budget', 'entitlement', 'approval', 'authority']),
    execution_permitted: false,
    grants_authority: false
  });
}

export function buildWorkloadModelPlan(input = {}) {
  const company_id = company(input);
  const targetWorkload = workload(input.workload);
  const policy = normalizePolicy(input);
  const providers = validateProviderConfigs(input.providerConfigs ?? []);
  const providerOrder = new Map(providers.map((p, i) => [p.providerId, i]));
  const enabledProviders = new Set(providers.filter((p) => p.enabled !== false).map((p) => p.providerId));
  const candidates = (input.candidateModels ?? []).map(candidate).filter((c) => c.workloads.includes(targetWorkload));
  const fallbackPolicy = validateFallbackPolicy(input.fallbackPolicy);
  const byKey = new Map(candidates.map((c) => [`${c.provider_id}\u0000${c.model_id}`, c]));
  const rejected = [];
  let selected = null;
  let selection_source = 'none';

  for (const pref of policy.profiles[targetWorkload]) {
    const c = byKey.get(`${pref.provider_id}\u0000${pref.model_id}`);
    if (!c) {
      rejected.push(Object.freeze({ provider_id: pref.provider_id, model_id: pref.model_id, route_kind: null, reason: 'MODEL_NOT_AVAILABLE' }));
      continue;
    }
    const reason = assess(c, enabledProviders);
    if (reason) { rejected.push(rejection(c, reason)); continue; }
    selected = publicCandidate(c);
    selection_source = 'workload-preference';
    break;
  }

  if (!selected && fallbackPolicy === 'ordered-enabled') {
    const eligible = [];
    for (const c of candidates) {
      const reason = assess(c, enabledProviders);
      if (reason) {
        if (!rejected.some((x) => x.provider_id === c.provider_id && x.model_id === c.model_id && x.reason === reason)) rejected.push(rejection(c, reason));
        continue;
      }
      eligible.push(c);
    }
    eligible.sort((a, b) => {
      const pa = providerOrder.has(a.provider_id) ? providerOrder.get(a.provider_id) : Number.MAX_SAFE_INTEGER;
      const pb = providerOrder.has(b.provider_id) ? providerOrder.get(b.provider_id) : Number.MAX_SAFE_INTEGER;
      return pa - pb || a.index - b.index || a.model_id.localeCompare(b.model_id);
    });
    if (eligible.length) {
      selected = publicCandidate(eligible[0]);
      selection_source = 'provider-order-fallback';
    }
  }

  return Object.freeze({
    schema: 'titan-zero-workload-model-plan/v1',
    company_id,
    workload: targetWorkload,
    selected,
    selection_source,
    rejected: Object.freeze(rejected),
    provider_fallback_policy: fallbackPolicy,
    provider_credentials_exposed: false,
    runtime_must_revalidate: Object.freeze(['provider-availability', 'cost-route', 'budget', 'entitlement', 'approval', 'authority']),
    execution_permitted: false,
    grants_authority: false
  });
}

export function applyModelSelectionPolicyChange(input = {}) {
  const company_id = company(input);
  const profiles = normalizeProfiles(input.profiles ?? {});
  const preserve_current_chat_model = input.preserve_current_chat_model !== false;
  return Object.freeze({
    schema: 'titan-zero-model-selection-policy-change/v1',
    company_id,
    settingsPatch: Object.freeze({
      aiModelSelectionPolicy: Object.freeze({ profiles, preserve_current_chat_model })
    }),
    existing_chat_model_storage_preserved: true,
    provider_credentials_moved: false,
    execution_permitted: false,
    grants_authority: false
  });
}
