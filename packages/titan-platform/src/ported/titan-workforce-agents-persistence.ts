// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-workforce-agents-persistence.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(() => {
  'use strict';

  // Presentation-only persistence for the retained rich Workforce Agents UI.
  // This state never grants authority and is isolated by canonical company_id.
  const STORE_KEY = 'titanWorkforceAgentsUiState';
  const PROFILE_STATE_ATTR = 'data-titan-workforce-agent-profile-state';
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const validCompany = value => /^[A-Za-z0-9._:-]{2,128}$/.test(clean(value)) && clean(value) !== 'default';
  const normalize = value => clean(value).toLowerCase();
  const stateDefaults = () => ({ search: '', category: '', favourites: [], selected_label: '', profile_open: false, updated_at: '' });
  let company_id = '';
  let state = stateDefaults();
  let ready = false;
  let saving = false;
  let saveQueued = false;
  let restoreTimer = 0;
  let profileRestored = false;
  const reconciledFavouriteLabels = new Set();

  async function loadCompanyId() {
    try {
      const raw = await chrome.storage.local.get(['titanBusinessProfile']);
      const id = clean(raw?.titanBusinessProfile?.company_id);
      return validCompany(id) ? id : '';
    } catch (_) { return ''; }
  }

  async function loadState() {
    company_id = await loadCompanyId();
    if (!company_id) return false;
    try {
      const raw = await chrome.storage.local.get([STORE_KEY]);
      const stored = raw?.[STORE_KEY];
      const scoped = stored?.companies?.[company_id];
      state = { ...stateDefaults(), ...(scoped && typeof scoped === 'object' ? scoped : {}) };
      state.favourites = Array.isArray(state.favourites) ? [...new Set(state.favourites.map(clean).filter(Boolean))] : [];
      return true;
    } catch (_) { return false; }
  }

  async function saveState(patch = {}) {
    if (!company_id) return;
    state = { ...state, ...patch, updated_at: new Date().toISOString() };
    state.favourites = [...new Set((state.favourites || []).map(clean).filter(Boolean))];
    if (saving) {
      saveQueued = true;
      return;
    }
    do {
      saveQueued = false;
      saving = true;
      try {
        const raw = await chrome.storage.local.get([STORE_KEY]);
        const store = raw?.[STORE_KEY] && typeof raw[STORE_KEY] === 'object' ? raw[STORE_KEY] : {};
        const companies = store.companies && typeof store.companies === 'object' ? store.companies : {};
        const snapshot = { ...state, favourites: [...state.favourites], company_id };
        await chrome.storage.local.set({
          [STORE_KEY]: {
            schema: 'titan-workforce-agents-ui-state/v1',
            companies: { ...companies, [company_id]: snapshot }
          }
        });
      } catch (_) {
        // UI persistence is best-effort and must never block the catalogue.
      } finally {
        saving = false;
      }
    } while (saveQueued && company_id);
  }

  function cardLabel(node) {
    if (!(node instanceof Element)) return '';
    const card = node.closest('[data-titan-workforce-agent-card]');
    if (!card) return '';
    const explicit = clean(card.dataset.titanWorkforceAgentLabel);
    if (explicit) return explicit;
    const cleaningName = clean(card.querySelector?.('.name')?.textContent).replace(/^🧹\s*/, '');
    if (cleaningName) return cleaningName;
    return clean(card.textContent).slice(0, 180);
  }

  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
  }

  function searchControls() {
    return [...document.querySelectorAll('[data-titan-workforce-agent-search="true"]')];
  }

  function categoryControls() {
    return [...document.querySelectorAll('[data-titan-workforce-agent-category]')];
  }

  function isActive(control) {
    if (!(control instanceof Element)) return false;
    if (control.getAttribute('aria-selected') === 'true' || control.getAttribute('aria-pressed') === 'true') return true;
    if (normalize(control.getAttribute('data-state')) === 'active') return true;
    const cls = normalize(control.className);
    return /(^|\s)(active|selected|current)(\s|$)/.test(cls);
  }

  function restoreSearch() {
    if (!state.search) return;
    for (const input of searchControls()) {
      if (clean(input.value) === state.search) continue;
      setNativeValue(input, state.search);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dataset.titanWorkforceAgentSearchRestored = 'true';
    }
  }

  function restoreCategory() {
    if (!state.category) return;
    const control = categoryControls().find(item => clean(item.dataset.titanWorkforceAgentCategory) === state.category);
    if (!control || isActive(control) || control.dataset.titanWorkforceAgentCategoryRestored === 'true') return;
    control.dataset.titanWorkforceAgentCategoryRestored = 'true';
    control.click();
  }

  function favouriteAction(control) {
    const text = normalize([control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent].filter(Boolean).join(' '));
    if (/\b(unpin|unfavorite|unfavourite|remove from favorites|remove from favourites)\b/.test(text)) return 'remove';
    if (/\b(pin|favorite|favourite|add to favorites|add to favourites)\b/.test(text)) return 'add';
    return '';
  }

  function favouriteControls() {
    const controls = [...document.querySelectorAll('button,[role="button"],a')];
    return controls.filter(control => favouriteAction(control));
  }

  function updateFavouriteMarker(card, label) {
    if (!card || !label) return;
    card.dataset.titanWorkforceAgentFavourite = state.favourites.includes(label) ? 'true' : 'false';
  }

  function restoreFavourites() {
    for (const control of favouriteControls()) {
      const label = cardLabel(control);
      if (!label || reconciledFavouriteLabels.has(label)) continue;
      const desired = state.favourites.includes(label);
      const action = favouriteAction(control);
      const card = control.closest('[data-titan-workforce-agent-card]');
      updateFavouriteMarker(card, label);
      if ((desired && action === 'add') || (!desired && action === 'remove')) {
        reconciledFavouriteLabels.add(label);
        control.click();
      } else if ((desired && action === 'remove') || (!desired && action === 'add')) {
        reconciledFavouriteLabels.add(label);
      }
    }
    document.querySelectorAll('[data-titan-workforce-agent-card]').forEach(card => updateFavouriteMarker(card, cardLabel(card)));
  }

  function restoreProfile() {
    if (profileRestored || !state.profile_open || !state.selected_label) return;
    const wanted = normalize(state.selected_label);
    const card = [...document.querySelectorAll('[data-titan-workforce-agent-card]')].find(item => normalize(cardLabel(item)) === wanted);
    if (!card) return;
    profileRestored = true;
    document.documentElement.dataset.titanWorkforceAgentSelectedLabel = state.selected_label;
    card.click();
  }

  function scheduleRestore() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (!ready) return;
      restoreSearch();
      restoreCategory();
      restoreFavourites();
      restoreProfile();
      document.documentElement.dataset.titanWorkforceAgentsPersistence = company_id ? 'company-scoped' : 'inactive';
    }, 80);
  }

  function bindEvents() {
    document.addEventListener('input', event => {
      const input = event.target instanceof Element ? event.target.closest('[data-titan-workforce-agent-search="true"]') : null;
      if (!input || !ready) return;
      saveState({ search: clean(input.value) });
    }, true);

    document.addEventListener('click', event => {
      if (!ready || !(event.target instanceof Element)) return;
      const category = event.target.closest('[data-titan-workforce-agent-category]');
      if (category) saveState({ category: clean(category.dataset.titanWorkforceAgentCategory) });

      const favourite = event.target.closest('button,[role="button"],a');
      const action = favourite ? favouriteAction(favourite) : '';
      const favouriteLabel = action ? cardLabel(favourite) : '';
      if (action && favouriteLabel) {
        const next = new Set(state.favourites || []);
        if (action === 'add') next.add(favouriteLabel); else next.delete(favouriteLabel);
        saveState({ favourites: [...next] });
      }

      const card = event.target.closest('[data-titan-workforce-agent-card]');
      if (card && !action) {
        const selected = cardLabel(card);
        if (selected) saveState({ selected_label: selected, profile_open: true });
      }
    }, true);
  }

  function observeProfileState() {
    const observer = new MutationObserver(records => {
      scheduleRestore();
      if (!ready) return;
      if (!records.some(record => record.type === 'attributes' && record.attributeName === PROFILE_STATE_ATTR)) return;
      const value = clean(document.documentElement.dataset.titanWorkforceAgentProfileState).toLowerCase();
      if (value === 'catalogue') saveState({ profile_open: false });
      else if (value === 'visible' || value === 'opening') {
        const selected = clean(document.documentElement.dataset.titanWorkforceAgentSelectedLabel || state.selected_label);
        saveState({ profile_open: true, selected_label: selected });
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [PROFILE_STATE_ATTR, 'data-titan-workforce-agent-card', 'data-titan-workforce-agent-search', 'data-titan-workforce-agent-category'] });
  }

  async function start() {
    bindEvents();
    observeProfileState();
    ready = await loadState();
    if (!ready) {
      document.documentElement.dataset.titanWorkforceAgentsPersistence = 'inactive';
      return;
    }
    if (state.selected_label) document.documentElement.dataset.titanWorkforceAgentSelectedLabel = state.selected_label;
    scheduleRestore();
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'local') return;
      if ('titanBusinessProfile' in changes) {
        ready = false;
        profileRestored = false;
        reconciledFavouriteLabels.clear();
        loadState().then(ok => { ready = ok; scheduleRestore(); });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
