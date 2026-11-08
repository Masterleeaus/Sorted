// @ts-nocheck
// Forward-ported into Titan Business Ops native platform from five-tier workforce runtime.
import bindings from './communication-provider-bindings.json' with { type: 'json' };
import { prepareCommunicationExecution, resolveCommunicationProvider } from './communication-provider-binding-runtime.js';
import { resolveDelegationChain } from './delegation-routing-runtime.js';

const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const voiceWorkers=new Map((bindings.worker_bindings||[]).filter(x=>x.provider_operation?.startsWith('voice.')).map(x=>[x.worker_id,x]));

export function resolveVoiceWorker(input={}){
  const worker_id=clean(input.worker_id,180); const binding=voiceWorkers.get(worker_id);
  if(!binding) throw new Error('voice-worker-not-found');
  const provider=resolveCommunicationProvider({...input,worker_id,channel:'phone'});
  if(provider.available!==true) return {...provider,provider_operation:binding.provider_operation};
  const supported=Array.isArray(provider.provider_engines)&&provider.provider_engines.length>0;
  return {...provider,provider_operation:binding.provider_operation,atomic:true,can_delegate:false,voice_provider_supported:supported,execution_permitted:false};
}

export function prepareVoiceWorkerExecution(input={}){
  const worker_id=clean(input.worker_id,180); const binding=voiceWorkers.get(worker_id);
  if(!binding) throw new Error('voice-worker-not-found');
  const operation=clean(input.operation||binding.provider_operation,120);
  if(operation!==binding.provider_operation) throw new Error(`voice-worker-operation-mismatch:${binding.provider_operation}`);
  const prepared=prepareCommunicationExecution({...input,worker_id,channel:'phone',operation});
  if(prepared.available!==true) return {...prepared,provider_operation:binding.provider_operation};
  const call_ref=clean(input.call_ref,220); const destination_ref=clean(input.destination_ref,240);
  const extra=[];
  if(['voice.call.prepare','voice.call.place','voice.call.transfer'].includes(operation)&&!destination_ref) extra.push('DESTINATION_REQUIRED');
  if(operation!=='voice.call.prepare'&&!call_ref) extra.push('CALL_REFERENCE_REQUIRED');
  const proposal={...prepared.proposal,provider_operation:operation,call_ref:call_ref||null,destination_ref:destination_ref||null};
  proposal.blocked_reasons=[...(proposal.blocked_reasons||[]),...extra];
  proposal.state=proposal.blocked_reasons.length?'BLOCKED':'READY_FOR_AUTHORITY_GATE';
  return {...prepared,provider_operation:operation,proposal,execution_permitted:false};
}

export function resolveVoiceDelegation(input={}){
  const worker_id=clean(input.worker_id,180); if(!voiceWorkers.has(worker_id)) throw new Error('voice-worker-not-found');
  return resolveDelegationChain({...input,worker_id});
}
export function listVoiceWorkers(){return [...voiceWorkers.entries()].map(([worker_id,b])=>({worker_id,operation:b.provider_operation,channel:'phone'}));}
export default {resolveVoiceWorker,prepareVoiceWorkerExecution,resolveVoiceDelegation,listVoiceWorkers};
