// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-workforce-agents-catalogue.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(() => {
  'use strict';

  // Titan Zero adapts the retained rich catalogue in place. This bridge does not
  // replace React-owned cards, filters, category controls, search, or profiles.
  const NORMALIZE = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const WORKFORCE_LABELS = new Set([
    'workforce agents',
    'my workforce agents',
    'workforce agent library'
  ]);
  const CATEGORY_LABELS = new Set([
    'agents', 'ai models', 'social platforms', 'emotions', 'work scenarios',
    'hot workforce agents', 'more workforce agents', 'artist', 'other'
  ]);
  const PROFILE_LABELS = new Set([
    'workforce agent info', 'workforce agent profile', 'edit workforce agent',
    'create workforce agent', 'customize skills and knowledge'
  ]);

  function textValues(node) {
    if (!(node instanceof Element)) return [];
    return [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('placeholder')]
      .map(NORMALIZE).filter(Boolean);
  }

  function hasAny(node, labels) {
    return textValues(node).some(value => labels.has(value));
  }

  function catalogueIsVisible() {
    const candidates = document.querySelectorAll('button,a,[role="button"],[role="tab"],h1,h2,h3,[aria-label],[title]');
    return [...candidates].some(node => hasAny(node, WORKFORCE_LABELS));
  }

  function annotateSearch() {
    const inputs = [...document.querySelectorAll('input[type="search"],input[placeholder],textarea[placeholder]')];
    for (const input of inputs) {
      const placeholder = NORMALIZE(input.getAttribute('placeholder'));
      if (!placeholder.includes('search')) continue;
      if (!catalogueIsVisible() && !placeholder.includes('workforce agent')) continue;
      input.dataset.titanWorkforceAgentSearch = 'true';
      if (placeholder.includes('bot')) input.setAttribute('placeholder', 'Search Workforce Agents');
      if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', 'Search Workforce Agents');
    }
  }

  function annotateCategories() {
    const controls = document.querySelectorAll('button,a,[role="button"],[role="tab"]');
    for (const control of controls) {
      const values = textValues(control);
      const match = values.find(value => CATEGORY_LABELS.has(value));
      if (!match) continue;
      control.dataset.titanWorkforceAgentCategory = match.replace(/\s+/g, '-');
    }
  }

  function annotateProfiles() {
    const nodes = document.querySelectorAll('h1,h2,h3,h4,button,[role="dialog"],[aria-label],[title]');
    let profileVisible = false;
    for (const node of nodes) {
      if (!hasAny(node, PROFILE_LABELS)) continue;
      node.dataset.titanWorkforceAgentProfile = 'true';
      profileVisible = true;
    }
    document.documentElement.dataset.titanWorkforceAgentProfileState = profileVisible ? 'visible' : 'catalogue';
  }

  function annotateCards() {
    if (!catalogueIsVisible()) return;
    const candidates = document.querySelectorAll('a,button,[role="button"]');
    for (const node of candidates) {
      if (node.dataset.titanWorkforceAgentCategory || node.dataset.titanWorkforceAgentSearch) continue;
      const hasVisual = !!node.querySelector('img,svg');
      const label = NORMALIZE(node.textContent);
      if (!hasVisual || label.length < 2 || label.length > 180) continue;
      if (/^(workforce agents|my workforce agents|create workforce agent|search|agents|ai models)$/.test(label)) continue;
      node.dataset.titanWorkforceAgentCard = 'retained-rich-ui';
      node.dataset.titanWorkforceAgentLabel = String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    }
  }

  function annotateCatalogue() {
    const visible = catalogueIsVisible();
    document.documentElement.dataset.titanWorkforceAgentsCatalogue = visible ? 'retained-rich-ui' : 'inactive';
    if (!visible) return;
    annotateSearch();
    annotateCategories();
    annotateProfiles();
    annotateCards();
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      annotateCatalogue();
    });
  };

  const observer = new MutationObserver(schedule);
  const start = () => {
    annotateCatalogue();
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener('click', event => {
      const card = event.target instanceof Element ? event.target.closest('[data-titan-workforce-agent-card]') : null;
      if (card) {
        const label = String(card.textContent || '').replace(/\s+/g, ' ').trim();
        if (label) document.documentElement.dataset.titanWorkforceAgentSelectedLabel = label.slice(0, 180);
        document.documentElement.dataset.titanWorkforceAgentProfileState = 'opening';
      }
    }, true);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
