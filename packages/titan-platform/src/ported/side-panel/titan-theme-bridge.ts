// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): side-panel/titan-theme-bridge.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero Retriever theme bridge — keeps the retained Retriever UI on the canonical Titan theme contract. */
(() => {
  'use strict';

  const apply = (detail = {}) => {
    const resolved = detail.resolved || window.TitanTheme?.getResolvedTheme?.() || 'dark';
    const mode = detail.mode || window.TitanTheme?.getMode?.() || 'system';
    const root = document.documentElement;
    const body = document.body;
    const app = document.getElementById('app-container');
    [root, body, app].filter(Boolean).forEach((node) => {
      node.dataset.titanTheme = resolved;
      node.dataset.titanThemeMode = mode;
      node.classList.toggle('theme-light', resolved === 'light');
      node.classList.toggle('theme-dark', resolved === 'dark');
    });
  };

  window.addEventListener('titan:theme-changed', (event) => apply(event.detail));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
  else apply();
})();
