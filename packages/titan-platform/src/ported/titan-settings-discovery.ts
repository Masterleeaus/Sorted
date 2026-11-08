// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-settings-discovery.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero Settings Discovery — additive search/navigation over the retained rich Settings UI. */
(function bootstrapTitanSettingsDiscovery(globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope && globalScope.document) api.install(globalScope);
})(typeof window !== 'undefined' ? window : null, function createTitanSettingsDiscovery() {
  'use strict';

  const CATEGORIES = [
    ['appearance', 'Appearance', 'theme colours appearance light dark'],
    ['models', 'Models & Providers', 'model provider api gemini openai claude deepseek ollama'],
    ['writing', 'Writing', 'writing grammar rewrite compose'],
    ['search', 'Search & Research', 'search research webpage assistant web'],
    ['translation', 'Translation', 'translation language glossary bilingual'],
    ['sidebar', 'Sidebar & Selection', 'sidebar floating avatar text selection toolbar'],
    ['shortcuts', 'Shortcuts', 'keyboard shortcut hotkey'],
    ['privacy', 'Privacy & Data', 'privacy data history storage private']
  ];

  const SELECTOR = [
    'h1','h2','h3','h4','h5','h6','label','button','a',
    '[role="tab"]','[role="menuitem"]','[role="option"]','[aria-label]'
  ].join(',');

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function displayText(el) {
    if (!el) return '';
    return String(el.getAttribute?.('aria-label') || el.textContent || el.getAttribute?.('title') || '')
      .replace(/\s+/g, ' ').trim();
  }

  function collectCandidates(doc) {
    const seen = new Set();
    const rows = [];
    for (const el of doc.querySelectorAll(SELECTOR)) {
      if (el.closest?.('[data-titan-settings-discovery]')) continue;
      const text = displayText(el);
      const key = normalize(text);
      if (!key || key.length < 2 || key.length > 180 || seen.has(key)) continue;
      seen.add(key);
      rows.push({ el, text, key });
    }
    return rows;
  }

  function searchCandidates(candidates, query, limit) {
    const words = normalize(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    for (const row of candidates) {
      if (!words.every(word => row.key.includes(word))) continue;
      let score = words.reduce((n, word) => n + (row.key.startsWith(word) ? 4 : 1), 0);
      if (row.key === normalize(query)) score += 8;
      scored.push({ ...row, score });
    }
    return scored.sort((a,b) => b.score - a.score || a.text.length - b.text.length).slice(0, limit || 12);
  }


  function searchCategory(candidates, categoryId, limit) {
    const category = CATEGORIES.find(([id]) => id === categoryId);
    if (!category) return [];
    const words = normalize(category[2]).split(' ').filter(Boolean);
    const scored = [];
    for (const row of candidates) {
      const matches = words.filter(word => row.key.includes(word));
      if (!matches.length) continue;
      const score = matches.reduce((n, word) => n + (row.key.startsWith(word) ? 4 : 1), 0) + matches.length;
      scored.push({ ...row, score });
    }
    return scored.sort((a,b) => b.score - a.score || a.text.length - b.text.length).slice(0, limit || 12);
  }

  function buildUi(doc) {
    const host = doc.createElement('section');
    host.className = 'titan-settings-discovery';
    host.setAttribute('data-titan-settings-discovery', 'true');
    host.setAttribute('aria-labelledby', 'titan-settings-discovery-title');
    host.innerHTML = `
      <div class="titan-settings-discovery-head">
        <div><strong id="titan-settings-discovery-title">Find settings</strong><span>Search the full Titan Settings centre without leaving this page.</span></div>
        <label class="titan-settings-search"><span class="sr-only">Search settings</span><input type="search" data-titan-settings-search placeholder="Search settings, tools, models, shortcuts…" autocomplete="off"></label>
      </div>
      <div class="titan-settings-categories" data-titan-settings-categories aria-label="Settings categories"></div>
      <div class="titan-settings-search-status" data-titan-settings-search-status aria-live="polite">Type to search the rich Settings centre.</div>
      <div class="titan-settings-search-results" data-titan-settings-search-results></div>`;
    const chipHost = host.querySelector('[data-titan-settings-categories]');
    for (const [id, label, query] of CATEGORIES) {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.dataset.titanSettingsCategory = id; b.dataset.titanSettingsQuery = query;
      chipHost.appendChild(b);
    }
    return host;
  }

  function install(win) {
    const doc = win.document;
    if (!doc || doc.querySelector('[data-titan-settings-discovery]')) return null;
    const native = doc.querySelector('[data-titan-settings-native]');
    const root = doc.getElementById('root');
    const anchor = native || root || doc.body.firstChild;
    const host = buildUi(doc);
    anchor?.parentNode?.insertBefore(host, anchor);

    const input = host.querySelector('[data-titan-settings-search]');
    const status = host.querySelector('[data-titan-settings-search-status]');
    const results = host.querySelector('[data-titan-settings-search-results]');
    let candidates = collectCandidates(doc);

    function render(query) {
      const matches = searchCandidates(candidates, query, 12);
      results.replaceChildren();
      if (!normalize(query)) { status.textContent = 'Type to search the rich Settings centre.'; return; }
      status.textContent = matches.length ? `${matches.length} matching settings shown.` : 'No matching settings found.';
      for (const match of matches) {
        const button = doc.createElement('button');
        button.type = 'button'; button.className = 'titan-settings-search-result'; button.textContent = match.text;
        button.addEventListener('click', () => {
          match.el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          match.el.classList?.add('titan-settings-search-hit');
          if (typeof match.el.focus === 'function') { try { match.el.focus({ preventScroll: true }); } catch (_) { match.el.focus(); } }
          win.setTimeout?.(() => match.el.classList?.remove('titan-settings-search-hit'), 1800);
        });
        results.appendChild(button);
      }
    }

    input.addEventListener('input', () => render(input.value));
    host.addEventListener('click', event => {
      const chip = event.target.closest?.('[data-titan-settings-query]');
      if (!chip) return;
      const categoryId = chip.dataset.titanSettingsCategory || '';
      const label = chip.textContent || 'category';
      const matches = searchCategory(candidates, categoryId, 12);
      input.value = '';
      results.replaceChildren();
      status.textContent = matches.length ? `${matches.length} ${label} settings shown.` : `No ${label} settings found.`;
      for (const match of matches) {
        const button = doc.createElement('button');
        button.type = 'button'; button.className = 'titan-settings-search-result'; button.textContent = match.text;
        button.addEventListener('click', () => {
          match.el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          match.el.classList?.add('titan-settings-search-hit');
          if (typeof match.el.focus === 'function') { try { match.el.focus({ preventScroll: true }); } catch (_) { match.el.focus(); } }
          win.setTimeout?.(() => match.el.classList?.remove('titan-settings-search-hit'), 1800);
        });
        results.appendChild(button);
      }
      input.focus();
    });

    const observer = typeof win.MutationObserver === 'function' ? new win.MutationObserver(records => {
      if (records.some(r => [...(r.addedNodes || [])].some(n => n.nodeType === 1 && !n.closest?.('[data-titan-settings-discovery]')))) {
        candidates = collectCandidates(doc);
        if (normalize(input.value)) render(input.value);
      }
    }) : null;
    observer?.observe(root || doc.body, { childList: true, subtree: true });

    return { host, observer, collect: () => collectCandidates(doc), search: q => searchCandidates(candidates, q, 12) };
  }

  return { CATEGORIES, normalize, collectCandidates, searchCandidates, searchCategory, install };
});
