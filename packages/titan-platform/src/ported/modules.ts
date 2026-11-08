// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): modules.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const $=id=>document.getElementById(id);
const send=(action,extra={})=>chrome.runtime.sendMessage({type:'TITAN_MODULES',action,...extra});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const companyId=()=>String($('grant-company')?.value||'').trim();
async function hydrateCompany(){try{const d=await chrome.storage.local.get(['titanBusinessProfile']);const id=String(d.titanBusinessProfile?.company_id||'').trim();if(id&&$('grant-company'))$('grant-company').value=id}catch(_){}}
async function loadMarketplaceWithFallback(){
  try{
    const live=await send('listMarketplace');
    if(live?.ok && Array.isArray(live.catalog?.items) && live.catalog.items.length) return live;
  }catch(_){}
  try{
    const response=await fetch(chrome.runtime.getURL('titan-modules/marketplace/catalog.json'));
    const catalog=await response.json();
    return {ok:true,catalog,fallback:true};
  }catch(error){return {ok:false,error:error.message,catalog:{items:[]}}}
}

function notice(message,error=false){$('notice').textContent=message||'';$('notice').className=error?'error':''}
function count(module,type){return module.contributionCounts?.[type]??module.contributes?.[type]?.length??0}
function authoritySummary(module){const requests=module.authority?.requests||[];return requests.length?`${requests.length} authority request${requests.length===1?'':'s'}`:'no authority requested'}
function dependencySummary(module){const deps=module.requires?.modules||[];return deps.length?`${deps.length} dependenc${deps.length===1?'y':'ies'}`:'no dependencies'}
function verifiedSummary(module){return module.packageVerification?.verified?`verified · ${module.packageVerification.publisher_id||'trusted publisher'}`:'local / packaged'}

function renderMarketplace(catalog){
  const items=catalog?.items||[];
  $('marketplace-count').textContent=`${items.length} signed package${items.length===1?'':'s'}`;
  if(!items.length){$('marketplace-list').innerHTML='<div class="empty">No marketplace packages are currently catalogued.</div>';return}
  $('marketplace-list').innerHTML=items.map(item=>`<article class="market-card"><div><div class="module-title"><strong>${esc(item.name)}</strong><span class="pill verified">SIGNED</span><span class="pill">${esc(item.package_type)}</span></div><p>${esc(item.description||'')}</p><div class="meta"><span>${esc(item.id)} · v${esc(item.version)}</span><span>publisher: ${esc(item.publisher_id)}</span></div></div><button class="featured" data-marketplace="${esc(item.id)}">Verify & install</button></article>`).join('');
  document.querySelectorAll('[data-marketplace]').forEach(button=>button.onclick=async()=>{
    try{button.disabled=true;const r=await send('installMarketplace',{id:button.dataset.marketplace});if(!r?.ok)throw new Error(r?.error||'Marketplace install failed');notice(`Verified and installed ${r.item?.name||button.dataset.marketplace}`);await load()}catch(error){notice(error.message,true)}finally{button.disabled=false}
  });
}

function renderGrants(grants){
  $('grant-count').textContent=`${grants.length} grant${grants.length===1?'':'s'}`;
  if(!grants.length){$('grant-list').innerHTML='<div class="empty">No governance authority grants have been issued.</div>';return}
  $('grant-list').innerHTML=grants.map(grant=>`<article class="grant-card"><div><div class="module-title"><strong>${esc(grant.module_id)}</strong><span class="pill ${grant.active?'verified':'warn'}">${grant.active?'ACTIVE':esc(grant.status||'inactive')}</span></div><div class="meta"><span>company: ${esc(grant.company_id)}</span><span>authority: ${esc((grant.authority_ids||[]).join(', '))}</span><span>actions: ${esc((grant.actions||[]).join(', '))}</span><span>expires: ${esc(grant.expires_at||'')}</span></div></div>${grant.active?`<button class="danger" data-revoke-grant="${esc(grant.id)}">Revoke</button>`:''}</article>`).join('');
  document.querySelectorAll('[data-revoke-grant]').forEach(button=>button.onclick=async()=>{
    try{const r=await send('revokeGrant',{id:button.dataset.revokeGrant,revoked_by:'user:module-manager',reason:'Revoked in Module Manager'});if(!r?.ok)throw new Error(r?.error||'Grant revoke failed');notice('Authority grant revoked');await loadGrants()}catch(error){notice(error.message,true)}
  });
}

async function rollbackLatest(kind,id){
  const historyResponse=await send('listHistory',{kind,id});if(!historyResponse?.ok)throw new Error(historyResponse?.error||'Version history unavailable');
  const history=historyResponse.history||[];if(!history.length)throw new Error(`No Version history exists for ${id}`);
  const latest=history[history.length-1];const version=latest.version||latest.manifest?.version||latest.bundle?.version;
  if(!version)throw new Error('History entry has no version');
  const action=kind==='bundle'?'rollbackBundle':'rollbackModule';const response=await send(action,{id,version});if(!response?.ok)throw new Error(response?.error||'Rollback failed');
  notice(`Rolled back ${id} to v${version}`);await load();
}

function renderBundles(bundles){
  $('bundle-count').textContent=`${bundles.length} total`;
  if(!bundles.length){$('bundle-list').innerHTML='<div class="empty">No runtime bundles installed. The signed Cleaning Workforce pack is available above.</div>';return}
  $('bundle-list').innerHTML=bundles.map(bundle=>{const state=bundle.state||'enabled';return `<article class="bundle-card"><div><div class="module-title"><strong>${esc(bundle.name)}</strong><span class="pill">${esc(bundle.pack_type)}</span><span class="pill ${state==='suspended'?'warn':'verified'}">${esc(state)}</span></div><p>${esc(bundle.description||'No description')}</p><div class="meta"><span>${esc(bundle.id)} · v${esc(bundle.version)}</span><span>${bundle.moduleIds?.length||0} modules</span><span>activation authority: ${bundle.authority?.activation_confers_authority?'invalid':'none'}</span></div></div><div class="module-actions"><button data-bundle-state="${esc(bundle.id)}" data-next-state="${state==='suspended'?'enabled':'suspended'}">${state==='suspended'?'Resume':'Suspend bundle'}</button><button data-bundle-history="${esc(bundle.id)}">Rollback</button><button class="danger" data-remove-bundle="${esc(bundle.id)}">Uninstall bundle</button></div></article>`}).join('');
  document.querySelectorAll('[data-bundle-state]').forEach(button=>button.onclick=async()=>{
    try{const state=button.dataset.nextState;const r=await send('setBundleState',{id:button.dataset.bundleState,state});if(!r?.ok)throw new Error(r?.error||'Bundle state change failed');notice(`${button.dataset.bundleState} → ${state}`);await load()}catch(error){notice(error.message,true)}
  });
  document.querySelectorAll('[data-bundle-history]').forEach(button=>button.onclick=()=>rollbackLatest('bundle',button.dataset.bundleHistory).catch(error=>notice(error.message,true)));
  document.querySelectorAll('[data-remove-bundle]').forEach(button=>button.onclick=async()=>{
    try{const r=await send('uninstallBundle',{id:button.dataset.removeBundle});if(!r?.ok)throw new Error(r?.error||'Bundle uninstall failed');notice(`Uninstalled ${button.dataset.removeBundle}`);await load()}catch(error){notice(error.message,true)}
  });
}

async function grantModuleAuthority(module){
  const requests=module.authority?.requests||[];if(!requests.length)throw new Error('This module declares no authority requests');
  const company_id=companyId();if(!company_id)throw new Error('Enter company_id before issuing a grant');
  const expires_at=new Date(Date.now()+60*60*1000).toISOString();
  const r=await send('issueGrant',{grant:{company_id,module_id:module.id,authority_ids:requests.map(item=>item.id),actions:['*'],issued_by:'user:module-manager',expires_at,reason:'Explicit grant from Titan Zero Module Manager'}});
  if(!r?.ok)throw new Error(r?.error||'Authority grant failed');notice(`Authority granted to ${module.id} for ${company_id} until ${expires_at}`);await loadGrants();
}

function renderModules(modules){
  $('module-count').textContent=`${modules.length} total`;
  if(!modules.length){$('module-list').innerHTML='<div class="empty">No modules installed.</div>';return}
  $('module-list').innerHTML=modules.map(module=>{
    const canRemove=module.source!=='packaged',requests=module.authority?.requests||[],companyEnabled=module.companyEnabled??true;
    const detail=[`${count(module,'screens')} screens`,`${count(module,'workers')} workers`,`${count(module,'tools')} tools`,`${count(module,'workflows')} workflows`,`${count(module,'queries')} queries`,`${count(module,'verticals')} verticals`,`${count(module,'events')} event subscriptions`];
    const dependencyErrors=module.companyDependencyErrors?.length?module.companyDependencyErrors:(module.dependencyErrors||[]),displayStatus=module.companyStatus||module.status,statusClass=['error','quarantined'].includes(displayStatus)?'error':displayStatus==='blocked'?'warn':'';
    return `<article class="module-card" data-id="${esc(module.id)}"><div><div class="module-title"><strong>${esc(module.name)}</strong><span class="pill">${esc(module.kind)}</span><span class="pill ${statusClass}">${esc(displayStatus)}</span>${module.packageVerification?.verified?'<span class="pill verified">VERIFIED</span>':''}</div><p>${esc(module.description||'No description')}</p><div class="meta"><span>${esc(module.id)} · v${esc(module.version)}</span><span>${esc(verifiedSummary(module))}</span><span>${esc(dependencySummary(module))}</span><span>${esc(authoritySummary(module))}</span>${detail.map(item=>`<span>${esc(item)}</span>`).join('')}<span>scope: ${esc(module.scope?.company_id||'global')}</span><span>company ${esc(module.company_id||companyId()||'none')}: ${companyEnabled?'enabled':'disabled'}</span></div>${dependencyErrors.length?`<p class="warn-text">Dependencies: ${esc(dependencyErrors.join('; '))}</p>`:''}${module.error?`<p class="error">${esc(module.error)}</p>`:''}</div><div class="module-actions"><a class="open" href="module-view.html?module=${encodeURIComponent(module.id)}">Open</a><button class="toggle ${module.enabled?'on':''}" data-toggle="${esc(module.id)}" data-enabled="${module.enabled?'1':'0'}">Global ${module.enabled?'enabled':'disabled'}</button><button class="toggle ${companyEnabled?'on':''}" data-company-toggle="${esc(module.id)}" data-company-enabled="${companyEnabled?'1':'0'}">Company ${companyEnabled?'enabled':'disabled'}</button><button data-config="${esc(module.id)}">Company config</button>${displayStatus==='quarantined'?`<button data-recover="${esc(module.id)}">Recover</button>`:''}${requests.length?`<button class="authority" data-grant-module="${esc(module.id)}">Grant authority</button>`:''}${canRemove?`<button data-module-history="${esc(module.id)}">Rollback version</button>`:''}${count(module,'commands')?`<button data-command="${esc(module.id)}">Test command</button>`:''}${canRemove?`<button class="danger" data-remove="${esc(module.id)}">Remove</button>`:''}</div></article>`;
  }).join('');
  document.querySelectorAll('[data-toggle]').forEach(button=>button.onclick=async()=>{try{const enabled=button.dataset.enabled!=='1';const r=await send('setEnabled',{id:button.dataset.toggle,enabled});if(!r?.ok)throw new Error(r?.error||'Toggle failed');await load()}catch(error){notice(error.message,true)}});
  document.querySelectorAll('[data-company-toggle]').forEach(button=>button.onclick=async()=>{try{const company_id=companyId();if(!company_id)throw new Error('Enter company_id first');const enabled=button.dataset.companyEnabled!=='1';const r=await send('setCompanyEnabled',{id:button.dataset.companyToggle,company_id,enabled});if(!r?.ok)throw new Error(r?.error||'Company toggle failed');await load()}catch(error){notice(error.message,true)}});
  document.querySelectorAll('[data-config]').forEach(button=>button.onclick=async()=>{try{const company_id=companyId();if(!company_id)throw new Error('Enter company_id first');const current=await send('getCompanyConfig',{id:button.dataset.config,company_id});if(!current?.ok)throw new Error(current?.error||'Config unavailable');const raw=prompt('Company module config (JSON object)',JSON.stringify(current.config||{},null,2));if(raw==null)return;const values=JSON.parse(raw);const r=await send('updateCompanyConfig',{id:button.dataset.config,company_id,values});if(!r?.ok)throw new Error(r?.error||'Config update failed');notice(`Updated company config for ${button.dataset.config}`);await load()}catch(error){notice(error.message,true)}});
  document.querySelectorAll('[data-recover]').forEach(button=>button.onclick=async()=>{try{const r=await send('recoverModule',{id:button.dataset.recover});if(!r?.ok)throw new Error(r?.error||'Recovery failed');notice(`Recovered ${button.dataset.recover}`);await load()}catch(error){notice(error.message,true)}});
  document.querySelectorAll('[data-grant-module]').forEach(button=>button.onclick=()=>{const module=modules.find(item=>item.id===button.dataset.grantModule);grantModuleAuthority(module).catch(error=>notice(error.message,true))});
  document.querySelectorAll('[data-module-history]').forEach(button=>button.onclick=()=>rollbackLatest('module',button.dataset.moduleHistory).catch(error=>notice(error.message,true)));
  document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=async()=>{try{const r=await send('uninstall',{id:button.dataset.remove});if(!r?.ok)throw new Error(r?.error||'Remove failed');notice(`Removed ${button.dataset.remove}`);await load()}catch(error){notice(error.message,true)}});
  document.querySelectorAll('[data-command]').forEach(button=>button.onclick=async()=>{try{const id=button.dataset.command,module=modules.find(m=>m.id===id),command=module?.contributes?.commands?.find(item=>!item.mutates)?.id;if(!command)throw new Error('No non-mutating test command available');const r=await send('invoke',{id,command,payload:{source:'modules-ui'},company_id:companyId()||null});if(!r?.ok)throw new Error(r?.error||'Command failed');notice(`${id}:${command} → ${JSON.stringify(r.result)}`)}catch(error){notice(error.message,true)}});
}

function renderInstallHistory(history){
  const items=history||[];$('install-history-count').textContent=`${items.length} change${items.length===1?'':'s'}`;
  if(!items.length){$('install-history').innerHTML='<div class="empty">No transactional module changes recorded yet.</div>';return}
  $('install-history').innerHTML=items.slice(0,12).map(item=>`<article class="module-card"><div><div class="module-title"><strong>${esc(item.action||'change')}</strong><span class="pill">${esc(item.status||'committed')}</span></div><div class="meta"><span>${esc(item.moduleId||item.bundleId||'module system')}</span>${item.company_id?`<span>company: ${esc(item.company_id)}</span>`:''}<span>${esc(item.version||'')}</span><span>${esc(item.ts||'')}</span></div></div>${item.snapshotId?`<div class="module-actions"><button data-snapshot="${esc(item.snapshotId)}">Rollback transaction</button></div>`:item.reversible&&['company-enable','company-disable'].includes(item.action)?`<div class="module-actions"><button data-company-lifecycle="${esc(item.id)}">Rollback company activation</button></div>`:''}</article>`).join('');
  document.querySelectorAll('[data-snapshot]').forEach(button=>button.onclick=async()=>{try{const r=await send('rollbackInstall',{snapshotId:button.dataset.snapshot});if(!r?.ok)throw new Error(r?.error||'Transaction rollback failed');notice('Installation transaction rolled back');await load()}catch(error){notice(error.message,true)}});
  document.querySelectorAll('[data-company-lifecycle]').forEach(button=>button.onclick=async()=>{try{const r=await send('rollbackCompanyActivation',{eventId:button.dataset.companyLifecycle});if(!r?.ok)throw new Error(r?.error||'Company activation rollback failed');notice('Company module activation rolled back');await load()}catch(error){notice(error.message,true)}});
}


function renderCapabilityRegistry(response){
  const el=$('capability-registry-summary');if(!el)return;
  if(!response?.ok){el.innerHTML=`<div class="empty">Capability registry unavailable: ${esc(response?.error||'unknown error')}</div>`;return;}
  const registry=response.registry||{},totals=registry.totals||{},byKind=totals.by_kind||{};
  const metrics=[['Entries',totals.entries??0],['Modules',totals.modules??0],['Workers',byKind.worker??0],['Actions',byKind.action??0],['Workflows',byKind.workflow??0],['Services',byKind.service??0]];
  el.innerHTML=metrics.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')+`<div><span>Registry</span><strong>${esc(registry.version||'—')}</strong></div>`;
}

async function loadGrants(){const r=await send('listGrants',{include_inactive:true});if(!r?.ok)throw new Error(r?.error||'Authority grants unavailable');renderGrants(r.grants||[])}
async function load(){
  notice('');await hydrateCompany();const company_id=companyId();
  const moduleAction=company_id?'listForCompany':'list';const moduleArgs=company_id?{company_id}:{};
  const [response,bundleResponse,marketResponse,grantResponse,historyResponse,capabilityResponse]=await Promise.all([send(moduleAction,moduleArgs),send('listBundles'),loadMarketplaceWithFallback(),send('listGrants',{include_inactive:true}),send('installationHistory'),send('getCapabilityRegistry',{company_id:company_id||null})]);
  if(!response?.ok)throw new Error(response?.error||'Module host did not respond');if(!bundleResponse?.ok)throw new Error(bundleResponse?.error||'Bundle registry did not respond');if(!marketResponse?.ok)throw new Error(marketResponse?.error||'Marketplace did not respond');if(!grantResponse?.ok)throw new Error(grantResponse?.error||'Authority grants did not respond');if(!historyResponse?.ok)throw new Error(historyResponse?.error||'Install history did not respond');
  const modules=response.modules||[],bundles=bundleResponse.bundles||[];
  $('summary').innerHTML=[['Modules',modules.length],['Company enabled',modules.filter(m=>(m.companyEnabled??m.enabled)).length],['Blocked',modules.filter(m=>(m.companyStatus||m.status)==='blocked').length],['Bundles',bundles.length],['Workers',modules.reduce((n,m)=>n+count(m,'workers'),0)],['Verticals',modules.reduce((n,m)=>n+count(m,'verticals'),0)],['Grants',(grantResponse.grants||[]).filter(g=>g.active).length]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  renderMarketplace(marketResponse.catalog);renderGrants(grantResponse.grants||[]);renderBundles(bundles);renderModules(modules);renderInstallHistory(historyResponse.history||[]);renderCapabilityRegistry(capabilityResponse);
}

$('package-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const packageData=JSON.parse(await file.text());const r=await send('installPackage',{package:packageData});if(!r?.ok)throw new Error(r?.error||'Signed package install failed');notice(`Signed package verified and installed from ${r.package?.publisher_id||'trusted publisher'}`);await load()}catch(error){notice(`Signed package rejected: ${error.message}`,true)}finally{event.target.value=''}});
$('module-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const manifest=JSON.parse(await file.text());const pre=await send('validateInstall',{manifest});if(!pre?.ok)throw new Error(pre?.error||'Install validation failed');const r=await send('installManifest',{manifest});if(!r?.ok)throw new Error(r?.error||'Install failed');notice(`Installed local declarative module ${r.module.name} v${r.module.version}`);await load()}catch(error){notice(`Install failed: ${error.message}`,true)}finally{event.target.value=''}});
$('bundle-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const bundle=JSON.parse(await file.text());const pre=await send('validateBundleInstall',{bundle});if(!pre?.ok)throw new Error(pre?.error||'Bundle validation failed');const r=await send('installBundle',{bundle});if(!r?.ok)throw new Error(r?.error||'Bundle install failed');notice(`Installed local bundle ${r.bundle.name} with ${r.modules.length} modules`);await load()}catch(error){notice(`Bundle install failed: ${error.message}`,true)}finally{event.target.value=''}});
$('install-cleaning-workforce').onclick=async()=>{try{const r=await send('installMarketplace',{id:'titan.bundle.cleaning-workforce'});if(!r?.ok)throw new Error(r?.error||'Cleaning Workforce installation failed');notice('Verified and installed signed Cleaning Workforce bundle');await load()}catch(error){notice(error.message,true)}};
$('reload-company').onclick=()=>load().catch(error=>notice(error.message,true));
$('grant-company').addEventListener('change',()=>load().catch(error=>notice(error.message,true)));
$('reload-grants').onclick=()=>loadGrants().catch(error=>notice(error.message,true));
$('refresh').onclick=()=>load().catch(error=>notice(error.message,true));
$('download-template').onclick=async()=>{try{const response=await fetch(chrome.runtime.getURL('titan-modules/templates/declarative-module.json'));const text=await response.text();const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='titan-zero-capability-module-template.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){notice(error.message,true)}};
window.addEventListener('error',event=>notice(event.message,true));
load().catch(error=>notice(error.message,true));
