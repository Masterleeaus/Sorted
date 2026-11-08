// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-workforce-surface-split.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(() => {
  'use strict';

  // Workforce Agents is the rich catalogue/profile surface. Workforce remains
  // the separate operational management/control centre in the Titan shell.
  const MARKER_ATTR = 'data-titan-workforce-surface-split';

  function ensureProfileAction() {
    const profile = document.querySelector('[data-titan-workforce-agent-runtime-profile="true"]');
    if (!profile || profile.querySelector('[data-titan-open-workforce-management]')) return;
    const action = document.createElement('button');
    action.type = 'button';
    action.dataset.titanOpenWorkforceManagement = 'true';
    action.textContent = 'Open Workforce management';
    action.setAttribute('aria-label', 'Open Workforce management centre');
    action.style.cssText = 'margin-top:10px;padding:8px 11px;border-radius:10px;border:1px solid rgba(148,163,184,.35);background:rgba(148,163,184,.08);color:inherit;cursor:pointer;font:inherit';
    action.addEventListener('click', () => {
      if (window.parent === window) {
        window.dispatchEvent(new CustomEvent('titan:workforce-management-requested', {detail:{source:'workforce-agents-profile'}}));
        return;
      }
      window.parent.postMessage({type:'TITAN_OPEN_WORKFORCE_MANAGEMENT', source:'workforce-agents-profile'}, '*');
    });
    profile.appendChild(action);
  }

  function markSurface() {
    document.documentElement.dataset.titanWorkforceAgentsSurface = 'catalogue-profile';
    document.documentElement.dataset.titanWorkforceManagementSurface = 'separate-shell-view';
    ensureProfileAction();
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; markSurface(); });
  };

  const start = () => {
    if (document.documentElement.getAttribute(MARKER_ATTR) === 'active') return;
    document.documentElement.setAttribute(MARKER_ATTR, 'active');
    markSurface();
    new MutationObserver(schedule).observe(document.documentElement, {subtree:true, childList:true});
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
