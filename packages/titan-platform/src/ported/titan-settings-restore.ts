// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-settings-restore.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero Settings Restoration — rebrands the existing rich settings UI in place. */
(function bootstrapTitanSettingsRestore(globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope && globalScope.document) api.install(globalScope);
})(typeof window !== 'undefined' ? window : null, function createTitanSettingsRestore() {
  'use strict';

  const REWRITE_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt']);

  function rewriteVisibleText(value) {
    const source = String(value ?? '');
    if (!source) return source;
    if (source === 'Monica Options') return 'Titan Zero Settings';
    if (source === 'Options') return 'Settings';
    return source
      .replace(/\bMonica\b/g, 'Titan Zero')
      .replace(/\bOptions\b/g, 'Settings');
  }

  function shouldRewriteAttribute(name) {
    return REWRITE_ATTRS.has(String(name || '').toLowerCase());
  }

  function rewriteTextNode(node) {
    if (!node || node.nodeType !== 3) return false;
    const current = node.nodeValue;
    const next = rewriteVisibleText(current);
    if (next === current) return false;
    node.nodeValue = next;
    return true;
  }

  function rewriteElementAttributes(element) {
    if (!element?.getAttributeNames) return 0;
    let changed = 0;
    for (const name of element.getAttributeNames()) {
      if (!shouldRewriteAttribute(name)) continue;
      const current = element.getAttribute(name);
      const next = rewriteVisibleText(current);
      if (next !== current) {
        element.setAttribute(name, next);
        changed += 1;
      }
    }
    return changed;
  }

  function rewriteSubtree(root) {
    if (!root) return { text_nodes: 0, attributes: 0 };
    let textNodes = 0;
    let attributes = 0;
    if (root.nodeType === 3) {
      textNodes += rewriteTextNode(root) ? 1 : 0;
      return { text_nodes: textNodes, attributes };
    }
    if (root.nodeType === 1) attributes += rewriteElementAttributes(root);
    const walker = root.ownerDocument?.createTreeWalker?.(root, 0x5); // SHOW_ELEMENT | SHOW_TEXT
    if (!walker) return { text_nodes: textNodes, attributes };
    let node = walker.currentNode;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) textNodes += rewriteTextNode(node) ? 1 : 0;
      else if (node.nodeType === 1) attributes += rewriteElementAttributes(node);
    }
    return { text_nodes: textNodes, attributes };
  }

  function markAuthority(doc) {
    doc.documentElement?.setAttribute('data-titan-settings-authority', 'rich');
    doc.body?.setAttribute('data-titan-settings-authority', 'rich');
    const root = doc.getElementById('root');
    root?.setAttribute('data-titan-settings-root', 'true');
  }

  function install(win) {
    const doc = win.document;
    if (!doc) return null;
    doc.title = 'Titan Zero Settings';
    markAuthority(doc);
    rewriteSubtree(doc.body || doc.documentElement);

    const observer = typeof win.MutationObserver === 'function'
      ? new win.MutationObserver(records => {
          for (const record of records) {
            for (const node of record.addedNodes || []) rewriteSubtree(node);
          }
          markAuthority(doc);
        })
      : null;
    observer?.observe(doc.documentElement || doc, { childList: true, subtree: true });

    try {
      win.dispatchEvent(new win.CustomEvent('titan:settings-restored', {
        detail: { authority: 'rich', page: 'monicaOptions.html' }
      }));
    } catch (_) {}

    return { observer, rewriteSubtree: node => rewriteSubtree(node) };
  }

  return {
    rewriteVisibleText,
    shouldRewriteAttribute,
    rewriteSubtree,
    install
  };
});
