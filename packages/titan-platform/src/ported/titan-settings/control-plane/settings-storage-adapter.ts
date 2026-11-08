// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-settings/control-plane/settings-storage-adapter.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/**
 * Compatibility adapter for existing Chrome-extension Settings storage.
 *
 * Canonical scoped values are stored under Pass 3 scoped keys. For settings
 * already consumed by the existing extension bundles, the adapter also mirrors
 * the value to the existing raw key so current runtime behavior changes now.
 * The adapter is bound to one active company_id to prevent cross-company use.
 */

import { buildScopedStorageKey, validateScopeContext } from './settings-scope.js';

function chromeLocal(chromeLike) {
  const local = chromeLike?.storage?.local;
  if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') {
    throw new TypeError('chrome.storage.local compatible adapter is required');
  }
  return local;
}

function runtimeMirrorAllowed(key) {
  return typeof key === 'string' && key.length > 0;
}

export function createChromeSettingsAdapter(chromeLike, { active_company_id } = {}) {
  if (typeof active_company_id !== 'string' || active_company_id.trim() === '') {
    throw new TypeError('active_company_id is required for Chrome settings adapter');
  }
  const companyId = active_company_id.trim();
  const local = chromeLocal(chromeLike);

  function assertBoundContext(scope, context) {
    const validated = validateScopeContext(scope, context);
    if (scope !== 'global' && validated.company_id !== companyId) {
      throw new TypeError('settings adapter company_id mismatch');
    }
    return validated;
  }

  return Object.freeze({
    kind: 'chrome-settings-compatibility-adapter',
    active_company_id: companyId,
    grants_authority: false,
    async read({ key, scope, context }) {
      assertBoundContext(scope, context);
      const scopedKey = buildScopedStorageKey(key, scope, context);
      const scoped = await local.get(scopedKey);
      if (Object.hasOwn(scoped ?? {}, scopedKey)) return scoped[scopedKey];
      const legacy = await local.get(key);
      return legacy?.[key];
    },
    async write({ key, value, scope, context }) {
      assertBoundContext(scope, context);
      const scopedKey = buildScopedStorageKey(key, scope, context);
      const writes = { [scopedKey]: value };
      if (runtimeMirrorAllowed(key)) writes[key] = value;
      await local.set(writes);
    },
  });
}
