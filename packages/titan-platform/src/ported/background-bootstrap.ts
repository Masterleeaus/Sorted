// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): background-bootstrap.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import './titan-modules/module-host.js';
import './titan-local/storage/bootstrap.js';
import './runtime/native-runtime-background.js';
import './runtime/workforce-runtime-background.js';
import './titan-runtime/page-context-rehydration.js';
const LOG_KEY='titanDiagnosticLog',MAX_LOG=1000;
const safe=v=>{try{return typeof v==='string'?v:JSON.stringify(v)}catch{return String(v)}};
async function diag(level,message,detail={}){try{const d=await chrome.storage.local.get([LOG_KEY]);const log=Array.isArray(d[LOG_KEY])?d[LOG_KEY]:[];log.push({ts:new Date().toISOString(),level,source:'background',message,detail});await chrome.storage.local.set({[LOG_KEY]:log.slice(-MAX_LOG)});void globalThis.__TITAN_OBSERVABILITY__?.record?.({event_type:'diagnostic.log',component:'background',severity:level,source:'background',correlation_id:detail?.correlation_id||null,operation_id:detail?.operation_id||null,payload:{message,detail},authority_effect:false}).catch(()=>{})}catch(_){}}
self.addEventListener('error',e=>diag('error',e.message||'Background error',{filename:e.filename,line:e.lineno,column:e.colno,stack:e.error?.stack}));
self.addEventListener('unhandledrejection',e=>diag('error','Unhandled promise rejection',{reason:safe(e.reason),stack:e.reason?.stack}));
import './compatibility/monica/background-runtime-boundary.js';
import './titan-observability/background.js';
diag('info','Titan Work background loaded');
chrome.runtime.onInstalled.addListener(()=>{chrome.sidePanel?.setPanelBehavior?.({openPanelOnActionClick:true}).catch(e=>diag('warn','Unable to set side panel behavior',{message:e.message}))});
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{if(msg?.type!=='TITAN_DIAGNOSTICS')return; if(msg.action==='ping'){sendResponse({ok:true,ts:Date.now(),version:chrome.runtime.getManifest().version});return true} if(msg.action==='snapshot'){(async()=>{const d=await chrome.storage.local.get(['titanOutcomeBridgeStatus','titanWorkFrameState','titanOutcomeHistory','titanRetrieverBridgeState','titanWorkforceRoster','titanPreferredWorker','titanServiceVertical']);sendResponse({ok:true,serviceWorker:'alive',version:chrome.runtime.getManifest().version,outcomeBridge:d.titanOutcomeBridgeStatus||'unknown',workFrame:d.titanWorkFrameState||'unknown',outcomeHistory:(d.titanOutcomeHistory||[]).length,retrieverProtocol:d.titanRetrieverBridgeState||'unknown',workforceWorkers:(d.titanWorkforceRoster||[]).length,preferredWorker:d.titanPreferredWorker||'auto',serviceVertical:d.titanServiceVertical||'unknown',nativeRuntime:globalThis.__TITAN_NATIVE_RUNTIME_BACKGROUND__?.snapshot?.()||null,workforceRuntime:globalThis.__TITAN_WORKFORCE_BACKGROUND_RUNTIME__?.snapshot?.()||null,compatibilityBoundary:globalThis.__TITAN_COMPATIBILITY_BACKGROUND__?.snapshot?.()||null})})().catch(e=>sendResponse({ok:false,error:e.message}));return true}});
// TZ-FINISH-004 Pass 4: Titan-owned launcher layer around retained Monica/Retriever runtimes.
const TITAN_CONTEXT_MENUS = [
  ['titan-zero-open-ai','Open Titan AI workspace','all'],
  ['titan-zero-open-retriever','Open Titan Work','all'],
  ['titan-zero-ask-selection','Ask Titan about selection','selection']
];
async function openTitanSurface(view='ai', target=null, sender=null) {
  const values={titanZeroView:view};
  if(target) values.titanAiWorkspaceTarget=target;
  await chrome.storage.local.set(values);
  const windowId=sender?.tab?.windowId;
  if(Number.isInteger(windowId) && chrome.sidePanel?.open){
    try { await chrome.sidePanel.open({windowId}); return {ok:true,mode:'side-panel'}; } catch (_) {}
  }
  const base=chrome.runtime.getURL('sidePanel.html');
  const query=new URLSearchParams({view:String(view||'ai'),fullscreen:'1'});
  if(target) query.set('target',String(target));
  await chrome.tabs.create({url:`${base}?${query.toString()}`});
  return {ok:true,mode:'tab'};
}
async function registerTitanContextMenus(){
  try {
    for(const [id] of TITAN_CONTEXT_MENUS) { try { await chrome.contextMenus.remove(id); } catch (_) {} }
    for(const [id,title,context] of TITAN_CONTEXT_MENUS) chrome.contextMenus.create({id,title,contexts:[context]});
  } catch(e){ await diag('warn','Unable to register Titan context menus',{message:e?.message||String(e)}); }
}
chrome.runtime.onInstalled.addListener(()=>registerTitanContextMenus());
chrome.runtime.onStartup?.addListener(()=>registerTitanContextMenus());
chrome.contextMenus?.onClicked?.addListener(async(info,tab)=>{
  try {
    if(info.menuItemId==='titan-zero-open-ai') return openTitanSurface('ai','Chat',{tab});
    if(info.menuItemId==='titan-zero-open-retriever') return openTitanSurface('agent',null,{tab});
    if(info.menuItemId==='titan-zero-ask-selection'){
      await chrome.storage.local.set({titanSharedContext:{kind:'selection',text:String(info.selectionText||'').slice(0,12000),url:tab?.url||'',title:tab?.title||'',capturedAt:Date.now()}});
      return openTitanSurface('chat',null,{tab});
    }
  } catch(e){ await diag('error','Titan context-menu launch failed',{message:e?.message||String(e),menuItemId:info?.menuItemId}); }
});
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.type!=='TITAN_LAUNCHER') return;
  (async()=>{
    const action=String(msg.action||'ai');
    if(action==='retriever') return openTitanSurface('agent',null,sender);
    if(action==='ai') return openTitanSurface('ai',String(msg.target||'Chat'),sender);
    if(action==='tools'){await chrome.tabs.create({url:chrome.runtime.getURL('monicaPopup.html')});return {ok:true,mode:'tab'};}
    if(action==='options'){await chrome.runtime.openOptionsPage();return {ok:true,mode:'options'};}
    return {ok:false,error:'unsupported-launcher-action'};
  })().then(sendResponse).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));
  return true;
});

// TZ-TOOLS-ABSORB-001 Pass 4: page/search tool bridge into the retained rich Titan workspace.
const TITAN_PAGE_TOOL_IDS = new Set(['search','webpage_assistant','full_page','text_selection','floating_assistant','screenshots']);
async function launchTitanPageTool(msg={}, sender=null) {
  const toolId=String(msg.tool_id||'');
  if(!TITAN_PAGE_TOOL_IDS.has(toolId)) return {ok:false,error:'unsupported-tool-id'};
  const pageUrl=String(msg.page_url||sender?.tab?.url||'').slice(0,12000);
  const pageTitle=String(msg.page_title||sender?.tab?.title||'').slice(0,1000);
  const selectionText=String(msg.selectionText||'').slice(0,12000);
  let sharedContext={
    kind:toolId==='text_selection'?'selection':'page',
    tool_id:toolId,
    text:selectionText,
    url:pageUrl,
    title:pageTitle,
    capturedAt:Date.now()
  };
  if(toolId==='screenshots'){
    const windowId=sender?.tab?.windowId;
    const dataUrl=await chrome.tabs.captureVisibleTab(Number.isInteger(windowId)?windowId:undefined,{format:'png'});
    sharedContext={...sharedContext,kind:'screenshot',image_data_url:dataUrl};
  }
  await chrome.storage.local.set({titanSharedContext:sharedContext});
  if(toolId==='search'){
    await chrome.storage.local.set({titanAiWorkspaceTarget:'Search',titanZeroView:'ai'});
    return openTitanSurface('ai','Search',sender);
  }
  return openTitanSurface('chat','Chat',sender);
}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.type!=='TITAN_TOOL_LAUNCH') return;
  launchTitanPageTool(msg,sender).then(sendResponse).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));
  return true;
});
chrome.commands?.onCommand?.addListener(async command => {
  try {
    if (command === 'run-monica-on-new-tab') { const url=chrome.runtime.getURL('sidePanel.html')+'?view=ai&fullscreen=1'; await chrome.tabs.create({url}); await diag('info','Titan AI command opened Titan AI workspace',{command}); return; }
    if (command === 'open-titan-retriever') { await openTitanSurface('agent'); await diag('info','Titan Work command opened Agent surface',{command}); }
  } catch (e) {
    await diag('error','Titan command launch failed',{command,message:e?.message||String(e)});
  }
});
