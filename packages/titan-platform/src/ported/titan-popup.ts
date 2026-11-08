// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-popup.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const openTitanTabFallback = async (view='chat', target=null) => {
  const query = new URLSearchParams({view:String(view||'chat'), fullscreen:'1'});
  if (target) query.set('target', String(target));
  const base = chrome.runtime.getURL('sidePanel.html');
  await chrome.tabs.create({url:`${base}?${query.toString()}`});
  window.close();
};

const openSidePanel = async (view) => {
  try {
    await chrome.storage.local.set({titanZeroView:view});
    const win = await chrome.windows.getCurrent();
    if (!chrome.sidePanel?.open) throw new Error('Chrome sidePanel API unavailable');
    await chrome.sidePanel.open({windowId:win.id});
    window.close();
  } catch (e) {
    document.body.dataset.error = '1';
    try { await openTitanTabFallback(view); } catch (_) {}
  }
};

const openAiTarget = async (target='Chat') => {
  try {
    await chrome.storage.local.set({titanZeroView:'ai', titanAiWorkspaceTarget:String(target||'Chat')});
    const win = await chrome.windows.getCurrent();
    if (!chrome.sidePanel?.open) throw new Error('Chrome sidePanel API unavailable');
    await chrome.sidePanel.open({windowId:win.id});
    window.close();
  } catch (e) {
    document.body.dataset.error = '1';
    try { await openTitanTabFallback('ai', target); } catch (_) {}
  }
};
document.querySelectorAll('[data-ai-target]').forEach(btn => btn.addEventListener('click', () => openAiTarget(btn.dataset.aiTarget)));

document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => openSidePanel(btn.dataset.view)));
document.querySelector('[data-diagnostics]')?.addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('diagnostics.html')}));

document.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL(btn.dataset.page)})));

document.querySelector('[data-options]')?.addEventListener('click',()=>chrome.runtime.openOptionsPage());
