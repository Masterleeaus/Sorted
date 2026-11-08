// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-workforce-agents-migration.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(() => {
  'use strict';

  const EXACT_TEXT = new Map([
    ['Bots', 'Workforce Agents'],
    ['Bot', 'Workforce Agent'],
    ['My Bots', 'My Workforce Agents'],
    ['Create Bot', 'Create Workforce Agent'],
    ['New Bot', 'New Workforce Agent'],
    ['Edit Bot', 'Edit Workforce Agent'],
    ['Bot Info', 'Workforce Agent Info'],
    ['Bot Profile', 'Workforce Agent Profile'],
    ['Bot Library', 'Workforce Agent Library'],
    ['Hot Bots', 'Hot Workforce Agents'],
    ['More Bots', 'More Workforce Agents'],
    ['Recent bots', 'Recent Workforce Agents'],
    ['Search bots or chats', 'Search Workforce Agents or chats'],
    ['No bot found', 'No Workforce Agent found']
  ]);

  const ATTRIBUTE_NAMES = ['aria-label', 'title', 'placeholder'];

  function canonicalize(value) {
    const text = String(value || '').trim();
    if (!text) return value;
    if (EXACT_TEXT.has(text)) return EXACT_TEXT.get(text);
    return value;
  }

  function migrateElement(element) {
    if (!(element instanceof Element)) return;

    for (const attr of ATTRIBUTE_NAMES) {
      if (!element.hasAttribute(attr)) continue;
      const before = element.getAttribute(attr);
      const after = canonicalize(before);
      if (after !== before) element.setAttribute(attr, after);
    }

    if (element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE) {
      const before = element.textContent;
      const after = canonicalize(before);
      if (after !== before) element.textContent = after;
    }
  }

  function migrateTree(root = document) {
    if (root instanceof Element) migrateElement(root);
    root.querySelectorAll?.('button,a,[role="button"],[role="tab"],[aria-label],[title],input[placeholder],textarea[placeholder],h1,h2,h3,h4,span,label,p').forEach(migrateElement);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const parent = record.target.parentElement;
        if (parent) migrateElement(parent);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) migrateTree(node);
      }
    }
  });

  const start = () => {
    migrateTree(document);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTE_NAMES });
    document.documentElement.dataset.titanWorkforceAgentsMigration = 'canonical';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
