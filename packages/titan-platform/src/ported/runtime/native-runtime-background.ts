// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): runtime/native-runtime-background.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { database, ready as businessDatabaseReady } from '../titan-local/storage/bootstrap.js';
import {
  TITAN_RUNTIME_PROTOCOL,
  TITAN_RUNTIME_ADAPTER_VERSION,
  LEGACY_TO_NATIVE_RUNTIME,
  mirrorLegacyRuntimeMessage,
  normalizeRuntimeEnvelope,
} from './native-runtime-contracts.js';
import { createRestartCheckpointStore, isTerminalRuntimeType } from '../titan-offline/restart-checkpoint.js';
import { createServiceWorkerLifecycle } from '../titan-offline/service-worker-lifecycle.js';
import { createBoundedWorkQueue } from '../titan-reliability/bounded-work-queue.js';

const PROFILE_KEY='titanBusinessProfile';
const listeners=new Map();
let eventCount=0;
let lastEvent=null;
const runtimeEventQueue=createBoundedWorkQueue({name:'native-runtime-events',concurrency:1,maxPending:256});
const restartCheckpointStore=createRestartCheckpointStore({database});
const serviceWorkerLifecycle=createServiceWorkerLifecycle({checkpointStore:restartCheckpointStore});
let restartLifecycle=Object.freeze({status:'not-run',company_id:null,automatic_effect_replay:false});
let restartRecovery=Object.freeze({status:'not-run',company_id:null,recovered:[],automatic_effect_replay:false});

const uid=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2,10)}`}`;

async function readCompanyId(){
  try{
    const data=await chrome.storage.local.get([PROFILE_KEY]);
    return String(data?.[PROFILE_KEY]?.company_id||'').trim()||null;
  }catch(_){return null;}
}

function notify(envelope){
  for(const key of [envelope.type,'*']){
    const set=listeners.get(key); if(!set)continue;
    for(const fn of [...set]){try{fn(envelope)}catch(_){}}
  }
}

async function persistEnvelope(envelope){
  await businessDatabaseReady;
  const eventId=envelope.event_id||uid('runtime-event');
  const context={
    company_id:envelope.company_id,
    actor_id:envelope.actor_id||'titan-native-runtime',
    operation_id:envelope.operation_id||eventId,
    idempotency_key:envelope.idempotency_key||null,
  };
  return database.putRecord(context,{
    module_id:'titan.runtime',
    collection:'events',
    record_id:eventId,
    data:{...envelope,event_id:eventId,grants_authority:false,direct_mutation:false,authority_effect:false},
    provenance:{source:envelope.source,compatibility:envelope.compatibility,legacy_type:envelope.legacy_type||null,company_id:envelope.company_id},
  });
}

async function checkpointEnvelope(envelope){
  if(!envelope.operation_id)return null;
  return restartCheckpointStore.checkpoint({company_id:envelope.company_id,actor_id:envelope.actor_id||'titan-native-runtime',operation_id:envelope.operation_id},{
    operation_id:envelope.operation_id,correlation_id:envelope.correlation_id,idempotency_key:envelope.idempotency_key,type:envelope.type,terminal:isTerminalRuntimeType(envelope.type),
  });
}

async function acceptEnvelope(input,{source='titan-runtime'}={}){
  const activeCompanyId=await readCompanyId();
  const envelope=normalizeRuntimeEnvelope({...input,source:input?.source||source},{company_id:activeCompanyId||input?.company_id});
  return runtimeEventQueue.run(async()=>{
    await businessDatabaseReady;
    await checkpointEnvelope(envelope);
    await persistEnvelope(envelope);
    eventCount+=1; lastEvent=envelope; notify(envelope);
    return envelope;
  });
}

async function recoverAfterWorkerStart(){
  await businessDatabaseReady;
  const company_id=await readCompanyId();
  if(!company_id){restartRecovery=Object.freeze({status:'no-company',company_id:null,recovered:[],automatic_effect_replay:false});return restartRecovery;}
  restartLifecycle=await serviceWorkerLifecycle.afterStart({company_id,actor_id:'titan-service-worker-recovery',operation_id:'service-worker-restart'});
  const recovered=restartLifecycle.recovered||[];
  restartRecovery=Object.freeze({status:'complete',company_id,recovered:Object.freeze(recovered),automatic_effect_replay:false,requires_explicit_resume:recovered.length>0,worker_lifecycle:restartLifecycle.status});
  return restartRecovery;
}

async function acknowledgeRestartResume(input={}){
  const company_id=await readCompanyId()||String(input.company_id||'').trim();
  if(!company_id)throw new Error('company_id-required');
  return restartCheckpointStore.acknowledgeResume({company_id,actor_id:String(input.actor_id||'titan-service-worker-recovery'),operation_id:String(input.operation_id||'restart-resume')},{operation_id:input.operation_id,idempotency_key:input.idempotency_key});
}

async function mirrorCompatibilityMessage(message,source='chrome.runtime.onMessage'){
  const activeCompanyId=await readCompanyId();
  const envelope=mirrorLegacyRuntimeMessage(message,{company_id:activeCompanyId||message?.company_id,source});
  if(!envelope)return null;
  return acceptEnvelope(envelope,{source});
}

function on(type,fn){
  if(typeof fn!=='function')return()=>{};
  const key=String(type||'*'); let set=listeners.get(key);
  if(!set)listeners.set(key,set=new Set()); set.add(fn); return()=>set.delete(fn);
}

const snapshot=()=>Object.freeze({
  protocol:TITAN_RUNTIME_PROTOCOL,
  adapterVersion:TITAN_RUNTIME_ADAPTER_VERSION,
  companyBoundary:'company_id',
  compatibilityMode:true,
  backgroundAuthoritative:true,
  persistenceAuthority:'TitanBusinessDatabase',
  mappedLegacyContracts:Object.keys(LEGACY_TO_NATIVE_RUNTIME).length,
  eventCount,
  lastEvent,
  restartRecovery,
  restartLifecycle,
  backpressure:runtimeEventQueue.snapshot(),
  grants_authority:false,
  authority_effect:false,
});

const runtime=Object.freeze({
  protocol:TITAN_RUNTIME_PROTOCOL,
  adapterVersion:TITAN_RUNTIME_ADAPTER_VERSION,
  emit:acceptEnvelope,
  on,
  snapshot,
  mirrorCompatibilityMessage,
  companyId:readCompanyId,
  restartRecovery:()=>restartRecovery,
  restartLifecycle:()=>restartLifecycle,
  acknowledgeRestartResume,
  authority_effect:false,
});

globalThis.TitanZeroRuntime=runtime;
globalThis.__TITAN_NATIVE_RUNTIME_BACKGROUND__=runtime;

try{
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(message?.type==='TITAN_NATIVE_RUNTIME'&&message?.action==='snapshot'){
      sendResponse({ok:true,nativeRuntime:snapshot()}); return true;
    }
    if(message?.type==='TITAN_NATIVE_RUNTIME'&&message?.action==='restartRecovery'){
      sendResponse({ok:true,restartRecovery}); return true;
    }
    if(message?.type==='TITAN_NATIVE_RUNTIME'&&message?.action==='acknowledgeRestartResume'){
      acknowledgeRestartResume(message).then(result=>sendResponse({ok:true,result})).catch(error=>sendResponse({ok:false,error:error.message}));
      return true;
    }
    if(message?.type==='TITAN_NATIVE_RUNTIME_TELEMETRY'){
      acceptEnvelope(message.envelope||message,{source:'extension-context'})
        .then(envelope=>sendResponse({ok:true,envelope}))
        .catch(error=>sendResponse({ok:false,error:error.message}));
      return true;
    }
    if(message&&typeof message==='object'&&LEGACY_TO_NATIVE_RUNTIME[String(message.type||message.event||message.action||message.name||'')]){
      void mirrorCompatibilityMessage(message);
    }
  });
}catch(_){}

try{
  chrome.runtime.onSuspend?.addListener(()=>{
    void readCompanyId().then(company_id=>{
      if(!company_id)return null;
      return serviceWorkerLifecycle.beforeSuspend({company_id,actor_id:'titan-service-worker-suspend',operation_id:'service-worker-suspend'},{reason:'chrome-runtime-onSuspend'});
    }).then(result=>{if(result)restartLifecycle=result;}).catch(()=>{});
  });
}catch(_){}

void recoverAfterWorkerStart().catch(error=>{restartRecovery=Object.freeze({status:'error',company_id:null,recovered:[],automatic_effect_replay:false,error:String(error?.message||error)});});
