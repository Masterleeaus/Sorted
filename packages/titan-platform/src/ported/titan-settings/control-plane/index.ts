// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/index.mjs
export { interpretSettingsLanguage } from './settings-ai-language.js';
export { interpretSettingsRequest, proposeSettingsAction, executeSettingsAction, SETTINGS_ACTION_BRIDGE_VERSION } from './settings-action-bridge.js';
export { createChromeSettingsAdapter } from './settings-storage-adapter.js';
export { resolveSetting, resolveSettings, SETTINGS_RESOLUTION_ORDER } from './settings-resolution.js';
export { SETTINGS_SCOPES, SETTINGS_SCOPE_PRECEDENCE, COMPANY_BOUNDARY, buildScopedStorageKey, validateScopeContext, scopeDescriptor } from './settings-scope.js';
