// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-observability/background.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { database, ready as businessDatabaseReady } from '../titan-local/storage/bootstrap.js';
import { createObservabilityRuntime } from './runtime.js';
import { createRuntimeHealthRegistry } from './health-registry.js';

const PROFILE_KEY='titanBusinessProfile';
const LEGACY_DIAGNOSTIC_LOG='titanDiagnosticLog';
const activeCompanyId=async()=>{try{const data=await chrome.storage.local.get([PROFILE_KEY]);return String(data?.[PROFILE_KEY]?.company_id||'').trim()||null}catch(_){return null}};
const unavailable=name=>({ok:false,status:'unavailable',component:name});

const observability=createObservabilityRuntime({database,companyIdProvider:activeCompanyId});
const runtimeHealth=createRuntimeHealthRegistry({defaultTimeoutMs:1500});

const businessDatabaseCollector=async()=>{await businessDatabaseReady;return {...await database.health(),persistenceAuthority:'TitanBusinessDatabase'};};
const nativeRuntimeCollector=async()=>globalThis.__TITAN_NATIVE_RUNTIME_BACKGROUND__?.snapshot?.()||unavailable('native-runtime');
const workforceRuntimeCollector=async()=>globalThis.__TITAN_WORKFORCE_BACKGROUND_RUNTIME__?.snapshot?.()||unavailable('workforce-runtime');
const compatibilityBoundaryCollector=async()=>globalThis.__TITAN_COMPATIBILITY_BACKGROUND__?.snapshot?.()||unavailable('compatibility-boundary');
const diagnosticLogCollector=async()=>{
  const data=await chrome.storage.local.get([LEGACY_DIAGNOSTIC_LOG]);
  const log=Array.isArray(data?.[LEGACY_DIAGNOSTIC_LOG])?data[LEGACY_DIAGNOSTIC_LOG]:[];
  const sources={};for(const item of log){const source=String(item?.source||'unknown');sources[source]=(sources[source]||0)+1;}
  return {ok:true,entries:log.length,errors:log.filter(x=>x?.level==='error').length,warnings:log.filter(x=>x?.level==='warn').length,sources};
};

observability.registerCollector('business-database',businessDatabaseCollector);
observability.registerCollector('native-runtime',nativeRuntimeCollector);
observability.registerCollector('workforce-runtime',workforceRuntimeCollector);
observability.registerCollector('compatibility-boundary',compatibilityBoundaryCollector);
observability.registerCollector('diagnostic-log',diagnosticLogCollector);

runtimeHealth.registerProbe({id:'business-database',component:'storage',source:'TitanBusinessDatabase',criticality:'critical',tags:['business-data','indexeddb'],probe:businessDatabaseCollector});
runtimeHealth.registerProbe({id:'native-runtime',component:'runtime',source:'TitanZeroRuntime',criticality:'critical',tags:['background','mv3'],probe:nativeRuntimeCollector});
runtimeHealth.registerProbe({id:'workforce-runtime',component:'workforce',source:'TitanWorkforceRuntime',criticality:'standard',tags:['workforce'],probe:workforceRuntimeCollector});
runtimeHealth.registerProbe({id:'compatibility-boundary',component:'compatibility',source:'TitanCompatibilityBoundary',criticality:'standard',tags:['compatibility'],probe:compatibilityBoundaryCollector});
runtimeHealth.registerProbe({id:'diagnostic-log',component:'diagnostics',source:'titanDiagnosticLog',criticality:'info',tags:['legacy-compatibility'],probe:diagnosticLogCollector});
observability.registerCollector('runtime-health',async()=>runtimeHealth.snapshot({company_id:await activeCompanyId()}));

globalThis.__TITAN_OBSERVABILITY__=observability;
globalThis.__TITAN_RUNTIME_HEALTH_REGISTRY__=runtimeHealth;
globalThis.titanObserve=(event)=>observability.record(event);

try{
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(message?.type!=='TITAN_OBSERVABILITY')return;
    (async()=>{
      switch(message.action){
        case 'ping': return {ok:true,protocol:observability.protocol,authority_effect:false};
        case 'snapshot': return {ok:true,observability:await observability.snapshot()};
        case 'record': return {ok:true,event:await observability.record(message.event||message.payload||{})};
        case 'recent': return {ok:true,recent:await observability.recent(message.query||{})};
        case 'runtimeHealth': return {ok:true,runtimeHealth:await runtimeHealth.snapshot({company_id:await activeCompanyId()}),authority_effect:false};
        default: throw new Error(`Unknown TITAN_OBSERVABILITY action: ${message.action}`);
      }
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:String(error?.message||error)}));
    return true;
  });
}catch(_){}

export { observability, runtimeHealth };
