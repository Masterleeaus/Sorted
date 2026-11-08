import type { IntelligenceCapability } from './index.js';
import type { DeviceHealthState, DeviceResourceSnapshot, DeviceRuntimeState, NetworkState, ThermalState } from './device-runtime.js';

export interface RuntimeResourceReport {
 schema:'titan-runtime-resource-report/v1'; company_id:string; node_id:string; observedAt:number; sequence:number;
 memory:{availableMb:number}; storage:{availableMb:number}; battery:{percent?:number;charging?:boolean}; thermal:ThermalState;
 network:{state:NetworkState;localNetworkReachable:boolean;internetReachable:boolean}; backgroundExecution:boolean; hardwareAcceleration:boolean;
 authorityGranted:false;
}
export interface EdgeIntelligenceCapabilityAdvertisement {
 schema:'titan-edge-intelligence-capability-advertisement/v1'; company_id:string; node_id:string; observedAt:number; sequence:number;
 health:DeviceHealthState; resourceReport:RuntimeResourceReport;
 intelligence:{modelId:string;capabilities:IntelligenceCapability[];locality:'device'|'customer_edge'|'local_bridge';available:boolean;reasons:string[]}[];
 canRunIntelligence:boolean; authorityGranted:false;
}
function finiteNonNegative(name:string,value:number){if(!Number.isFinite(value)||value<0)throw new Error(`resource-report-invalid-${name}`);return value;}
export function normalizeRuntimeResourceReport(input:{company_id:string;node_id:string;observedAt:number;sequence:number;resources:DeviceResourceSnapshot}):RuntimeResourceReport {
 if(!input.company_id||!input.node_id)throw new Error('resource-report-identity-required');
 if(!Number.isFinite(input.observedAt)||!Number.isInteger(input.sequence)||input.sequence<0)throw new Error('resource-report-clock-or-sequence-invalid');
 const r=input.resources,b=r.batteryPercent;
 if(b!==undefined&&(!Number.isFinite(b)||b<0||b>100))throw new Error('resource-report-invalid-battery-percent');
 return {schema:'titan-runtime-resource-report/v1',company_id:input.company_id,node_id:input.node_id,observedAt:input.observedAt,sequence:input.sequence,
  memory:{availableMb:finiteNonNegative('memory',r.memoryAvailableMb)},storage:{availableMb:finiteNonNegative('storage',r.storageAvailableMb)},
  battery:{percent:b,charging:r.charging},thermal:r.thermal,network:{state:r.network,localNetworkReachable:r.network==='lan'||r.network==='internet',internetReachable:r.network==='internet'},
  backgroundExecution:r.backgroundExecution,hardwareAcceleration:r.hardwareAcceleration===true,authorityGranted:false};
}
export function projectEdgeIntelligenceCapability(state:DeviceRuntimeState,resources:DeviceResourceSnapshot):EdgeIntelligenceCapabilityAdvertisement {
 const report=normalizeRuntimeResourceReport({company_id:state.company_id,node_id:state.node_id,observedAt:state.observedAt,sequence:state.sequence,resources});
 const intelligence=state.models.map(x=>({modelId:x.model.id,capabilities:[...x.model.capabilities].sort() as IntelligenceCapability[],locality:x.model.locality??'device',available:state.health!=='stale'&&state.health!=='offline'&&x.available,reasons:[...x.reasons]})).sort((a,b)=>a.modelId.localeCompare(b.modelId));
 return {schema:'titan-edge-intelligence-capability-advertisement/v1',company_id:state.company_id,node_id:state.node_id,observedAt:state.observedAt,sequence:state.sequence,health:state.health,resourceReport:report,intelligence,canRunIntelligence:intelligence.some(x=>x.available),authorityGranted:false};
}

export type ResourcePressureLevel = 'available'|'degraded'|'suspended';
export interface RuntimeResourcePressure {
 level: ResourcePressureLevel;
 reasons: string[];
 effectiveCapabilities: IntelligenceCapability[];
 authorityGranted:false;
}
/** Converts raw telemetry into stable execution pressure. It never authorises fallback or cloud spend. */
export function classifyRuntimeResourcePressure(ad:EdgeIntelligenceCapabilityAdvertisement):RuntimeResourcePressure {
 const r=ad.resourceReport, reasons:string[]=[];
 let level:ResourcePressureLevel='available';
 const degrade=(reason:string)=>{reasons.push(reason); if(level==='available')level='degraded';};
 const suspend=(reason:string)=>{reasons.push(reason); level='suspended';};
 if(ad.health==='offline'||ad.health==='stale') suspend(`device-${ad.health}`);
 if(r.thermal==='critical') suspend('thermal-critical'); else if(r.thermal==='hot'||r.thermal==='warm') degrade(`thermal-${r.thermal}`);
 if(r.battery.percent!==undefined&&!r.battery.charging){if(r.battery.percent<5)suspend('battery-critical');else if(r.battery.percent<15)degrade('battery-low');}
 if(r.memory.availableMb<256)suspend('memory-critical'); else if(r.memory.availableMb<1024)degrade('memory-low');
 if(r.storage.availableMb<128)suspend('storage-critical'); else if(r.storage.availableMb<512)degrade('storage-low');
 if(!r.backgroundExecution) degrade('background-unavailable');
 if(r.network.state==='offline') degrade('network-offline');
 const effectiveCapabilities=[...new Set(ad.intelligence.filter(x=>x.available).flatMap(x=>x.capabilities))].sort() as IntelligenceCapability[];
 if(!ad.canRunIntelligence||effectiveCapabilities.length===0)suspend('no-routable-intelligence');
 return {level,reasons:[...new Set(reasons)].sort(),effectiveCapabilities,authorityGranted:false};
}
/** Fingerprint only execution-relevant state so telemetry jitter does not churn Edge Fabric. */
export function effectiveCapabilityFingerprint(ad:EdgeIntelligenceCapabilityAdvertisement):string {
 const pressure=classifyRuntimeResourcePressure(ad);
 return JSON.stringify({health:ad.health,pressure,models:ad.intelligence.map(x=>({id:x.modelId,available:x.available,capabilities:x.capabilities,locality:x.locality,reasons:x.reasons})),authorityGranted:false});
}
