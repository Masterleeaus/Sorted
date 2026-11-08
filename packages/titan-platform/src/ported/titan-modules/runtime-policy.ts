// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/runtime-policy.mjs
import {satisfiesVersion} from './semver.js';

export const MODULE_RUNTIME_VERSION = '2.0.0';

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

export function normalizeRuntimePolicy(input={}) {
  const compatibility = input?.compatibility && typeof input.compatibility === 'object' ? input.compatibility : {};
  const lifecycle = input?.lifecycle && typeof input.lifecycle === 'object' ? input.lifecycle : {};
  const failure = input?.failure && typeof input.failure === 'object' ? input.failure : {};
  const failurePolicy = ['isolate','disable'].includes(String(failure.failure_policy || '').toLowerCase())
    ? String(failure.failure_policy).toLowerCase()
    : 'isolate';
  return {
    compatibility: {
      module_runtime: String(compatibility.module_runtime || '^2.0.0').trim() || '^2.0.0',
      titan_zero: String(compatibility.titan_zero || '*').trim() || '*',
    },
    lifecycle: {
      activation_timeout_ms: clampInt(lifecycle.activation_timeout_ms, 5000, 250, 60000),
      deactivation_timeout_ms: clampInt(lifecycle.deactivation_timeout_ms, 5000, 250, 60000),
    },
    failure: {
      failure_threshold: clampInt(failure.failure_threshold, 3, 1, 20),
      failure_policy: failurePolicy,
    },
  };
}

export function assertRuntimeCompatibility(policyOrManifest={}, runtimeVersion=MODULE_RUNTIME_VERSION, titanZeroVersion=null) {
  const policy = normalizeRuntimePolicy(policyOrManifest.runtime || policyOrManifest);
  if (!satisfiesVersion(runtimeVersion, policy.compatibility.module_runtime)) {
    throw new Error(`Module requires module runtime ${policy.compatibility.module_runtime}; current runtime is ${runtimeVersion}`);
  }
  if (titanZeroVersion && policy.compatibility.titan_zero !== '*' && !satisfiesVersion(titanZeroVersion, policy.compatibility.titan_zero)) {
    throw new Error(`Module requires Titan Zero ${policy.compatibility.titan_zero}; current Titan Zero is ${titanZeroVersion}`);
  }
  return true;
}

export function createFailureState() {
  return {failure_count:0, quarantined:false, last_error:null, last_failure_at:null};
}

export function recordRuntimeFailure(state, policyInput, error) {
  const policy = normalizeRuntimePolicy(policyInput);
  const next = {...createFailureState(), ...(state || {})};
  next.failure_count = Number(next.failure_count || 0) + 1;
  next.last_error = String(error?.message || error || 'unknown module failure');
  next.last_failure_at = new Date().toISOString();
  if (next.failure_count >= policy.failure.failure_threshold) next.quarantined = true;
  return next;
}

export function clearRuntimeFailures(state={}) {
  return {...state, failure_count:0, quarantined:false, last_error:null, last_failure_at:null};
}

export function isRuntimeQuarantined(state) {
  return Boolean(state?.quarantined);
}

export async function withLifecycleTimeout(promiseOrFactory, timeoutMs, label='module lifecycle') {
  const task = typeof promiseOrFactory === 'function' ? Promise.resolve().then(promiseOrFactory) : Promise.resolve(promiseOrFactory);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try { return await Promise.race([task, timeout]); }
  finally { clearTimeout(timer); }
}
