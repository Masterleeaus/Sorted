// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-theme.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero Theme Runtime v1 — one theme contract for Titan shell, Monica chat and Titan Work. */
(function bootstrapTitanTheme(globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope && globalScope.document) {
    globalScope.TitanTheme = api.install(globalScope);
  }
})(typeof window !== 'undefined' ? window : null, function createTitanThemeApi() {
  'use strict';

  const STORAGE_KEY = 'titanZeroTheme';
  const THEME_CONFIG_KEY = 'titanZeroThemeConfig';
  const LEGACY_RETRIEVER_THEME_KEY = 'theme';
  const THEME_MODES = Object.freeze(['system', 'light', 'dark']);
  const BRAND_TOKENS = Object.freeze({
    background: '#05070b',
    primary: '#2563eb',
    secondary: '#64748b',
    tertiary: '#ec4899'
  });
  const THEME_PRESETS = Object.freeze({
    titan: Object.freeze({ name: 'Titan', background: '#05070b', primary: '#2563eb', secondary: '#64748b', tertiary: '#ec4899' }),
    midnight: Object.freeze({ name: 'Midnight', background: '#020617', primary: '#0ea5e9', secondary: '#475569', tertiary: '#f472b6' }),
    cobalt: Object.freeze({ name: 'Cobalt', background: '#111827', primary: '#1d4ed8', secondary: '#6b7280', tertiary: '#db2777' }),
    graphite: Object.freeze({ name: 'Graphite', background: '#09090b', primary: '#3b82f6', secondary: '#71717a', tertiary: '#ec4899' })
  });

  const PALETTES = Object.freeze({
    light: Object.freeze({
      '--t0-primary': BRAND_TOKENS.primary,
      '--t0-secondary': BRAND_TOKENS.secondary,
      '--t0-tertiary': BRAND_TOKENS.tertiary,
      '--t0-bg': '#f8fafc',
      '--t0-panel': '#ffffff',
      '--t0-panel-2': '#f1f5f9',
      '--t0-elevated': '#e2e8f0',
      '--t0-line': '#cbd5e1',
      '--t0-line-strong': '#94a3b8',
      '--t0-text': '#0f172a',
      '--t0-muted': '#475569',
      '--t0-faint': '#64748b',
      '--t0-accent': '#2563eb',
      '--t0-accent-hover': '#1d4ed8',
      '--t0-accent-soft': 'rgba(37,99,235,.10)',
      '--t0-accent-contrast': '#ffffff',
      '--t0-soft': '#e2e8f0',
      '--t0-soft-hover': '#cbd5e1',
      '--t0-success': '#059669',
      '--t0-warning': '#b45309',
      '--t0-danger': '#dc2626',
      '--t0-info': '#2563eb',
      '--t0-shadow': '0 8px 24px rgba(15,23,42,.10)',
      '--t0-overlay': 'rgba(15,23,42,.42)',
      '--t0-pink': '#db2777'
    }),
    dark: Object.freeze({
      '--t0-primary': '#05070b',
      '--t0-secondary': '#3b82f6',
      '--t0-tertiary': '#94a3b8',
      '--t0-bg': '#05070b',
      '--t0-panel': '#0f172a',
      '--t0-panel-2': '#111827',
      '--t0-elevated': '#172033',
      '--t0-line': '#334155',
      '--t0-line-strong': '#475569',
      '--t0-text': '#f8fafc',
      '--t0-muted': '#94a3b8',
      '--t0-faint': '#64748b',
      '--t0-accent': '#3b82f6',
      '--t0-accent-hover': '#60a5fa',
      '--t0-accent-soft': 'rgba(59,130,246,.16)',
      '--t0-accent-contrast': '#ffffff',
      '--t0-soft': '#172033',
      '--t0-soft-hover': '#1e293b',
      '--t0-success': '#34d399',
      '--t0-warning': '#fbbf24',
      '--t0-danger': '#f87171',
      '--t0-info': '#60a5fa',
      '--t0-shadow': '0 10px 30px rgba(0,0,0,.36)',
      '--t0-overlay': 'rgba(0,0,0,.72)',
      '--t0-pink': '#ec4899'
    })
  });

  function normalizeMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    return THEME_MODES.includes(normalized) ? normalized : 'system';
  }

  function resolveTheme(mode, prefersDark) {
    const normalized = normalizeMode(mode);
    if (normalized === 'system') return prefersDark ? 'dark' : 'light';
    return normalized;
  }

  function nextMode(mode) {
    const normalized = normalizeMode(mode);
    const index = THEME_MODES.indexOf(normalized);
    return THEME_MODES[(index + 1) % THEME_MODES.length];
  }

  function legacyRetrieverModeToTitan(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'auto') return 'system';
    return normalizeMode(normalized);
  }

  function titanModeToLegacyRetriever(value) {
    const normalized = normalizeMode(value);
    return normalized === 'system' ? 'auto' : normalized;
  }

  function normalizeHex(value, fallback) {
    const raw = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
  }

  function normalizeBrand(input = BRAND_TOKENS) {
    return {
      background: normalizeHex(input?.background, BRAND_TOKENS.background),
      primary: normalizeHex(input?.primary, BRAND_TOKENS.primary),
      secondary: normalizeHex(input?.secondary, BRAND_TOKENS.secondary),
      tertiary: normalizeHex(input?.tertiary, BRAND_TOKENS.tertiary)
    };
  }

  function getThemeTokens(resolvedTheme, brand = BRAND_TOKENS) {
    const resolved = resolvedTheme === 'dark' ? 'dark' : 'light';
    const tokens = { ...PALETTES[resolved] };
    const normalized = normalizeBrand(brand);
    // Keep semantic colour names stable. In light mode, retain brand influence without turning the canvas dark.
    tokens['--t0-brand-background'] = normalized.background;
    tokens['--t0-bg'] = resolved === 'dark'
      ? normalized.background
      : `color-mix(in srgb, ${normalized.background} 8%, #ffffff)`;
    tokens['--t0-primary'] = normalized.primary;
    tokens['--t0-secondary'] = normalized.secondary;
    tokens['--t0-tertiary'] = normalized.tertiary;
    tokens['--t0-accent'] = normalized.primary;
    tokens['--t0-info'] = normalized.primary;
    tokens['--t0-muted'] = normalized.secondary;
    tokens['--t0-pink'] = normalized.tertiary;
    return tokens;
  }

  function install(win) {
    const doc = win.document;
    const media = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
    let mode = 'system';
    let resolved = resolveTheme(mode, !!media?.matches);
    let brand = normalizeBrand(BRAND_TOKENS);
    let preset = 'titan';
    let observer = null;

    const applyTokens = (targetDocument, nextResolved) => {
      if (!targetDocument?.documentElement) return;
      const html = targetDocument.documentElement;
      const body = targetDocument.body;
      html.dataset.titanTheme = nextResolved;
      html.classList.toggle('theme-dark', nextResolved === 'dark');
      html.classList.toggle('theme-light', nextResolved === 'light');
      html.style.colorScheme = nextResolved;
      if (body) {
        body.dataset.titanTheme = nextResolved;
        body.classList.toggle('theme-dark', nextResolved === 'dark');
        body.classList.toggle('theme-light', nextResolved === 'light');
      }
      for (const [key, value] of Object.entries(getThemeTokens(nextResolved, brand))) {
        html.style.setProperty(key, value);
      }
    };

    const applyMonicaTokens = targetDocument => {
      if (!targetDocument?.documentElement) return;
      const dark = resolved === 'dark';
      const values = getThemeTokens(resolved, brand);
      const monicaTokens = {
        '--theme-text-brand': values['--t0-accent'],
        '--theme-icon-brand': values['--t0-accent'],
        '--theme-btn-fill-primary': values['--t0-accent'],
        '--theme-btn-fill-primary-hover': values['--t0-accent-hover'],
        '--theme-btn-fill-primary-active': values['--t0-secondary'],
        '--theme-fill-tsp-brand-primary': values['--t0-accent'],
        '--theme-fill-tsp-brand-secondary': values['--t0-accent-soft'],
        '--theme-border-active': values['--t0-accent'],
        '--theme-text-link': values['--t0-accent'],
        '--theme-text-link-active': values['--t0-accent-hover']
      };
      targetDocument.querySelectorAll('[class*="_monica-theme-"]').forEach(node => {
        node.classList.toggle('_monica-dark', dark);
        Object.entries(monicaTokens).forEach(([key, value]) => node.style.setProperty(key, value));
      });
      const root = targetDocument.getElementById('root');
      if (root) root.dataset.titanTheme = resolved;
    };

    const applyMonicaTheme = () => applyMonicaTokens(doc);

    const applyFrameTheme = frame => {
      if (!frame) return;
      try {
        const frameDoc = frame.contentDocument;
        if (!frameDoc?.documentElement) return;
        applyTokens(frameDoc, resolved);
        applyMonicaTokens(frameDoc);
      } catch (error) {
        win.titanDiagWrite?.('warn', 'theme', 'Unable to apply Titan theme to embedded frame', { message: error?.message, frameId: frame.id });
      }
    };

    const getThemeFrames = () => Array.from(doc.querySelectorAll('iframe'));

    const applyWorkTheme = () => getThemeFrames().forEach(applyFrameTheme);

    const updateSelectorControls = () => {
      doc.querySelectorAll('[data-titan-theme-mode-choice]').forEach(control => {
        const choice = normalizeMode(control.dataset.titanThemeModeChoice);
        const active = mode === choice;
        control.classList.toggle('active', active);
        control.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      doc.querySelectorAll('[data-titan-theme-mode-status]').forEach(status => {
        status.textContent = mode === 'system' ? `System · ${resolved}` : `${mode[0].toUpperCase()}${mode.slice(1)}`;
      });
      doc.querySelectorAll('[data-titan-theme-preview-mode]').forEach(status => {
        status.textContent = mode === 'system' ? `System → ${resolved}` : `${mode[0].toUpperCase()}${mode.slice(1)}`;
      });
      doc.querySelectorAll('[data-titan-theme-preset]').forEach(control => {
        const key = String(control.dataset.titanThemePreset || '').toLowerCase();
        const active = preset === key;
        control.classList.toggle('active', active);
        control.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      const fields = {
        background: doc.querySelector('[data-titan-theme-background]'),
        primary: doc.querySelector('[data-titan-theme-primary]'),
        secondary: doc.querySelector('[data-titan-theme-secondary]'),
        tertiary: doc.querySelector('[data-titan-theme-tertiary]')
      };
      Object.entries(fields).forEach(([key, field]) => { if (field && field.value !== brand[key]) field.value = brand[key]; });
      doc.querySelectorAll('[data-titan-theme-preview]').forEach(preview => {
        preview.style.setProperty('--preview-background', brand.background);
        preview.style.setProperty('--preview-primary', brand.primary);
        preview.style.setProperty('--preview-secondary', brand.secondary);
        preview.style.setProperty('--preview-tertiary', brand.tertiary);
      });
    };

    const updateControls = () => {
      const labels = { system: 'System', light: 'Light', dark: 'Dark' };
      const icons = { system: '◐', light: '☀', dark: '☾' };
      doc.querySelectorAll('[data-titan-theme-control]').forEach(control => {
        control.dataset.themeMode = mode;
        control.dataset.themeResolved = resolved;
        control.setAttribute('aria-label', `Theme: ${labels[mode]}. Click to change theme.`);
        control.setAttribute('title', `Theme: ${labels[mode]} · currently ${resolved}`);
        const icon = control.querySelector('[data-theme-icon]');
        const label = control.querySelector('[data-theme-label]');
        if (icon) icon.textContent = icons[mode];
        if (label) label.textContent = labels[mode];
      });
      updateSelectorControls();
    };

    const emit = () => {
      try {
        win.dispatchEvent(new win.CustomEvent('titan:theme-changed', { detail: { mode, resolved, brand: { ...brand }, preset } }));
      } catch (_) {}
    };

    const apply = (requestedMode = mode) => {
      mode = normalizeMode(requestedMode);
      resolved = resolveTheme(mode, !!media?.matches);
      if (doc.documentElement) doc.documentElement.dataset.titanThemeMode = mode;
      if (doc.body) doc.body.dataset.titanThemeMode = mode;
      applyTokens(doc, resolved);
      applyMonicaTheme();
      applyWorkTheme();
      updateControls();
      emit();
      return { mode, resolved };
    };

    const removeLegacyRetrieverTheme = async () => {
      try {
        await win.chrome?.storage?.local?.remove?.(LEGACY_RETRIEVER_THEME_KEY);
      } catch (error) {
        win.titanDiagWrite?.('warn', 'theme', 'Legacy Retriever theme key could not be removed', { message: error?.message });
      }
    };

    const persistConfig = async () => {
      const config = { mode, brand: { ...brand }, preset };
      try {
        await win.chrome?.storage?.local?.set?.({
          [STORAGE_KEY]: mode,
          [THEME_CONFIG_KEY]: config
        });
      } catch (error) {
        win.titanDiagWrite?.('warn', 'theme', 'Theme preference could not be persisted', { message: error?.message });
      }
      return config;
    };

    const saveMode = async nextModeValue => {
      mode = normalizeMode(nextModeValue);
      apply(mode);
      await persistConfig();
      return { mode, resolved, brand: { ...brand }, preset };
    };

    const setBrand = async (nextBrand, nextPreset = 'custom') => {
      brand = normalizeBrand({ ...brand, ...(nextBrand || {}) });
      preset = nextPreset && THEME_PRESETS[nextPreset] ? nextPreset : 'custom';
      apply(mode);
      await persistConfig();
      return { mode, resolved, brand: { ...brand }, preset };
    };

    const applyPreset = key => {
      const normalizedKey = String(key || '').toLowerCase();
      const selected = THEME_PRESETS[normalizedKey];
      if (!selected) return Promise.resolve({ mode, resolved, brand: { ...brand }, preset });
      return setBrand(selected, normalizedKey);
    };

    const resetTheme = async () => {
      mode = 'system';
      brand = normalizeBrand(BRAND_TOKENS);
      preset = 'titan';
      apply(mode);
      await persistConfig();
      return { mode, resolved, brand: { ...brand }, preset };
    };

    const cycle = () => saveMode(nextMode(mode));

    const bindControls = () => {
      doc.querySelectorAll('[data-titan-theme-control]').forEach(control => {
        if (control.dataset.titanThemeBound === '1') return;
        control.dataset.titanThemeBound = '1';
        control.addEventListener('click', event => {
          event.preventDefault();
          cycle();
        });
      });
      doc.querySelectorAll('[data-titan-theme-mode-choice]').forEach(control => {
        if (control.dataset.titanThemeModeBound === '1') return;
        control.dataset.titanThemeModeBound = '1';
        control.addEventListener('click', event => {
          event.preventDefault();
          saveMode(control.dataset.titanThemeModeChoice);
        });
      });
      doc.querySelectorAll('[data-titan-theme-preset]').forEach(control => {
        if (control.dataset.titanThemePresetBound === '1') return;
        control.dataset.titanThemePresetBound = '1';
        control.addEventListener('click', event => { event.preventDefault(); applyPreset(control.dataset.titanThemePreset); });
      });
      ['background','primary','secondary','tertiary'].forEach(key => {
        const field = doc.querySelector(`[data-titan-theme-${key}]`);
        if (!field || field.dataset.titanThemeColorBound === '1') return;
        field.dataset.titanThemeColorBound = '1';
        field.addEventListener('input', () => setBrand({ [key]: field.value }, 'custom'));
        field.addEventListener('change', () => setBrand({ [key]: field.value }, 'custom'));
      });
      const reset = doc.querySelector('[data-titan-theme-reset]');
      if (reset && reset.dataset.titanThemeResetBound !== '1') {
        reset.dataset.titanThemeResetBound = '1';
        reset.addEventListener('click', event => { event.preventDefault(); resetTheme(); });
      }
      getThemeFrames().forEach(frame => {
        if (frame.dataset.titanThemeBound === '1') return;
        frame.dataset.titanThemeBound = '1';
        frame.addEventListener('load', () => applyFrameTheme(frame));
      });
      updateControls();
    };

    const startObserver = () => {
      if (observer || !doc.documentElement || typeof win.MutationObserver !== 'function') return;
      observer = new win.MutationObserver(records => {
        let needsMonica = false;
        let needsControls = false;
        records.forEach(record => {
          if (record.type === 'attributes' && record.attributeName === 'class') {
            const target = record.target;
            if (target?.matches?.('[class*="_monica-theme-"]')) needsMonica = true;
            return;
          }
          record.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (String(node.className || '').includes('_monica-theme-') || node.querySelector?.('[class*="_monica-theme-"]')) needsMonica = true;
            if (node.matches?.('[data-titan-theme-control],[data-titan-theme-mode-choice],[data-titan-theme-preset],[data-titan-theme-background],[data-titan-theme-primary],[data-titan-theme-secondary],[data-titan-theme-tertiary]') || node.querySelector?.('[data-titan-theme-control],[data-titan-theme-mode-choice],[data-titan-theme-preset],[data-titan-theme-background],[data-titan-theme-primary],[data-titan-theme-secondary],[data-titan-theme-tertiary]')) needsControls = true;
            if (node.matches?.('iframe')) {
              applyFrameTheme(node);
              if (node.dataset.titanThemeBound !== '1') {
                node.dataset.titanThemeBound = '1';
                node.addEventListener('load', () => applyFrameTheme(node));
              }
            }
            node.querySelectorAll?.('iframe').forEach(frame => {
              applyFrameTheme(frame);
              if (frame.dataset.titanThemeBound !== '1') {
                frame.dataset.titanThemeBound = '1';
                frame.addEventListener('load', () => applyFrameTheme(frame));
              }
            });
          });
        });
        if (needsMonica) applyMonicaTheme();
        if (needsControls) bindControls();
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    };

    const loadStoredMode = async () => {
      try {
        const stored = await win.chrome?.storage?.local?.get?.([STORAGE_KEY, THEME_CONFIG_KEY, LEGACY_RETRIEVER_THEME_KEY]);
        const config = stored?.[THEME_CONFIG_KEY];
        if (config && typeof config === 'object') {
          brand = normalizeBrand(config.brand);
          preset = config.preset && THEME_PRESETS[config.preset] ? config.preset : 'custom';
          apply(config.mode || stored?.[STORAGE_KEY] || 'system');
          if (stored?.[LEGACY_RETRIEVER_THEME_KEY] !== undefined) await removeLegacyRetrieverTheme();
        } else if (stored && stored[STORAGE_KEY]) {
          apply(stored[STORAGE_KEY]);
          await persistConfig();
          if (stored?.[LEGACY_RETRIEVER_THEME_KEY] !== undefined) await removeLegacyRetrieverTheme();
        } else if (stored && stored[LEGACY_RETRIEVER_THEME_KEY] !== undefined) {
          apply(legacyRetrieverModeToTitan(stored[LEGACY_RETRIEVER_THEME_KEY]));
          await persistConfig();
          await removeLegacyRetrieverTheme();
        } else {
          await persistConfig();
        }
      } catch (error) {
        win.titanDiagWrite?.('warn', 'theme', 'Theme preference could not be loaded', { message: error?.message });
      }
    };

    // Apply system theme immediately to avoid a white/dark flash, then hydrate stored preference.
    apply('system');
    bindControls();
    startObserver();
    loadStoredMode();

    if (media) {
      const onSystemChange = () => { if (mode === 'system') apply('system'); };
      if (typeof media.addEventListener === 'function') media.addEventListener('change', onSystemChange);
      else if (typeof media.addListener === 'function') media.addListener(onSystemChange);
    }

    try {
      win.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes?.[THEME_CONFIG_KEY]?.newValue) {
          const config = changes[THEME_CONFIG_KEY].newValue;
          brand = normalizeBrand(config.brand);
          preset = config.preset && THEME_PRESETS[config.preset] ? config.preset : 'custom';
          apply(config.mode || mode);
        } else if (changes?.[STORAGE_KEY]) {
          const normalized = normalizeMode(changes[STORAGE_KEY].newValue);
          apply(normalized);
          if (changes[STORAGE_KEY].newValue !== normalized) persistConfig();
        }
      });
    } catch (_) {}

    return Object.freeze({
      STORAGE_KEY,
      THEME_CONFIG_KEY,
      LEGACY_RETRIEVER_THEME_KEY,
      THEME_MODES,
      BRAND_TOKENS,
      THEME_PRESETS,
      normalizeMode,
      resolveTheme,
      nextMode,
      legacyRetrieverModeToTitan,
      titanModeToLegacyRetriever,
      getThemeTokens,
      getMode: () => mode,
      getResolvedTheme: () => resolved,
      getBrand: () => ({ ...brand }),
      getPreset: () => preset,
      applyTheme: apply,
      setMode: saveMode,
      setBrand,
      applyPreset,
      resetTheme,
      cycleTheme: cycle,
      applyToDocument: targetDocument => applyTokens(targetDocument, resolved),
      applyMonicaTheme,
      applyWorkTheme
    });
  }

  return Object.freeze({ STORAGE_KEY, THEME_CONFIG_KEY, LEGACY_RETRIEVER_THEME_KEY, THEME_MODES, BRAND_TOKENS, THEME_PRESETS, normalizeMode, normalizeBrand, resolveTheme, nextMode, legacyRetrieverModeToTitan, titanModeToLegacyRetriever, getThemeTokens, install });
});
