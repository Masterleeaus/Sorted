// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-permission-consent-hooks.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero permission consent hooks — additive Settings/side-panel integration. */
(() => {
  'use strict';

  const CAPABILITIES = [
    ['cookies', 'Cookie access'],
    ['webNavigation', 'Navigation observation'],
    ['webRequest', 'Request observation']
  ];

  async function companyId() {
    const fromDom = String(document.documentElement.dataset.companyId || document.body?.dataset.companyId || '').trim();
    if (fromDom) return fromDom;
    try {
      const data = await chrome.storage.local.get(['titanBusinessProfile']);
      return String(data?.titanBusinessProfile?.company_id || '').trim();
    } catch (_) {
      return '';
    }
  }
  let controllerPromise;
  const getController = () => controllerPromise ||= import('./titan-runtime/permissions/permission-consent-controller.js')
    .then(mod => mod.createPermissionConsentController());

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  function styleOnce() {
    if (document.getElementById('titan-permission-consent-style')) return;
    const style = document.createElement('style');
    style.id = 'titan-permission-consent-style';
    style.textContent = '.titan-permission-consent{margin:12px 0;padding:12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px}.titan-permission-consent summary{cursor:pointer;font-weight:700}.titan-permission-consent-list{display:grid;gap:8px;margin-top:10px}.titan-permission-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}.titan-permission-row small{display:block;opacity:.72}.titan-permission-row button{min-width:84px}.titan-permission-note{font-size:12px;opacity:.72;margin-top:8px}';
    document.head.append(style);
  }

  async function renderRow(row, capability) {
    const status = row.querySelector('[data-permission-state]');
    const button = row.querySelector('button');
    try {
      const canonicalCompanyId = await companyId();
      if (!canonicalCompanyId) {
        status.textContent = 'Canonical company context is unavailable. No permission can be requested.';
        button.disabled = true;
        button.hidden = false;
        button.textContent = 'Unavailable';
        return;
      }
      const controller = await getController();
      const model = await controller.status({ company_id: canonicalCompanyId, capability, actor_ref: 'permission-consent-ui' });
      status.textContent = model.message;
      button.hidden = model.pending_manager === true;
      button.disabled = model.pending_manager === true;
      if (!model.pending_manager) {
        button.textContent = model.granted ? 'Revoke' : 'Grant';
        button.dataset.action = model.granted ? 'revoke' : 'request';
      }
    } catch (error) {
      status.textContent = 'Permission status is unavailable. No permission was requested.';
      button.disabled = true;
      emit('titan:permission-consent-error', { capability, message: String(error?.message || error) });
    }
  }

  function buildPanel() {
    const details = document.createElement('details');
    details.className = 'titan-permission-consent';
    details.dataset.titanPermissionConsent = '1';
    details.innerHTML = '<summary>Browser permissions</summary><div class="titan-permission-consent-list"></div><div class="titan-permission-note">Permission grants never provide business, approval, company or execution authority.</div>';
    const list = details.querySelector('.titan-permission-consent-list');

    for (const [capability, label] of CAPABILITIES) {
      const row = document.createElement('div');
      row.className = 'titan-permission-row';
      row.dataset.capability = capability;
      row.innerHTML = `<div><strong>${label}</strong><small data-permission-state>Checking…</small></div><button type="button" disabled>Checking</button>`;
      const button = row.querySelector('button');
      button.addEventListener('click', async event => {
        event.preventDefault();
        button.disabled = true;
        try {
          const canonicalCompanyId = await companyId();
          if (!canonicalCompanyId) throw new Error('permission-consent-company_id-unavailable');
          const controller = await getController();
          const action = button.dataset.action === 'revoke' ? 'revoke' : 'request';
          const model = await controller[action]({
            company_id: canonicalCompanyId, capability, explicit_user_action: true, actor_ref: 'permission-consent-ui', reason: `permission_consent_ui:${action}:${capability}`
          });
          emit('titan:permission-consent-result', { capability, action, model });
        } catch (error) {
          emit('titan:permission-consent-error', { capability, message: String(error?.message || error) });
        }
        await renderRow(row, capability);
      });
      list.append(row);
      renderRow(row, capability);
    }
    return details;
  }

  function mount() {
    if (document.querySelector('[data-titan-permission-consent="1"]')) return;
    styleOnce();
    const settingsHost = document.querySelector('.titan-native-settings, .titan-settings-launchers')?.parentElement;
    const diagnosticsHost = document.querySelector('#titan-diagnostics-panel .diag-body');
    const host = settingsHost || diagnosticsHost;
    if (!host) return;
    host.append(buildPanel());
    document.documentElement.setAttribute('data-titan-permission-consent-hooks', 'integrated');
  }

  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.titanBusinessProfile) return;
      document.querySelectorAll('[data-titan-permission-consent="1"] .titan-permission-row').forEach(row => renderRow(row, row.dataset.capability));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
