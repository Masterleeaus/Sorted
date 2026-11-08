/**
 * Company-switch invariant:
 * A LocalWorkspaceStore is permanently bound to the company_id supplied at
 * construction. Do not reuse/retag a store when a user switches companies.
 * Freeze/close the old context and create/load a separately partitioned store;
 * queued consequential intents are handled by canonical execution/offline
 * queues, not by this presentation-only sync store.
 */
import { assertDeviceIntentBoundary, assertSyncBoundary } from "./interface-boundary-hardening.js";
type R=Readonly<Record<string,unknown>>;
export type DeviceNode=Readonly<{device_id:string;company_id:string;actor_id:string;kind:"phone"|"tablet"|"desktop"|"browser"|"edge";trusted:boolean}>;
export type LocalWorkspaceEvent=Readonly<{event_id:string;company_id:string;device_id:string;sequence:number;kind:"working-set"|"presentation"|"intent"|"receipt";payload:R;created_at:string}>;
export type PresentationReceipt=Readonly<{schema:"titan.presentation-receipt.v1";receipt_id:string;company_id:string;device_id:string;surface:string;presentation_schema:string;source_event_ids:readonly string[];authority:"presentation-only"}>;
const rec=(v:unknown):R=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as R:{};
export class LocalWorkspaceStore{
 readonly node:DeviceNode;#events:LocalWorkspaceEvent[]=[];#seen=new Set<string>();#sequence=0;
 constructor(node:DeviceNode){if(!node.company_id||!node.device_id||!node.actor_id)throw new Error("device node requires company_id, device_id and actor_id");this.node=Object.freeze({...node})}
 append(kind:LocalWorkspaceEvent["kind"],payload:R,eventId:string,createdAt=new Date().toISOString()){if(this.#seen.has(eventId))return this.snapshot();const e=Object.freeze({event_id:eventId,company_id:this.node.company_id,device_id:this.node.device_id,sequence:++this.#sequence,kind,payload:rec(payload),created_at:createdAt});assertDeviceIntentBoundary(this.node,e);this.#events.push(e);this.#seen.add(eventId);return this.snapshot()}
 import(events:readonly LocalWorkspaceEvent[]){for(const e of [...events].sort((a,b)=>a.sequence-b.sequence||a.event_id.localeCompare(b.event_id))){if(e.company_id!==this.node.company_id)throw new Error("cross-company local workspace event rejected");if(this.#seen.has(e.event_id))continue;assertDeviceIntentBoundary({...this.node,device_id:e.device_id},e);this.#events.push(Object.freeze({...e}));this.#seen.add(e.event_id);this.#sequence=Math.max(this.#sequence,e.sequence)}return this.snapshot()}
 snapshot(){return Object.freeze([...this.#events].sort((a,b)=>a.sequence-b.sequence||a.event_id.localeCompare(b.event_id)))}
 exportSince(sequence:number){return Object.freeze(this.snapshot().filter(x=>x.sequence>sequence))}
}
export function createPresentationReceipt(input:{receipt_id:string;company_id:string;device_id:string;surface:string;presentation_schema:string;source_event_ids?:readonly string[]}):PresentationReceipt{
 if(!input.company_id||!input.device_id||!input.receipt_id)throw new Error("presentation receipt requires company_id, device_id and receipt_id");
 return Object.freeze({schema:"titan.presentation-receipt.v1",receipt_id:input.receipt_id,company_id:input.company_id,device_id:input.device_id,surface:input.surface,presentation_schema:input.presentation_schema,source_event_ids:Object.freeze([...(input.source_event_ids??[])]),authority:"presentation-only"});
}
export type SyncEnvelope=Readonly<{schema:"titan.interface-sync-envelope.v1";company_id:string;from_device:string;to_device:string|null;events:readonly LocalWorkspaceEvent[];mode:"device-first";business_writes:false}>;
export function createSyncEnvelope(store:LocalWorkspaceStore,since=0,toDevice:string|null=null):SyncEnvelope{return Object.freeze({schema:"titan.interface-sync-envelope.v1",company_id:store.node.company_id,from_device:store.node.device_id,to_device:toDevice,events:store.exportSince(since),mode:"device-first",business_writes:false})}
export function applySyncEnvelope(store:LocalWorkspaceStore,envelope:SyncEnvelope){assertSyncBoundary(store.node,envelope);if(envelope.company_id!==store.node.company_id)throw new Error("cross-company sync envelope rejected");if(envelope.to_device&&envelope.to_device!==store.node.device_id)throw new Error("sync envelope addressed to another device");if(envelope.business_writes!==false)throw new Error("interface sync cannot carry business writes");return store.import(envelope.events)}
export type ConflictResolution=Readonly<{event_id:string;winner:"local"|"remote";reason:"higher-sequence"|"stable-device-tiebreak";event:LocalWorkspaceEvent}>;
export function resolvePresentationConflict(local:LocalWorkspaceEvent,remote:LocalWorkspaceEvent):ConflictResolution{
 if(local.company_id!==remote.company_id)throw new Error("cross-company conflict comparison rejected");if(local.event_id!==remote.event_id)throw new Error("conflict resolution requires matching event_id");
 if(local.sequence!==remote.sequence){const winner=local.sequence>remote.sequence?"local":"remote";return Object.freeze({event_id:local.event_id,winner,reason:"higher-sequence",event:winner==="local"?local:remote})}
 const winner=local.device_id.localeCompare(remote.device_id)<=0?"local":"remote";return Object.freeze({event_id:local.event_id,winner,reason:"stable-device-tiebreak",event:winner==="local"?local:remote});
}
export function replayPresentationState(events:readonly LocalWorkspaceEvent[]){const state:{working_set:R|null;presentation:R|null;receipts:R[]}={working_set:null,presentation:null,receipts:[]};for(const e of [...events].sort((a,b)=>a.sequence-b.sequence||a.event_id.localeCompare(b.event_id))){if(e.kind==="working-set")state.working_set=e.payload;if(e.kind==="presentation")state.presentation=e.payload;if(e.kind==="receipt")state.receipts.push(e.payload)}return Object.freeze({...state,receipts:Object.freeze(state.receipts)})}
