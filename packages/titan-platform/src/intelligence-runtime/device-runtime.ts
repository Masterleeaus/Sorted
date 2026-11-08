import type { IntelligenceCapability, IntelligenceLocality } from './index.js';

export type DeviceHealthState = 'healthy'|'degraded'|'stale'|'offline';
export type ThermalState = 'nominal'|'warm'|'hot'|'critical';
export type NetworkState = 'offline'|'lan'|'internet';
export interface DeviceModelCapability {
 id:string; company_id:string; capabilities:IntelligenceCapability[]; weightsAvailable:boolean; enabled:boolean;
 minMemoryMb?:number; minStorageMb?:number; requiresNetwork?:boolean; locality?:Extract<IntelligenceLocality,'device'|'customer_edge'|'local_bridge'>;
}
export interface DeviceResourceSnapshot { memoryAvailableMb:number; storageAvailableMb:number; batteryPercent?:number; charging?:boolean; thermal:ThermalState; network:NetworkState; backgroundExecution:boolean; hardwareAcceleration?:boolean; }
export interface DeviceRuntimeHeartbeat { schema:'titan-device-intelligence-heartbeat/v1'; company_id:string; node_id:string; observedAt:number; sequence:number; resources:DeviceResourceSnapshot; models:DeviceModelCapability[]; localBridgeReachable:boolean; }
export type AvailabilityReason='AVAILABLE'|'HEARTBEAT_STALE'|'DEVICE_OFFLINE'|'MODEL_DISABLED'|'MODEL_WEIGHTS_UNAVAILABLE'|'INSUFFICIENT_MEMORY'|'INSUFFICIENT_STORAGE'|'THERMAL_PRESSURE'|'BACKGROUND_EXECUTION_UNAVAILABLE'|'NETWORK_UNAVAILABLE'|'LOCAL_BRIDGE_UNREACHABLE';
export interface EffectiveDeviceModel { model:DeviceModelCapability; available:boolean; reasons:AvailabilityReason[]; authorityGranted:false; }
export interface DeviceRuntimeState { company_id:string; node_id:string; health:DeviceHealthState; observedAt:number; expiresAt:number; sequence:number; models:EffectiveDeviceModel[]; authorityGranted:false; }
export interface DeviceRuntimeCoordinatorOptions { staleAfterMs?:number; expireAfterMs?:number; minimumBatteryPercent?:number; }

export class DeviceRuntimeCoordinator {
 private states=new Map<string,DeviceRuntimeState>();
 private staleAfterMs:number; private expireAfterMs:number; private minimumBatteryPercent:number;
 constructor(opts:DeviceRuntimeCoordinatorOptions={}){this.staleAfterMs=opts.staleAfterMs??30_000;this.expireAfterMs=opts.expireAfterMs??120_000;this.minimumBatteryPercent=opts.minimumBatteryPercent??10;if(this.expireAfterMs<=this.staleAfterMs)throw new Error('device-runtime-expiry-must-exceed-stale-window');}
 private key(company_id:string,node_id:string){if(!company_id)throw new Error('company_id-required');if(!node_id)throw new Error('node_id-required');return `${company_id}:${node_id}`;}
 ingest(h:DeviceRuntimeHeartbeat,now=h.observedAt){if(h.company_id===''||h.node_id==='')throw new Error('device-runtime-identity-required');if(h.observedAt>now+60_000)throw new Error('device-runtime-heartbeat-from-future');const key=this.key(h.company_id,h.node_id),prev=this.states.get(key);if(prev&&h.sequence<=prev.sequence)throw new Error('device-runtime-heartbeat-replay-or-out-of-order');const models=h.models.map(model=>this.evaluateModel(h,model));const state:Object={company_id:h.company_id,node_id:h.node_id,health:this.health(h,now),observedAt:h.observedAt,expiresAt:h.observedAt+this.expireAfterMs,sequence:h.sequence,models,authorityGranted:false};this.states.set(key,state as DeviceRuntimeState);return state as DeviceRuntimeState;}
 private health(h:DeviceRuntimeHeartbeat,now:number):DeviceHealthState {const age=now-h.observedAt;if(age>=this.expireAfterMs||h.resources.network==='offline'&&!h.models.some(m=>(m.locality??'device')==='device'))return 'offline';if(age>=this.staleAfterMs)return 'stale';if(h.resources.thermal==='critical'||(h.resources.batteryPercent!==undefined&&!h.resources.charging&&h.resources.batteryPercent<this.minimumBatteryPercent))return 'degraded';return 'healthy';}
 private evaluateModel(h:DeviceRuntimeHeartbeat,m:DeviceModelCapability):EffectiveDeviceModel {if(m.company_id!==h.company_id)throw new Error('device-runtime-cross-company-model-denied');const reasons:AvailabilityReason[]=[];if(!m.enabled)reasons.push('MODEL_DISABLED');if(!m.weightsAvailable)reasons.push('MODEL_WEIGHTS_UNAVAILABLE');if((m.minMemoryMb??0)>h.resources.memoryAvailableMb)reasons.push('INSUFFICIENT_MEMORY');if((m.minStorageMb??0)>h.resources.storageAvailableMb)reasons.push('INSUFFICIENT_STORAGE');if(h.resources.thermal==='critical')reasons.push('THERMAL_PRESSURE');if(!h.resources.backgroundExecution)reasons.push('BACKGROUND_EXECUTION_UNAVAILABLE');if(m.requiresNetwork&&h.resources.network==='offline')reasons.push('NETWORK_UNAVAILABLE');if((m.locality??'device')==='local_bridge'&&!h.localBridgeReachable)reasons.push('LOCAL_BRIDGE_UNREACHABLE');return {model:{...m,capabilities:[...new Set(m.capabilities)].sort() as IntelligenceCapability[]},available:reasons.length===0,reasons:reasons.length?reasons:['AVAILABLE'],authorityGranted:false};}
 snapshot(company_id:string,node_id:string,now=Date.now()):DeviceRuntimeState|undefined {const state=this.states.get(this.key(company_id,node_id));if(!state)return undefined;const age=now-state.observedAt;if(age>=this.expireAfterMs)return {...state,health:'offline',models:state.models.map(m=>({...m,available:false,reasons:['DEVICE_OFFLINE'],authorityGranted:false})),authorityGranted:false};if(age>=this.staleAfterMs)return {...state,health:'stale',models:state.models.map(m=>({...m,available:false,reasons:['HEARTBEAT_STALE'],authorityGranted:false})),authorityGranted:false};return state;}
 routableModels(company_id:string,node_id:string,now=Date.now()){return (this.snapshot(company_id,node_id,now)?.models??[]).filter(m=>m.available);}
 revoke(company_id:string,node_id:string){return this.states.delete(this.key(company_id,node_id));}
}

import { IntelligenceModelRegistry, IntelligenceProviderRegistry } from './index.js';

export interface DeviceRegistrySyncResult {
 company_id:string; node_id:string; providerIds:string[]; modelIds:string[]; suspendedModelIds:string[]; authorityGranted:false;
}

export class DeviceIntelligenceRegistrySynchronizer {
 private advertised=new Map<string,Set<string>>();
 constructor(private providers:IntelligenceProviderRegistry,private models:IntelligenceModelRegistry){}
 private nodeKey(company_id:string,node_id:string){return `${company_id}:${node_id}`;}
 private providerId(node_id:string,locality:Extract<IntelligenceLocality,'device'|'customer_edge'|'local_bridge'>){return `device:${node_id}:${locality}`;}
 private modelId(node_id:string,modelId:string){return `device:${node_id}:model:${modelId}`;}
 sync(state:DeviceRuntimeState):DeviceRegistrySyncResult {
  if(!state.company_id||!state.node_id)throw new Error('device-registry-sync-identity-required');
  const localities=[...new Set(state.models.map(x=>x.model.locality??'device'))].sort() as Array<Extract<IntelligenceLocality,'device'|'customer_edge'|'local_bridge'>>;
  const providerIds:string[]=[];
  for(const locality of localities){
   const members=state.models.filter(x=>(x.model.locality??'device')===locality);
   const capabilities=[...new Set(members.flatMap(x=>x.model.capabilities))].sort() as IntelligenceCapability[];
   const enabled=state.health!=='stale'&&state.health!=='offline'&&members.some(x=>x.available);
   const id=this.providerId(state.node_id,locality); providerIds.push(id);
   this.providers.register({id,company_id:state.company_id,locality,capabilities,external:false,titanFunded:false,metered:false,enabled,revoked:false});
  }
  const key=this.nodeKey(state.company_id,state.node_id),previous=this.advertised.get(key)??new Set<string>(),current=new Set<string>(),modelIds:string[]=[],suspendedModelIds:string[]=[];
  for(const effective of state.models){
   if(effective.model.company_id!==state.company_id)throw new Error('device-registry-sync-cross-company-model-denied');
   const id=this.modelId(state.node_id,effective.model.id), locality=effective.model.locality??'device', providerId=this.providerId(state.node_id,locality);
   const enabled=state.health!=='stale'&&state.health!=='offline'&&effective.available;
   this.models.register({id,providerId,company_id:state.company_id,capabilities:effective.model.capabilities,enabled,revoked:false});
   current.add(id); modelIds.push(id); if(!enabled)suspendedModelIds.push(id);
  }
  for(const oldId of previous){if(current.has(oldId))continue;const old=this.models.get(state.company_id,oldId);if(old)this.models.register({...old,enabled:false,revoked:false});suspendedModelIds.push(oldId);}
  this.advertised.set(key,current);
  return {company_id:state.company_id,node_id:state.node_id,providerIds:providerIds.sort(),modelIds:modelIds.sort(),suspendedModelIds:[...new Set(suspendedModelIds)].sort(),authorityGranted:false};
 }
 revokeNode(company_id:string,node_id:string){
  const key=this.nodeKey(company_id,node_id),ids=this.advertised.get(key)??new Set<string>();
  for(const id of ids){const m=this.models.get(company_id,id);if(m&&!m.revoked)this.models.revoke(company_id,id);}
  for(const locality of ['device','customer_edge','local_bridge'] as const){const id=this.providerId(node_id,locality);const p=this.providers.get(company_id,id);if(p&&!p.revoked)this.providers.revoke(company_id,id);}
  this.advertised.delete(key);
 }
}
