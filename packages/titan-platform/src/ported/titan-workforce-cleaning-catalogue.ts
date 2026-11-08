// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-workforce-cleaning-catalogue.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero Workforce Agents — Cleaning catalogue population bridge.
 * Surfaces existing TitanCleaningWorkforce specialists inside the retained rich
 * Workforce Agents catalogue. This is presentation only: role identity does not
 * grant authority and every profile/action remains company-bound and governed.
 */
(() => {
  const ROOT_ID = 'titan-cleaning-workforce-agent-catalogue';
  const clean = value => String(value ?? '').trim();
  const escapeHtml = value => clean(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const validCompany = value => !!clean(value) && clean(value) !== 'default';

  async function companyId() {
    try {
      const raw = await chrome.storage.local.get(['titanBusinessProfile']);
      const id = clean(raw?.titanBusinessProfile?.company_id);
      return validCompany(id) ? id : '';
    } catch { return ''; }
  }

  function isWorkforceAgentsSurface() {
    const route = clean(document.documentElement.dataset.titanAiSurface || document.body?.dataset?.titanAiSurface).toLowerCase();
    const text = clean(document.body?.innerText).toLowerCase();
    return route === 'workforceagents' || text.includes('workforce agents') || text.includes('my workforce agents');
  }

  function findCatalogueHost() {
    const candidates = [
      '[data-titan-ai-surface="WorkforceAgents"]',
      '[data-titan-workforce-agents-catalogue="true"]',
      'main',
      '#root'
    ];
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return document.body;
  }

  function ensureStyles() {
    if (document.getElementById('titan-cleaning-workforce-catalogue-style')) return;
    const style = document.createElement('style');
    style.id = 'titan-cleaning-workforce-catalogue-style';
    style.textContent = `
      #${ROOT_ID}{margin:18px 0 28px;padding:18px;border-radius:18px;border:1px solid color-mix(in srgb,var(--t0-secondary,#2563eb) 28%,transparent);background:color-mix(in srgb,var(--t0-bg,#111827) 94%,var(--t0-secondary,#2563eb) 6%);color:var(--t0-text,#f8fafc);font:13px/1.45 system-ui,sans-serif}
      #${ROOT_ID} .titan-cleaning-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
      #${ROOT_ID} h2{margin:0;font-size:18px} #${ROOT_ID} .sub{opacity:.68;margin-top:3px}
      #${ROOT_ID} .count{white-space:nowrap;padding:4px 8px;border-radius:999px;background:rgba(37,99,235,.14)}
      #${ROOT_ID} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
      #${ROOT_ID} button.card{display:block;width:100%;text-align:left;appearance:none;border:1px solid rgba(148,163,184,.18);background:rgba(255,255,255,.035);color:inherit;border-radius:14px;padding:12px;cursor:pointer;min-height:128px}
      #${ROOT_ID} button.card:hover,#${ROOT_ID} button.card:focus{outline:none;border-color:rgba(37,99,235,.55);background:rgba(37,99,235,.09)}
      #${ROOT_ID} .name{font-weight:750;font-size:14px;margin-bottom:3px} #${ROOT_ID} .dept{font-size:11px;opacity:.58;text-transform:uppercase;letter-spacing:.05em}
      #${ROOT_ID} .purpose{margin:8px 0 9px;opacity:.8} #${ROOT_ID} .tags{display:flex;gap:5px;flex-wrap:wrap}
      #${ROOT_ID} .tag{font-size:11px;padding:2px 6px;border-radius:999px;background:rgba(100,116,139,.16)}
      #${ROOT_ID} dialog{width:min(760px,calc(100vw - 32px));border:1px solid rgba(148,163,184,.25);border-radius:16px;background:var(--t0-bg,#111827);color:var(--t0-text,#f8fafc);padding:16px;box-shadow:0 24px 70px rgba(0,0,0,.45)}
      #${ROOT_ID} dialog::backdrop{background:rgba(0,0,0,.55)} #${ROOT_ID} .close{float:right;appearance:none;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer}
    `;
    document.head.appendChild(style);
  }

  function specialistCard(worker) {
    const caps = Array.isArray(worker.capabilities) ? worker.capabilities.slice(0,3) : [];
    return `<button type="button" class="card" data-cleaning-worker-id="${escapeHtml(worker.id)}" data-titan-workforce-agent-card="true" aria-label="Open ${escapeHtml(worker.name)} profile"><div class="dept">${escapeHtml(worker.department || 'cleaning')}</div><div class="name">🧹 ${escapeHtml(worker.name)}</div><div class="purpose">${escapeHtml(worker.purpose)}</div><div class="tags">${caps.map(c=>`<span class="tag">${escapeHtml(c.replaceAll('_',' '))}</span>`).join('')}</div></button>`;
  }

  function showProfile(root, worker, company_id) {
    let dialog = root.querySelector('dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      root.appendChild(dialog);
    }
    document.documentElement.dataset.titanWorkforceAgentSelectedLabel = worker.name;
    dialog.innerHTML = `<button type="button" class="close" aria-label="Close">×</button><div data-titan-workforce-agent-profile="true"><h2>${escapeHtml(worker.name)}</h2><p>${escapeHtml(worker.purpose)}</p><div class="tags">${(worker.capabilities||[]).map(c=>`<span class="tag">${escapeHtml(c.replaceAll('_',' '))}</span>`).join('')}</div><p class="sub">Cleaning specialist · ${escapeHtml(worker.department)} · company scoped</p></div>`;
    dialog.dataset.companyId = company_id;
    dialog.dataset.workerId = worker.id;
    dialog.querySelector('.close')?.addEventListener('click', () => dialog.close());
    if (!dialog.open) dialog.showModal?.();
    document.dispatchEvent(new CustomEvent('titan:workforce-agent-profile-opened',{detail:{company_id,worker_id:worker.id}}));
  }

  async function render() {
    if (!isWorkforceAgentsSurface()) return;
    const workforce = window.TitanCleaningWorkforce;
    const specialists = Array.isArray(workforce?.specialists) ? workforce.specialists : [];
    if (!specialists.length) return;
    const company_id = await companyId();
    if (!company_id) return;
    const host = findCatalogueHost();
    if (!host) return;
    ensureStyles();
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = ROOT_ID;
      root.dataset.titanWorkforceAgentsPopulation = 'cleaning';
      host.appendChild(root);
    }
    root.dataset.companyId = company_id;
    root.innerHTML = `<div class="titan-cleaning-head"><div><h2>Cleaning Workforce Agents</h2><div class="sub">Specialists already installed in Titan Zero for cleaning businesses.</div></div><span class="count">${specialists.length} specialists</span></div><div class="grid">${specialists.map(specialistCard).join('')}</div>`;
    root.querySelectorAll('[data-cleaning-worker-id]').forEach(card => card.addEventListener('click', () => {
      const worker = workforce.byId?.[card.dataset.cleaningWorkerId] || specialists.find(item => item.id === card.dataset.cleaningWorkerId);
      if (worker) showProfile(root, worker, company_id);
    }));
  }

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => render().catch(()=>{}), 60); };
  const start = () => {
    schedule();
    new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true});
    document.addEventListener('click',schedule,true);
    chrome.storage?.onChanged?.addListener?.((changes,area)=>{ if(area==='local' && ('titanBusinessProfile' in changes)) schedule(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
