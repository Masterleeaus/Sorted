// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-workforce-agent-profile.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(() => {
  'use strict';

  const STORE_KEYS = ['titanBusinessProfile', 'titanWorkforceRoster', 'titanWorkforceManagerProjection'];
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const validCompany = value => /^[A-Za-z0-9._:-]{2,128}$/.test(clean(value));
  const list = value => Array.isArray(value) ? value : [];
  const escapeHtml = value => clean(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let roleCatalogue = null;

  async function loadRoleCatalogue() {
    if (roleCatalogue) return roleCatalogue;
    try {
      const response = await fetch(chrome.runtime.getURL('titan-workforce/catalogue/installed-client-workforce-master.json'));
      roleCatalogue = response.ok ? await response.json() : { roles: [] };
    } catch (_) { roleCatalogue = { roles: [] }; }
    return roleCatalogue;
  }

  function projectionFor(raw, company_id) {
    const store = raw?.titanWorkforceManagerProjection;
    const projection = store?.company_id ? store : store?.[company_id];
    return projection?.company_id === company_id ? projection : null;
  }

  function matchByLabel(label, roster, roles) {
    const wanted = clean(label).toLowerCase();
    if (!wanted) return null;
    const candidates = [
      ...list(roster).map(item => ({ source: 'roster', item })),
      ...list(roles).map(item => ({ source: 'role', item })),
      ...list(window.TitanWorkforce?.workers).map(item => ({ source: 'runtime', item }))
    ];
    const exact = candidates.find(({item}) => [item.name,item.label,item.role_name].some(v => clean(v).toLowerCase() === wanted));
    if (exact) return exact;
    return candidates.find(({item}) => wanted.includes(clean(item.name || item.label || item.role_name).toLowerCase())) || null;
  }

  function workerId(match) {
    const item = match?.item || {};
    return clean(item.worker_id || item.id || item.role_definition_id);
  }

  function roleFor(match, roles) {
    const item = match?.item || {};
    const id = clean(item.role_definition_id || item.id);
    const name = clean(item.name || item.role_name).toLowerCase();
    return list(roles).find(role => clean(role.role_definition_id) === id || clean(role.name).toLowerCase() === name) || (match?.source === 'role' ? item : null);
  }

  function assignmentRefs(projection, id) {
    return list(projection?.assignments).filter(a => [a.worker_id,a.assignee_worker_id,a.actor_id].map(clean).includes(id));
  }

  function statusFor(match, projection) {
    const id = workerId(match);
    const rosterItem = list(projection?.roster).find(r => clean(r.worker_id || r.id) === id) || (match?.source === 'roster' ? match.item : null);
    return clean(rosterItem?.status || rosterItem?.state || rosterItem?.availability || 'Available');
  }

  function profileData(match, role, projection, company_id) {
    const item = match?.item || {};
    const id = workerId(match);
    const runtime = window.TitanWorkforce?.getWorkerById?.(item.id || id) || null;
    const capabilities = [...new Set([
      ...list(item.capabilities), ...list(runtime?.capabilities), ...list(role?.operational_domains)
    ].map(clean).filter(Boolean))];
    const skills = [...new Set([
      ...list(item.skills), ...list(role?.skills), ...capabilities
    ].map(clean).filter(Boolean))];
    const tools = [...new Set([
      ...list(item.tools), ...list(role?.tools), ...list(item.allowed_tools), ...list(role?.allowed_tools)
    ].map(clean).filter(Boolean))];
    const assignments = assignmentRefs(projection, id);
    return {
      company_id,
      worker_id: id || clean(role?.role_definition_id),
      name: clean(item.name || item.role_name || role?.name || 'Workforce Agent'),
      role: clean(item.department || role?.division_key || item.role || 'Workforce Agent'),
      purpose: clean(item.description || role?.purpose),
      status: statusFor(match, projection),
      skills,
      tools,
      allowed_capabilities: capabilities,
      assignments,
      risk_ceiling: clean(role?.risk_ceiling || item.risk_ceiling),
      role_definition_id: clean(role?.role_definition_id || item.role_definition_id || item.id),
      grants_authority: false
    };
  }

  function findProfileHost() {
    const marked = document.querySelector('[data-titan-workforce-agent-profile="true"]');
    if (!marked) return null;
    return marked.closest('[role="dialog"],section,article,main,div') || marked.parentElement;
  }

  function chip(value) { return `<span class="titan-wfa-chip">${escapeHtml(value)}</span>`; }
  function renderList(values, empty='None declared') {
    return values.length ? values.map(chip).join('') : `<span class="titan-wfa-muted">${escapeHtml(empty)}</span>`;
  }

  function postAction(action, data) {
    if (!data?.company_id || !data?.worker_id) return;
    window.parent?.postMessage?.({
      type: 'TITAN_WORKFORCE_AGENT_ACTION',
      action,
      company_id: data.company_id,
      worker_id: data.worker_id,
      role_definition_id: data.role_definition_id || data.worker_id,
      label: data.name,
      grants_authority: false
    }, '*');
  }

  function bindActions(host, data) {
    const bar = host.querySelector('.titan-wfa-actions');
    if (!bar || bar.dataset.bound === '1') return;
    bar.dataset.bound = '1';
    bar.querySelectorAll('[data-wfa-action]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        postAction(button.dataset.wfaAction, data);
      });
    });
  }

  function ensureStyles() {
    if (document.getElementById('titan-workforce-agent-profile-style')) return;
    const style = document.createElement('style');
    style.id = 'titan-workforce-agent-profile-style';
    style.textContent = `.titan-wfa-runtime-profile{margin:12px 0;padding:14px;border:1px solid color-mix(in srgb,var(--t0-primary,#2563eb) 38%,transparent);border-radius:14px;background:color-mix(in srgb,var(--t0-bg,#111827) 92%,var(--t0-primary,#2563eb) 8%);color:var(--t0-text,#f8fafc);font:13px/1.45 system-ui,sans-serif}.titan-wfa-runtime-profile h3{margin:0 0 4px;font-size:16px}.titan-wfa-runtime-profile .titan-wfa-sub{opacity:.72;margin-bottom:10px}.titan-wfa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.titan-wfa-block{padding:9px;border-radius:10px;background:rgba(255,255,255,.045)}.titan-wfa-block strong{display:block;margin-bottom:6px}.titan-wfa-chip{display:inline-block;margin:2px 4px 2px 0;padding:3px 7px;border-radius:999px;background:rgba(37,99,235,.16);border:1px solid rgba(37,99,235,.28)}.titan-wfa-muted{opacity:.6}.titan-wfa-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.titan-wfa-actions button{appearance:none;border:1px solid rgba(37,99,235,.35);background:rgba(37,99,235,.14);color:inherit;padding:7px 10px;border-radius:9px;font:600 12px/1 system-ui,sans-serif;cursor:pointer}.titan-wfa-actions button:hover{background:rgba(37,99,235,.22)}.titan-wfa-authority{margin-top:9px;font-size:12px;opacity:.72}@media(max-width:620px){.titan-wfa-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(style);
  }

  async function renderProfile() {
    const host = findProfileHost();
    if (!host) return;
    const label = clean(document.documentElement.dataset.titanWorkforceAgentSelectedLabel || host.textContent);
    if (!label) return;
    let existing = host.querySelector(':scope > .titan-wfa-runtime-profile');
    const raw = await chrome.storage.local.get(STORE_KEYS).catch(() => ({}));
    const company_id = clean(raw.titanBusinessProfile?.company_id);
    if (!validCompany(company_id)) return;
    const projection = projectionFor(raw, company_id);
    const catalogue = await loadRoleCatalogue();
    const roster = projection?.roster?.length ? projection.roster : raw.titanWorkforceRoster;
    const match = matchByLabel(label, roster, catalogue.roles);
    if (!match) return;
    const role = roleFor(match, catalogue.roles);
    const data = profileData(match, role, projection, company_id);
    ensureStyles();
    if (!existing) {
      existing = document.createElement('section');
      existing.className = 'titan-wfa-runtime-profile';
      existing.dataset.titanWorkforceAgentRuntimeProfile = 'true';
      host.appendChild(existing);
    }
    existing.dataset.companyId = company_id;
    existing.dataset.workerId = data.worker_id;
    existing.innerHTML = `<h3>${escapeHtml(data.name)}</h3><div class="titan-wfa-sub">${escapeHtml(data.role)}${data.purpose ? ` · ${escapeHtml(data.purpose)}` : ''}</div><div class="titan-wfa-grid"><div class="titan-wfa-block"><strong>Status</strong>${chip(data.status)}</div><div class="titan-wfa-block"><strong>Assignments</strong>${data.assignments.length ? data.assignments.map(a=>chip(a.work_item_id||a.assignment_id||a.id||'Assignment')).join('') : '<span class="titan-wfa-muted">No active assignments</span>'}</div><div class="titan-wfa-block"><strong>Skills</strong>${renderList(data.skills)}</div><div class="titan-wfa-block"><strong>Tools</strong>${renderList(data.tools,'No explicit tool restrictions published')}</div><div class="titan-wfa-block"><strong>Allowed capabilities</strong>${renderList(data.allowed_capabilities)}</div><div class="titan-wfa-block"><strong>Risk ceiling</strong>${escapeHtml(data.risk_ceiling || 'Not specified')}</div></div><div class="titan-wfa-actions"><button type="button" data-wfa-action="launch">Launch</button><button type="button" data-wfa-action="use">Use in Titan</button><button type="button" data-wfa-action="assign">Assign</button><button type="button" data-wfa-action="configure">Configure</button></div><div class="titan-wfa-authority">Capabilities and Workforce Agent identity do not grant execution authority. Actions remain governed by Titan policy, permissions, autonomy, risk, entitlements and approvals.</div>`;
    bindActions(existing, data);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; renderProfile().catch(() => {}); }, 0);
  }

  const observer = new MutationObserver(schedule);
  const start = () => {
    schedule();
    observer.observe(document.documentElement, {subtree:true,childList:true,characterData:true,attributes:true});
    document.addEventListener('click', schedule, true);
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area === 'local' && STORE_KEYS.some(key => key in changes)) schedule();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
