// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): module-view.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const q = id => document.getElementById(id);
const send = (action, extra={}) => chrome.runtime.sendMessage({type:'TITAN_MODULES', action, ...extra});
const params = new URLSearchParams(location.search);
const moduleId = params.get('module') || params.get('id') || '';
let companyId = params.get('company_id') || '';
let moduleRecord = null;
let current = {type:'overview', id:null};

function node(tag, {className='', text='', attrs={}}={}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'checked') element.checked = Boolean(value);
    else if (key === 'disabled') element.disabled = Boolean(value);
    else element.setAttribute(key, String(value));
  }
  return element;
}
function clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
function notice(message, error=false) { q('notice').textContent = message || ''; q('notice').className = error ? 'error' : ''; }
function contribution(type) { return moduleRecord?.contributes?.[type] || []; }
function byId(type, id) { return contribution(type).find(item => item.id === id) || null; }
function scopedExtra() { return companyId ? {company_id:companyId} : {}; }
function resultBox(value) { return node('pre', {className:'result', text:typeof value === 'string' ? value : JSON.stringify(value, null, 2)}); }
function card(title, description='') {
  const c = node('article', {className:'card'});
  c.append(node('h2', {text:title}));
  if (description) c.append(node('p', {text:description}));
  return c;
}
function addPageHead(title, description='') {
  const head = node('div', {className:'page-head'});
  head.append(node('h1', {text:title}));
  if (description) head.append(node('p', {text:description}));
  q('content').append(head);
}
function addNav(label, type, id=null) {
  const b = node('button', {text:label});
  b.classList.toggle('active', current.type === type && current.id === id);
  b.onclick = () => { current={type,id}; render().catch(error => notice(error.message,true)); };
  q('nav').append(b);
}

async function refreshModule() {
  if (!moduleId) throw new Error('No module id supplied');
  const response = await send('get', {id:moduleId});
  if (!response?.ok) throw new Error(response?.error || 'Module unavailable');
  moduleRecord = response.module;
  q('module-name').textContent = moduleRecord.name;
  q('module-meta').textContent = `${moduleRecord.id} · v${moduleRecord.version} · ${moduleRecord.kind}`;
  q('module-status').textContent = `${moduleRecord.enabled?'Enabled':'Disabled'} · ${moduleRecord.status} · scope ${moduleRecord.scope?.company_id || 'global'}`;
  if (moduleRecord.scope?.company_id) {
    companyId = moduleRecord.scope.company_id;
    q('company-id').value = companyId;
    q('company-id').disabled = true;
    q('apply-company').disabled = true;
  } else q('company-id').value = companyId;
}

function buildNav() {
  clear(q('nav'));
  addNav('Overview','overview');
  for (const screen of contribution('screens')) addNav(screen.title || screen.id, 'screen', screen.id);
  if (contribution('workers').length) addNav(`Workers (${contribution('workers').length})`, 'workers');
  if (contribution('tools').length) addNav(`Tools (${contribution('tools').length})`, 'tools');
  if (contribution('providers').length) addNav(`Providers (${contribution('providers').length})`, 'providers');
  if (contribution('projections').length) addNav(`Projections (${contribution('projections').length})`, 'projections');
  if (contribution('workflows').length) addNav(`Workflows (${contribution('workflows').length})`, 'workflows');
  if (contribution('settingsPanels').length) addNav(`Settings (${contribution('settingsPanels').length})`, 'settings');
}

async function renderOverview() {
  addPageHead(moduleRecord.name, moduleRecord.description || 'Titan Zero module');
  const grid = node('div', {className:'grid'});
  const counts = moduleRecord.contributionCounts || {};
  for (const type of ['screens','workers','tools','providers','projections','workflows','settingsPanels']) {
    const c = card(type.replace(/([A-Z])/g,' $1'));
    c.classList.add('metric');
    c.append(node('strong', {text:counts[type] || 0}));
    grid.append(c);
  }
  q('content').append(grid);
}

async function renderProjectionBlock(block, container) {
  const c = card(block.title || block.projection, block.description || '');
  const out = node('div', {className:'result', text:'Loading…'});
  c.append(out); container.append(c);
  const response = await send('resolveProjection', {moduleId, id:block.projection, ...scopedExtra()});
  out.textContent = response?.ok ? (typeof response.result === 'string' ? response.result : JSON.stringify(response.result,null,2)) : (response?.error || 'Projection failed');
}

async function renderSettingsPanel(panel, container) {
  const c = card(panel.title || panel.id, panel.description || '');
  const form = node('div', {className:'settings'});
  c.append(form); container.append(c);
  const response = await send('getSettings', {moduleId, ...scopedExtra()});
  if (!response?.ok) { form.append(resultBox(response?.error || 'Settings unavailable')); return; }
  const values = response.settings || {};
  const inputs = {};
  for (const field of panel.fields || []) {
    const wrap = node('div', {className:'field'});
    wrap.append(node('label', {text:field.label || field.id}));
    let input;
    if (field.type === 'textarea') input = node('textarea', {attrs:{placeholder:field.placeholder || ''}});
    else if (field.type === 'select') {
      input = node('select');
      for (const option of field.options || []) {
        const value = typeof option === 'object' ? option.value : option;
        const label = typeof option === 'object' ? (option.label ?? option.value) : option;
        const o = node('option', {text:label, attrs:{value}});
        if (String(values[field.id] ?? '') === String(value)) o.selected = true;
        input.append(o);
      }
    } else if (field.type === 'boolean') input = node('input', {attrs:{type:'checkbox', checked:Boolean(values[field.id])}});
    else input = node('input', {attrs:{type:field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text', placeholder:field.placeholder || ''}});
    if (field.type !== 'boolean' && field.type !== 'select') input.value = values[field.id] ?? '';
    inputs[field.id] = {input, type:field.type};
    wrap.append(input);
    if (field.description) wrap.append(node('small', {text:field.description}));
    form.append(wrap);
  }
  const save = node('button', {text:'Save settings'});
  save.onclick = async () => {
    const next = {};
    for (const [id, entry] of Object.entries(inputs)) {
      if (entry.type === 'boolean') next[id] = entry.input.checked;
      else if (entry.type === 'number') next[id] = entry.input.value === '' ? null : Number(entry.input.value);
      else next[id] = entry.input.value;
    }
    const r = await send('updateSettings', {moduleId, values:next, ...scopedExtra()});
    notice(r?.ok ? 'Settings saved' : (r?.error || 'Save failed'), !r?.ok);
  };
  form.append(save);
}

async function runAction(action, container) {
  try {
    let response;
    if (action.type === 'tool') response = await send('invokeTool', {moduleId, id:action.id, payload:action.input || {}, ...scopedExtra()});
    else if (action.type === 'workflow') response = await send('runWorkflow', {moduleId, id:action.id, input:action.input || {}, ...scopedExtra()});
    else if (action.type === 'command') response = await send('invoke', {id:moduleId, command:action.id, payload:action.input || {}, ...scopedExtra()});
    else throw new Error('Unsupported action type');
    container.append(resultBox(response?.ok ? response.result : (response?.error || 'Action failed')));
  } catch (error) { notice(error.message,true); }
}

async function renderScreen(screen) {
  addPageHead(screen.title || screen.id, screen.description || '');
  const grid = node('div', {className:'grid'}); q('content').append(grid);
  for (const block of screen.blocks || []) {
    if (block.type === 'text') {
      const c=card(block.title || 'Text'); c.append(node('p',{text:block.text || ''})); grid.append(c);
    } else if (block.type === 'metric') {
      const c=card(block.title || block.label || 'Metric'); c.classList.add('metric'); c.append(node('strong',{text:block.value ?? '—'})); grid.append(c);
    } else if (block.type === 'list') {
      const c=card(block.title || 'List'); const list=node('div',{className:'list'});
      for (const item of block.items || []) list.append(node('div',{className:'list-item',text:typeof item === 'object' ? (item.label ?? JSON.stringify(item)) : item}));
      c.append(list); grid.append(c);
    } else if (block.type === 'projection') await renderProjectionBlock(block,grid);
    else if (block.type === 'settings') { const panel=byId('settingsPanels',block.panel); if(panel) await renderSettingsPanel(panel,grid); }
    else if (block.type === 'workers') await renderWorkers(grid,false);
    else if (block.type === 'workflows') await renderWorkflows(grid,false);
    else if (block.type === 'actions') {
      const c=card(block.title || 'Actions'); const actions=node('div',{className:'actions'});
      for (const action of block.actions || []) { const b=node('button',{text:action.label || action.id || action.type || 'Action'}); b.onclick=()=>runAction(action,c); actions.append(b); }
      c.append(actions); grid.append(c);
    }
  }
}

async function renderWorkers(container=q('content'), head=true) {
  if (head) addPageHead('Workers & agents','Workers contributed by this module.');
  const grid=node('div',{className:'grid'});
  for (const worker of contribution('workers')) {
    const c=card(worker.name || worker.id, worker.description || worker.role || '');
    c.append(node('div',{className:'meta',text:`Role: ${worker.role || '—'} · Autonomy: ${worker.autonomy || 'suggest'} · Tools: ${(worker.tools || []).join(', ') || 'none'}`}));
    const b=node('button',{text:worker.workflow ? 'Run worker' : 'Prepare task'});
    b.onclick=async()=>{
      const r=await send('runWorker',{moduleId,id:worker.id,input:{task:'Manual module-view run'},...scopedExtra()});
      c.append(resultBox(r?.ok ? r.result : (r?.error || 'Worker failed')));
    };
    const actions=node('div',{className:'actions'}); actions.append(b); c.append(actions); grid.append(c);
  }
  if (!grid.childNodes.length) grid.append(node('div',{className:'empty',text:'No workers contributed.'}));
  container.append(grid);
}

async function renderTools() {
  addPageHead('Tools','Allowlisted module tools. Declarative tools may bind only to same-module commands; packaged modules can register executable handlers.');
  const grid=node('div',{className:'grid'});
  for (const tool of contribution('tools')) {
    const c=card(tool.title || tool.id, tool.description || '');
    c.append(node('div',{className:'meta',text:`${tool.id} · permissions ${(tool.permissions || []).join(', ') || 'none'} · ${tool.command ? 'command '+tool.command : 'packaged handler'}`}));
    const b=node('button',{text:'Run'});
    b.onclick=async()=>{
      const r=await send('invokeTool',{moduleId,id:tool.id,payload:{source:'module-view'},...scopedExtra()});
      c.append(resultBox(r?.ok ? r.result : (r?.error || 'Tool failed')));
    };
    const actions=node('div',{className:'actions'}); actions.append(b); c.append(actions); grid.append(c);
  }
  q('content').append(grid);
}

async function renderProviders() {
  addPageHead('Providers','Provider registrations exposed by this module. Runtime JSON providers are metadata-only unless a packaged handler exists.');
  const grid=node('div',{className:'grid'});
  for (const provider of contribution('providers')) {
    const c=card(provider.title || provider.id, provider.description || '');
    c.append(node('div',{className:'meta',text:`${provider.id} · ${provider.type} · ${(provider.capabilities || []).join(', ') || 'no capabilities'}`}));
    const b=node('button',{text:'Probe provider'});
    b.onclick=async()=>{
      const r=await send('invokeProvider',{moduleId,id:provider.id,payload:{source:'module-view'},...scopedExtra()});
      c.append(resultBox(r?.ok ? r.result : (r?.error || 'Provider unavailable')));
    };
    const actions=node('div',{className:'actions'}); actions.append(b); c.append(actions); grid.append(c);
  }
  q('content').append(grid);
}

async function renderProjections() {
  addPageHead('Data projections','Read-only views contributed by this module.');
  const grid=node('div',{className:'grid'});
  for (const projection of contribution('projections')) await renderProjectionBlock({title:projection.title || projection.id,description:projection.description,projection:projection.id},grid);
  q('content').append(grid);
}

async function renderWorkflows(container=q('content'), head=true) {
  if (head) addPageHead('Workflows','Bounded module workflows composed from tools, commands, projections and set steps.');
  const grid=node('div',{className:'grid'});
  for (const workflow of contribution('workflows')) {
    const c=card(workflow.title || workflow.id, workflow.description || '');
    c.append(node('div',{className:'meta',text:`${workflow.steps?.length || 0} steps · ${workflow.id}`}));
    const b=node('button',{text:'Run workflow'});
    b.onclick=async()=>{
      const r=await send('runWorkflow',{moduleId,id:workflow.id,input:{source:'module-view'},...scopedExtra()});
      c.append(resultBox(r?.ok ? r.result : (r?.error || 'Workflow failed')));
    };
    const actions=node('div',{className:'actions'}); actions.append(b); c.append(actions); grid.append(c);
  }
  if (!grid.childNodes.length) grid.append(node('div',{className:'empty',text:'No workflows contributed.'}));
  container.append(grid);
}

async function renderSettings() {
  addPageHead('Settings panels','Schema-driven settings stored per module and company_id.');
  const grid=node('div',{className:'grid'}); q('content').append(grid);
  for (const panel of contribution('settingsPanels')) await renderSettingsPanel(panel,grid);
}

async function render() {
  notice(''); clear(q('content')); buildNav();
  if (current.type === 'overview') await renderOverview();
  else if (current.type === 'screen') { const screen=byId('screens',current.id); if(screen) await renderScreen(screen); else throw new Error('Screen not found'); }
  else if (current.type === 'workers') await renderWorkers();
  else if (current.type === 'tools') await renderTools();
  else if (current.type === 'providers') await renderProviders();
  else if (current.type === 'projections') await renderProjections();
  else if (current.type === 'workflows') await renderWorkflows();
  else if (current.type === 'settings') await renderSettings();
  buildNav();
}

q('apply-company').onclick = () => {
  companyId = q('company-id').value.trim();
  const next = new URL(location.href);
  if (companyId) next.searchParams.set('company_id',companyId); else next.searchParams.delete('company_id');
  history.replaceState(null,'',next);
  render().catch(error=>notice(error.message,true));
};
window.addEventListener('error',event=>notice(event.message,true));
window.addEventListener('unhandledrejection',event=>notice(String(event.reason?.message || event.reason),true));
refreshModule().then(()=>render()).catch(error=>notice(error.message,true));
