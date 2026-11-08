// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-rich-shell.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(() => {
  'use strict';

  const ROOT_ATTR = 'data-titan-rich-shell';
  const VERSION = 'ui-restore-pass3-workforce-production';
  const TEXT_RENAMES = new Map([
    ['Monica', 'Titan Zero'],
    ['Chat with Monica', 'Chat with Titan'],
    ['Monica Options', 'Titan Zero Settings'],
    ['Options', 'Settings'],
    ['Bots', 'Workforce Agents'],
    ['My Bots', 'My Workforce Agents'],
    ['Bot', 'Workforce Agent'],
  ]);

  const PHRASE_RENAMES = [
    [/\bMonica Options\b/g, 'Titan Zero Settings'],
    [/\bChat with Monica\b/g, 'Chat with Titan'],
    [/\bMy Bots\b/g, 'My Workforce Agents'],
  ];

  const UI_SELECTORS = [
    'header', 'nav', 'aside', '[role="navigation"]', '[role="tablist"]',
    'button', 'a', '[role="button"]', '[role="menuitem"]', '[role="tab"]',
    'h1', 'h2', 'h3', '[aria-label]', '[title]', '[data-testid]'
  ].join(',');

  function renameValue(value) {
    if (typeof value !== 'string' || !value) return value;
    const trimmed = value.trim();
    if (TEXT_RENAMES.has(trimmed)) {
      const replacement = TEXT_RENAMES.get(trimmed);
      return value.replace(trimmed, replacement);
    }
    let next = value;
    for (const [pattern, replacement] of PHRASE_RENAMES) next = next.replace(pattern, replacement);
    return next;
  }

  function patchElement(el) {
    if (!(el instanceof Element)) return;

    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const next = renameValue(value);
      if (next !== value) el.setAttribute(attr, next);
    }

    if (!el.matches(UI_SELECTORS)) return;
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const value = node.nodeValue || '';
      const next = renameValue(value);
      if (next !== value) node.nodeValue = next;
    }
  }

  function patchTree(root) {
    if (!root) return;
    if (root instanceof Element) patchElement(root);
    const scope = root.querySelectorAll ? root : document;
    for (const el of scope.querySelectorAll(UI_SELECTORS)) patchElement(el);
  }



  const WORKFORCE_TRIGGER_RE = /^(workforce agents?|my workforce agents?|bots?|my bots?)$/i;

  function isWorkforceTrigger(el) {
    if (!(el instanceof Element)) return false;
    const label = [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.textContent
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return WORKFORCE_TRIGGER_RE.test(label) || /\bworkforce agents?\b/i.test(label);
  }

  function workforceWorkspaceUrl() {
    const relative = 'sidePanel.html?view=workforce&fullscreen=1&embedded=1';
    try { return chrome?.runtime?.getURL ? chrome.runtime.getURL(relative) : relative; }
    catch (_) { return relative; }
  }

  function ensureWorkforceLauncher() {
    if (!document.body || document.getElementById('titan-rich-workforce-launcher')) return;
    const button = document.createElement('button');
    button.id = 'titan-rich-workforce-launcher';
    button.type = 'button';
    button.className = 'titan-rich-workforce-launcher';
    button.setAttribute('aria-label', 'Open Workforce Agents command centre');
    button.innerHTML = '<span aria-hidden="true">W</span><strong>Workforce</strong>';
    button.addEventListener('click', openWorkforceWorkspace);
    document.body.appendChild(button);
  }

  function ensureWorkforceWorkspace() {
    let dialog = document.getElementById('titan-rich-workforce-workspace');
    if (dialog) return dialog;
    dialog = document.createElement('section');
    dialog.id = 'titan-rich-workforce-workspace';
    dialog.className = 'titan-rich-workforce-workspace';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Titan Zero Workforce Agents command centre');
    dialog.hidden = true;
    dialog.innerHTML = `
      <header class="titan-rich-workforce-head">
        <div class="titan-rich-workforce-title">
          <span class="titan-rich-workforce-mark" aria-hidden="true">T0</span>
          <div><strong>Workforce Agents</strong><small>Human + Advanced Intelligence workforce · company scoped · governed controls</small></div>
        </div>
        <div class="titan-rich-workforce-head-actions">
          <span class="titan-rich-workforce-status"><i aria-hidden="true"></i>Live workspace</span>
          <button type="button" data-titan-workforce-popout>Open full page</button>
          <button type="button" data-titan-workforce-close aria-label="Close Workforce Agents">×</button>
        </div>
      </header>
      <div class="titan-rich-workforce-safety-strip" role="note">
        <span>Authority stays with Titan Zero policy + Laravel</span>
        <span>Schedules do not auto-execute</span>
        <span>Budgets do not grant spend authority</span>
        <span>Critical safety/environment risks can block work</span>
      </div>
      <iframe title="Titan Zero Workforce Agents" data-titan-workforce-frame></iframe>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-titan-workforce-close]')?.addEventListener('click', closeWorkforceWorkspace);
    dialog.querySelector('[data-titan-workforce-popout]')?.addEventListener('click', () => {
      const url = workforceWorkspaceUrl();
      if (chrome?.tabs?.create) chrome.tabs.create({ url }); else window.open(url, '_blank', 'noopener');
    });
    return dialog;
  }

  function openWorkforceWorkspace(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const url = workforceWorkspaceUrl();
    if (document.body?.classList.contains('titan-monica-popup-page') && chrome?.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }
    const dialog = ensureWorkforceWorkspace();
    const frame = dialog.querySelector('[data-titan-workforce-frame]');
    if (frame && !frame.getAttribute('src')) frame.setAttribute('src', url);
    dialog.hidden = false;
    dialog.classList.add('open');
    document.documentElement.classList.add('titan-workforce-workspace-open');
    dialog.querySelector('[data-titan-workforce-close]')?.focus();
  }

  function closeWorkforceWorkspace() {
    const dialog = document.getElementById('titan-rich-workforce-workspace');
    if (!dialog) return;
    dialog.classList.remove('open');
    dialog.hidden = true;
    document.documentElement.classList.remove('titan-workforce-workspace-open');
    document.getElementById('titan-rich-workforce-launcher')?.focus();
  }

  function bindWorkforceTriggers(root = document) {
    const nodes = root.querySelectorAll ? root.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="tab"]') : [];
    for (const el of nodes) {
      if (!isWorkforceTrigger(el) || el.dataset.titanWorkforceBound === '1') continue;
      el.dataset.titanWorkforceBound = '1';
      el.addEventListener('click', openWorkforceWorkspace, true);
    }
  }

  function applyDocumentIdentity() {
    document.documentElement.setAttribute(ROOT_ATTR, VERSION);
    document.documentElement.setAttribute('data-titan-product', 'titan-zero');
    document.documentElement.setAttribute('data-titan-edition', 'cleaning');
    if (/monica/i.test(document.title) || /options/i.test(document.title)) {
      document.title = document.body?.classList.contains('titan-monica-options-page')
        ? 'Titan Zero Settings'
        : 'Titan Zero';
    }
  }

  function start() {
    applyDocumentIdentity();
    patchTree(document);
    ensureWorkforceLauncher();
    bindWorkforceTriggers(document);

    let queued = false;
    const observer = new MutationObserver((records) => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        for (const record of records) {
          if (record.type === 'characterData') {
            const parent = record.target.parentElement;
            if (parent) patchElement(parent);
            continue;
          }
          for (const node of record.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) { patchTree(node); bindWorkforceTriggers(node); }
          }
        }
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeWorkforceWorkspace(); });

    window.addEventListener('pageshow', () => {
      applyDocumentIdentity();
      patchTree(document);
      ensureWorkforceLauncher();
      bindWorkforceTriggers(document);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
