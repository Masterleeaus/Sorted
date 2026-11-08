// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/settings-ai-language.mjs
/**
 * Deterministic natural-language mapping for Titan Zero Settings.
 *
 * This module only maps explicit user language to already-registered setting
 * keys and values. It never creates new settings and never grants authority.
 */

const BOOLEAN_ALIASES = Object.freeze([
  ['webSearchEnabled', ['web search', 'web research', 'internet search']],
  ['imageGenerationEnabled', ['image generation', 'generate images', 'image generator']],
  ['mcpExecutionsEnabled', ['mcp execution', 'mcp executions', 'mcp tools']],
  ['requireMcpConfirmation', ['mcp confirmation', 'confirm mcp', 'mcp confirmations']],
  ['privateMode', ['private mode', 'privacy mode', 'zero data retention']],
  ['freeModeEnabled', ['free mode']],
  ['closeTabsAfterExecution', ['close tabs after execution', 'close tabs after tasks', 'auto close tabs']],
  ['disableAutoScroll', ['disable auto scroll', 'disable autoscroll', 'auto scroll', 'autoscroll']],
  ['codePlanDataDoneReviewGate', ['review gate', 'data done review gate', 'code plan review gate']],
  ['creditCeilingEnabled', ['credit ceiling', 'credit limit']],
  ['creditToolsEnabled', ['credit tools']],
  ['cloudScrapeEnabled', ['cloud scrape', 'cloud scraping']],
  ['enrichEnabled', ['enrichment', 'enrich']],
]);

const NUMERIC_ALIASES = Object.freeze([
  ['creditCeiling', ['credit ceiling', 'credit limit']],
  ['pageLoadDelay', ['page load delay']],
  ['consecutiveScrollDelay', ['scroll delay', 'consecutive scroll delay']],
  ['maxParallelTabs', ['max parallel tabs', 'maximum parallel tabs', 'parallel tabs']],
  ['codePlanTimeoutMinutes', ['code plan timeout', 'plan timeout']],
]);

const READ_ALIASES = Object.freeze([
  ['titanZeroTheme', ['theme', 'dark mode', 'light mode']],
  ...BOOLEAN_ALIASES,
  ...NUMERIC_ALIASES,
]);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9.%+'\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function registryMap(registry) {
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.settings)) {
    throw new TypeError('canonical settings registry is required');
  }
  return new Map(registry.settings.map((entry) => [entry.key, entry]));
}

function registeredAliasMatches(text, aliases, registryByKey) {
  const hits = [];
  for (const [key, names] of aliases) {
    if (!registryByKey.has(key)) continue;
    const matched = names.filter((name) => text.includes(name));
    if (matched.length) hits.push({ key, matched, longest: Math.max(...matched.map((name) => name.length)) });
  }
  return hits.sort((a, b) => b.longest - a.longest || a.key.localeCompare(b.key));
}

function booleanValueFor(text, key) {
  const positive = /\b(enable|enabled|turn on|switch on|allow|use)\b/.test(text);
  const negative = /\b(disable|disabled|turn off|switch off|stop|block)\b/.test(text);
  if (positive && negative) return { confident: false, reason: 'conflicting-boolean-language' };
  if (!positive && !negative) return { confident: false, reason: 'boolean-state-not-explicit' };

  // disableAutoScroll is a negatively named storage key. "turn off auto scroll"
  // means the canonical value is true; "turn on auto scroll" means false.
  if (key === 'disableAutoScroll') {
    return { confident: true, value: negative };
  }
  return { confident: true, value: positive };
}

function numericValueFor(text) {
  const match = text.match(/(?:to|at|=)?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return { confident: false, reason: 'numeric-value-not-explicit' };
  const value = Number(match[1]);
  return Number.isFinite(value) ? { confident: true, value } : { confident: false, reason: 'numeric-value-invalid' };
}

function readIntent(text) {
  if (/\b(show|list|open)\b.*\bsettings\b/.test(text) || /^settings$/.test(text)) return 'settings.list';
  if (/\b(what|which|show|tell|current)\b/.test(text) && /\b(setting|settings|mode|theme)\b/.test(text)) return 'settings.read';
  return null;
}

export function interpretSettingsLanguage(inputText, { registry } = {}) {
  const text = normalize(inputText);
  if (!text) throw new TypeError('settings request text is required');
  const byKey = registryMap(registry);

  const read = readIntent(text);
  if (read === 'settings.list') {
    return Object.freeze({
      intent: 'settings.list', confident: true, needs_clarification: false,
      setting_key: null, value: null, normalized_text: text, grants_authority: false,
    });
  }
  if (read === 'settings.read') {
    const hits = registeredAliasMatches(text, READ_ALIASES, byKey);
    if (hits.length === 1 || (hits.length > 1 && hits[0].longest > hits[1].longest)) {
      return Object.freeze({
        intent: 'settings.read', confident: true, needs_clarification: false,
        setting_key: hits[0].key, value: null, normalized_text: text, grants_authority: false,
      });
    }
    return Object.freeze({
      intent: 'settings.read', confident: false, needs_clarification: true,
      setting_key: null, value: null, normalized_text: text, reason: 'setting-not-unambiguous', grants_authority: false,
    });
  }

  if (text.includes('dark mode') || /\btheme\b.*\bdark\b/.test(text)) {
    if (byKey.has('titanZeroTheme')) return Object.freeze({ intent: 'settings.change', confident: true, needs_clarification: false, setting_key: 'titanZeroTheme', value: 'dark', normalized_text: text, grants_authority: false });
  }
  if (text.includes('light mode') || /\btheme\b.*\blight\b/.test(text)) {
    if (byKey.has('titanZeroTheme')) return Object.freeze({ intent: 'settings.change', confident: true, needs_clarification: false, setting_key: 'titanZeroTheme', value: 'light', normalized_text: text, grants_authority: false });
  }
  if (text.includes('system theme') || /\btheme\b.*\bsystem\b/.test(text)) {
    if (byKey.has('titanZeroTheme')) return Object.freeze({ intent: 'settings.change', confident: true, needs_clarification: false, setting_key: 'titanZeroTheme', value: 'system', normalized_text: text, grants_authority: false });
  }

  const numericHits = registeredAliasMatches(text, NUMERIC_ALIASES, byKey);
  if (numericHits.length && /\b(set|change|make|limit|timeout|delay|max|maximum)\b/.test(text)) {
    const target = numericHits[0];
    if (numericHits.length > 1 && numericHits[1].longest === target.longest) {
      return Object.freeze({ intent: 'settings.change', confident: false, needs_clarification: true, setting_key: null, value: null, normalized_text: text, reason: 'multiple-settings-match', grants_authority: false });
    }
    const numeric = numericValueFor(text);
    return Object.freeze({
      intent: 'settings.change', confident: numeric.confident, needs_clarification: !numeric.confident,
      setting_key: target.key, value: numeric.confident ? numeric.value : null,
      normalized_text: text, reason: numeric.reason ?? null, grants_authority: false,
    });
  }

  const booleanHits = registeredAliasMatches(text, BOOLEAN_ALIASES, byKey);
  if (booleanHits.length) {
    const target = booleanHits[0];
    if (booleanHits.length > 1 && booleanHits[1].longest === target.longest) {
      return Object.freeze({ intent: 'settings.change', confident: false, needs_clarification: true, setting_key: null, value: null, normalized_text: text, reason: 'multiple-settings-match', grants_authority: false });
    }
    const bool = booleanValueFor(text, target.key);
    return Object.freeze({
      intent: 'settings.change', confident: bool.confident, needs_clarification: !bool.confident,
      setting_key: target.key, value: bool.confident ? bool.value : null,
      normalized_text: text, reason: bool.reason ?? null, grants_authority: false,
    });
  }

  return Object.freeze({
    intent: 'unknown', confident: false, needs_clarification: true,
    setting_key: null, value: null, normalized_text: text,
    reason: 'unsupported-or-ambiguous-settings-request', grants_authority: false,
  });
}
