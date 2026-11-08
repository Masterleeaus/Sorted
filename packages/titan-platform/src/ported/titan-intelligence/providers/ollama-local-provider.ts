// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/providers/ollama-local-provider.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const DEFAULT_ENDPOINT='http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS=1800;
const STATUS_KEY='titan-omni-ollama-status-v1';
const SETTINGS_KEY='titan-omni-ollama-settings-v1';
const ALARM_NAME='titan-omni-ollama-health';

function cleanEndpoint(value){
  const raw=String(value||DEFAULT_ENDPOINT).trim().replace(/\/+$/,'');
  let url;
  try{url=new URL(raw);}catch{return DEFAULT_ENDPOINT;}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]','::1'].includes(host))return DEFAULT_ENDPOINT;
  return `${url.protocol}//${url.host}`;
}
function safeModels(value){
  return (Array.isArray(value)?value:[]).map(item=>({
    name:String(item?.name||item?.model||'').trim(),
    model:String(item?.model||item?.name||'').trim(),
    size:Number(item?.size)||0,
    modifiedAt:String(item?.modified_at||item?.modifiedAt||''),
    digest:String(item?.digest||'').slice(0,160)
  })).filter(item=>item.name).slice(0,200);
}
function preferredModel(models,requested=''){
  const names=models.map(model=>model.name);
  if(requested&&names.includes(requested))return requested;
  return names.find(name=>/qwen.*coder|coder.*qwen/i.test(name))||names.find(name=>/coder|code/i.test(name))||names[0]||'';
}
async function fetchJson(fetchImpl,url,timeoutMs){
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{
    const response=await fetchImpl(url,{method:'GET',cache:'no-store',signal:controller?.signal});
    if(!response?.ok)throw new Error(`http-${response?.status||'error'}`);
    return await response.json();
  }finally{if(timer)clearTimeout(timer);}
}
export async function chatOllama(options={}){
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const endpoint=cleanEndpoint(options.endpoint);
  const timeoutMs=Math.max(250,Math.min(120000,Number(options.timeoutMs)||30000));
  const model=String(options.model||'').trim().slice(0,240);
  const messages=(Array.isArray(options.messages)?options.messages:[]).slice(-32).map(item=>({role:['system','user','assistant'].includes(item?.role)?item.role:'user',content:String(item?.content||'').slice(0,12000)})).filter(item=>item.content);
  if(typeof fetchImpl!=='function')throw new Error('fetch-unavailable');
  if(!model)throw new Error('ollama-model-required');
  if(!messages.length)throw new Error('ollama-messages-required');
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{
    const response=await fetchImpl(`${endpoint}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages,stream:false}),signal:controller?.signal});
    if(!response?.ok)throw new Error(`http-${response?.status||'error'}`);
    const data=await response.json();
    return {provider:'ollama',model,content:String(data?.message?.content||''),done:data?.done===true,promptEvalCount:Number(data?.prompt_eval_count)||0,evalCount:Number(data?.eval_count)||0,local:true,authorityGranted:false,executionPermitted:false,projectionOnly:true};
  }catch(error){
    if(error?.name==='AbortError')throw new Error('ollama-chat-timeout');
    throw error;
  }finally{if(timer)clearTimeout(timer);}
}

export async function detectOllama(options={}){
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const endpoint=cleanEndpoint(options.endpoint);
  const timeoutMs=Math.max(250,Math.min(15000,Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS));
  const checkedAt=new Date().toISOString();
  const base={provider:'ollama',displayName:'Ollama',endpoint,local:true,checkedAt,authorityGranted:false,executionPermitted:false,projectionOnly:true};
  if(typeof fetchImpl!=='function')return {...base,state:'UNAVAILABLE',version:'',models:[],selectedModel:'',reason:'fetch-unavailable'};
  try{
    const [versionData,tagsData]=await Promise.all([
      fetchJson(fetchImpl,`${endpoint}/api/version`,timeoutMs),
      fetchJson(fetchImpl,`${endpoint}/api/tags`,timeoutMs)
    ]);
    const models=safeModels(tagsData?.models);
    const selectedModel=preferredModel(models,String(options.selectedModel||''));
    return {...base,state:'CONNECTED',version:String(versionData?.version||''),models,selectedModel,modelCount:models.length,reason:''};
  }catch(error){
    return {...base,state:'UNAVAILABLE',version:'',models:[],selectedModel:'',modelCount:0,reason:String(error?.name==='AbortError'?'timeout':error?.message||'connection-failed').slice(0,180)};
  }
}

async function storageGet(key){
  if(!globalThis.chrome?.storage?.local)return {};
  return await chrome.storage.local.get(key);
}
async function storageSet(value){
  if(!globalThis.chrome?.storage?.local)return;
  await chrome.storage.local.set(value);
}
export async function refreshOllamaStatus(){
  const saved=await storageGet(SETTINGS_KEY);
  const settings=saved?.[SETTINGS_KEY]||{};
  const status=await detectOllama({endpoint:settings.endpoint,selectedModel:settings.selectedModel,timeoutMs:settings.timeoutMs});
  await storageSet({[STATUS_KEY]:status});
  return status;
}
export async function readOllamaStatus(){
  const saved=await storageGet(STATUS_KEY);
  return saved?.[STATUS_KEY]||refreshOllamaStatus();
}
export async function selectOllamaModel(model){
  const current=await refreshOllamaStatus();
  const name=String(model||'').trim();
  if(current.state!=='CONNECTED'||!current.models.some(item=>item.name===name))throw new Error('ollama-model-not-installed');
  const saved=await storageGet(SETTINGS_KEY);
  const settings={...(saved?.[SETTINGS_KEY]||{}),selectedModel:name};
  await storageSet({[SETTINGS_KEY]:settings,[STATUS_KEY]:{...current,selectedModel:name,checkedAt:new Date().toISOString()}});
  return {...current,selectedModel:name};
}

if(globalThis.chrome?.runtime?.onMessage){
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(!message||!['TITAN_OLLAMA_STATUS','TITAN_OLLAMA_REFRESH','TITAN_OLLAMA_SELECT_MODEL','TITAN_OLLAMA_CHAT'].includes(message.type))return;
    const task=message.type==='TITAN_OLLAMA_STATUS'?readOllamaStatus():message.type==='TITAN_OLLAMA_REFRESH'?refreshOllamaStatus():message.type==='TITAN_OLLAMA_SELECT_MODEL'?selectOllamaModel(message.model):(async()=>{const status=await readOllamaStatus();if(status.state!=='CONNECTED')throw new Error('ollama-unavailable');return chatOllama({endpoint:status.endpoint,model:message.model||status.selectedModel,messages:message.messages,timeoutMs:message.timeoutMs});})();
    Promise.resolve(task).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:String(error?.message||error)}));
    return true;
  });
}
if(globalThis.chrome?.runtime?.onStartup)chrome.runtime.onStartup.addListener(()=>{refreshOllamaStatus().catch(()=>{});});
if(globalThis.chrome?.runtime?.onInstalled)chrome.runtime.onInstalled.addListener(()=>{refreshOllamaStatus().catch(()=>{});});
if(globalThis.chrome?.alarms){
  chrome.alarms.create(ALARM_NAME,{periodInMinutes:2});
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm?.name===ALARM_NAME)refreshOllamaStatus().catch(()=>{});});
}
if(globalThis.chrome?.storage?.local)refreshOllamaStatus().catch(()=>{});

export const OLLAMA_LOCAL_PROVIDER=Object.freeze({DEFAULT_ENDPOINT,STATUS_KEY,SETTINGS_KEY,ALARM_NAME});
