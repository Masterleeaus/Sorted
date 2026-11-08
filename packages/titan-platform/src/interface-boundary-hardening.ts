import type { DeviceNode, LocalWorkspaceEvent, SyncEnvelope } from "./interface-local-state.js";

type R=Readonly<Record<string,unknown>>;
const FORBIDDEN_KEYS=new Set(["tenant_id","tenant_company_id","execution_authority","direct_effect","interface_executed","business_write","business_writes"]);
export type BoundaryInspection=Readonly<{company_id:string;safe:true;authority:"presentation-and-intent-only";business_writes:false}>;

function inspect(value:unknown,path="$",seen=new Set<object>()):void{
 if(value===null||typeof value!=="object")return;
 if(seen.has(value as object))return;seen.add(value as object);
 if(Array.isArray(value)){value.forEach((v,i)=>inspect(v,`${path}[${i}]`,seen));return;}
 for(const [key,v] of Object.entries(value as R)){
  if(FORBIDDEN_KEYS.has(key)){
   if(key==="business_writes"&&v===false)continue;
   throw new Error(`forbidden interface authority field ${path}.${key}`);
  }
  inspect(v,`${path}.${key}`,seen);
 }
}
export function assertInterfacePayloadBoundary(company_id:string,payload:unknown):BoundaryInspection{
 if(!company_id.trim())throw new Error("company_id-required");inspect(payload);
 const p=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload as R:null;
 if(p&&"company_id" in p&&String(p.company_id)!==company_id)throw new Error("cross-company interface payload rejected");
 return Object.freeze({company_id,safe:true,authority:"presentation-and-intent-only",business_writes:false});
}
export function assertDeviceIntentBoundary(node:DeviceNode,event:LocalWorkspaceEvent){
 if(event.company_id!==node.company_id)throw new Error("cross-company device event rejected");
 if(event.device_id!==node.device_id)throw new Error("device event identity mismatch");
 if(event.kind==="intent"&&!node.trusted)throw new Error("untrusted device cannot originate governed intent");
 assertInterfacePayloadBoundary(node.company_id,event.payload);return true;
}
export function assertSyncBoundary(node:DeviceNode,envelope:SyncEnvelope){
 if(envelope.company_id!==node.company_id)throw new Error("cross-company sync envelope rejected");
 if(envelope.business_writes!==false)throw new Error("interface sync cannot carry business writes");
 for(const event of envelope.events)assertDeviceIntentBoundary({...node,device_id:event.device_id},event);
 return true;
}
