import config from './communication-provider-bindings.json' with { type: 'json' };
import contributions from '../../packages/titan-platform/src/ported/titan-capabilities/native-contributions.json' with { type: 'json' };
import { prepareAtomicWorkerExecution } from './atomic-worker-tool-binding-runtime.mjs';

const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const providersByChannel=new Map(config.providers.map(p=>[p.channel,p]));
const workerBindings=new Map(config.worker_bindings.map(b=>[b.worker_id,b]));
const capabilitiesById=new Map((contributions.entries||[]).map(e=>[e.id,e]));

function hostCapability(input,id){
  const list=Array.isArray(input.host_capabilities)?input.host_capabilities:[];
  return list.find(x=>clean(x?.id,160)===id && x?.verified===true && x?.activation_confers_authority===false) || null;
}
function capabilityFor(provider,input){
  return capabilitiesById.get(provider.capability_id) || (provider.host_binding_required===true ? hostCapability(input,provider.capability_id) : null);
}
function assertProviderInvariant(provider,capability){
  if(provider.company_boundary!=='company_id'||provider.binding_grants_authority!==false) throw new Error('communication-provider-binding-invariant');
  if(!capability) return false;
  if(capability.activation_confers_authority!==false) throw new Error(`communication-capability-authority-invariant:${provider.capability_id}`);
  return true;
}
function blockedResolution({company_id,worker_id,channel,reason,provider=null}){
  return {schema:'titan.workforce.communication-provider-resolution.v2',company_id,worker_id,channel,available:false,blocked:true,reason,
    provider_id:provider?.provider_id||null,capability_id:provider?.capability_id||null,identity_grants_authority:false,binding_grants_authority:false,execution_permitted:false};
}
export function resolveCommunicationProvider(input={}){
  const company_id=clean(input.company_id,128); if(!validCompany(company_id)) throw new Error('communication-provider-company_id-required');
  const worker_id=clean(input.worker_id,180); const worker=workerBindings.get(worker_id); if(!worker) throw new Error('communication-worker-binding-not-found');
  const requested=clean(input.channel||worker.default_channel,80).toLowerCase();
  if(!worker.allowed_channels.includes(requested)) throw new Error(`communication-channel-not-allowed:${requested}`);
  const provider=providersByChannel.get(requested); if(!provider) return blockedResolution({company_id,worker_id,channel:requested,reason:`communication-provider-not-found:${requested}`});
  const capability=capabilityFor(provider,input);
  if(!assertProviderInvariant(provider,capability)) return blockedResolution({company_id,worker_id,channel:requested,provider,reason:`verified-host-binding-required:${provider.capability_id}`});
  const health=(input.provider_health&&input.provider_health[provider.provider_id])||'healthy';
  if(health!=='healthy') return blockedResolution({company_id,worker_id,channel:requested,provider,reason:`provider-not-healthy:${health}`});
  return {schema:'titan.workforce.communication-provider-resolution.v2',company_id,worker_id,channel:requested,available:true,blocked:false,
    provider_id:provider.provider_id,provider_family:provider.provider_family,provider_engines:provider.provider_engines||[],capability_id:provider.capability_id,
    capability_title:capability.title||provider.capability_id,risk_class:provider.risk_class,contract_status:provider.contract_status||'NATIVE_REGISTERED',
    requires_approval:provider.requires_approval,requires_idempotency_key:provider.requires_idempotency_key,requires_execution_receipt:provider.requires_execution_receipt,
    company_boundary:'company_id',identity_grants_authority:false,binding_grants_authority:false,execution_permitted:false};
}
function consentAllows(input,channel){
  const c=input.channel_consent||{}; const v=c[channel];
  return v!==false && v!=='opted_out' && v!=='blocked';
}
export function resolvePreferredCommunicationProvider(input={}){
  const worker_id=clean(input.worker_id,180); const worker=workerBindings.get(worker_id); if(!worker) throw new Error('communication-worker-binding-not-found');
  const requested=Array.isArray(input.preferred_channels)&&input.preferred_channels.length?input.preferred_channels:[input.channel||worker.default_channel];
  const ordered=[...new Set(requested.map(x=>clean(x,80).toLowerCase()).filter(Boolean))];
  if(input.allow_fallback===true){ for(const c of worker.allowed_channels) if(!ordered.includes(c)) ordered.push(c); }
  const attempts=[];
  for(const channel of ordered){
    if(!worker.allowed_channels.includes(channel)){attempts.push({channel,available:false,reason:'CHANNEL_NOT_ALLOWED'});continue;}
    if(!consentAllows(input,channel)){attempts.push({channel,available:false,reason:'CHANNEL_CONSENT_BLOCKED'});continue;}
    const result=resolveCommunicationProvider({...input,channel}); attempts.push({channel,available:result.available,reason:result.reason||null,provider_id:result.provider_id||null});
    if(result.available) return {...result,selection:{schema:'titan.workforce.communication-channel-selection.v1',requested_channels:ordered,selected_channel:channel,fallback_used:channel!==ordered[0],attempts}};
    if(input.allow_fallback!==true) break;
  }
  return {schema:'titan.workforce.communication-channel-selection.v1',company_id:clean(input.company_id,128),worker_id,available:false,blocked:true,
    requested_channels:ordered,selected_channel:null,attempts,identity_grants_authority:false,binding_grants_authority:false,execution_permitted:false};
}
export function prepareCommunicationExecution(input={}){
  const provider=input.preferred_channels||input.allow_fallback===true ? resolvePreferredCommunicationProvider(input) : resolveCommunicationProvider(input);
  if(provider.available!==true) return {...provider,proposal:null};
  const workerExecution=prepareAtomicWorkerExecution(input);
  const blocked=[];
  if(provider.requires_approval && input.approval_granted!==true) blocked.push('APPROVAL_REQUIRED');
  const idempotency_key=clean(input.idempotency_key,220); if(provider.requires_idempotency_key&&!idempotency_key) blocked.push('IDEMPOTENCY_KEY_REQUIRED');
  const recipient_ref=clean(input.recipient_ref,240); if(!recipient_ref) blocked.push('RECIPIENT_REQUIRED');
  const content_ref=clean(input.content_ref,240); if(!content_ref) blocked.push('CONTENT_REQUIRED');
  return {...provider,worker_execution:workerExecution,proposal:{schema:'titan.workforce.communication-execution-proposal.v2',company_id:provider.company_id,worker_id:provider.worker_id,
    provider_id:provider.provider_id,capability_id:provider.capability_id,channel:provider.channel,recipient_ref:recipient_ref||null,content_ref:content_ref||null,
    idempotency_key:idempotency_key||null,state:blocked.length?'BLOCKED':'READY_FOR_AUTHORITY_GATE',blocked_reasons:blocked,requires_execution_receipt:true,direct_send:false,
    automatic_effect_replay:false,grants_authority:false},execution_permitted:false};
}
export function listCommunicationProviders(){return config.providers.map(x=>({...x}));}
export function listCommunicationWorkerBindings(){return config.worker_bindings.map(x=>({...x}));}
export default {resolveCommunicationProvider,resolvePreferredCommunicationProvider,prepareCommunicationExecution,listCommunicationProviders,listCommunicationWorkerBindings};
