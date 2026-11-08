import type{LocalWorkspaceEvent,SyncEnvelope}from"./interface-local-state.js";
type R=Readonly<Record<string,unknown>>;
export type StorageTier="device"|"local-network"|"customer-cloud"|"byo-provider"|"titan-managed";
export type StorageProviderDescriptor=Readonly<{provider_id:string;tier:StorageTier;kind:"indexeddb"|"filesystem"|"network-node"|"google-drive"|"dropbox"|"s3"|"custom";customer_controlled:boolean;online_required:boolean;business_authority:false}>;
export type OfflineQueueEntry=Readonly<{queue_id:string;company_id:string;device_id:string;event:LocalWorkspaceEvent;state:"QUEUED"|"SENT"|"ACKNOWLEDGED"|"CONFLICT"|"REJECTED";attempts:number;last_error:string|null}>;
export class OfflinePresentationQueue{
 #entries=new Map<string,OfflineQueueEntry>();constructor(readonly company_id:string,readonly device_id:string){}
 enqueue(event:LocalWorkspaceEvent,queueId=event.event_id){if(event.company_id!==this.company_id)throw new Error("cross-company offline event rejected");if(event.device_id!==this.device_id)throw new Error("offline event belongs to another device");if(!this.#entries.has(queueId))this.#entries.set(queueId,Object.freeze({queue_id:queueId,company_id:this.company_id,device_id:this.device_id,event,state:"QUEUED",attempts:0,last_error:null}));return this.snapshot()}
 mark(queueId:string,state:OfflineQueueEntry["state"],error:string|null=null){const x=this.#entries.get(queueId);if(!x)throw new Error("unknown offline queue entry");this.#entries.set(queueId,Object.freeze({...x,state,attempts:x.attempts+(state==="SENT"?1:0),last_error:error}));return this.snapshot()}
 pending(){return Object.freeze(this.snapshot().filter(x=>x.state==="QUEUED"||x.state==="SENT"||x.state==="CONFLICT"))}
 snapshot(){return Object.freeze([...this.#entries.values()].sort((a,b)=>a.event.sequence-b.event.sequence||a.queue_id.localeCompare(b.queue_id)))}
}
export class StorageProviderRegistry{
 #providers=new Map<string,StorageProviderDescriptor>();
 register(p:StorageProviderDescriptor){if(p.business_authority!==false)throw new Error("interface storage provider cannot hold business authority");if(this.#providers.has(p.provider_id))throw new Error("duplicate storage provider");this.#providers.set(p.provider_id,Object.freeze({...p}));return this}
 all(){return Object.freeze([...this.#providers.values()].sort((a,b)=>rank(a.tier)-rank(b.tier)||a.provider_id.localeCompare(b.provider_id)))}
 choose(available:readonly string[]){const set=new Set(available);return this.all().find(x=>set.has(x.provider_id))??null}
}
const rank=(t:StorageTier)=>({"device":0,"local-network":1,"customer-cloud":2,"byo-provider":3,"titan-managed":4}[t]);
export function defaultStorageProviders():readonly StorageProviderDescriptor[]{return Object.freeze([
 {provider_id:"device-indexeddb",tier:"device",kind:"indexeddb",customer_controlled:true,online_required:false,business_authority:false},
 {provider_id:"local-network-node",tier:"local-network",kind:"network-node",customer_controlled:true,online_required:false,business_authority:false},
 {provider_id:"customer-google-drive",tier:"customer-cloud",kind:"google-drive",customer_controlled:true,online_required:true,business_authority:false},
 {provider_id:"customer-dropbox",tier:"customer-cloud",kind:"dropbox",customer_controlled:true,online_required:true,business_authority:false},
 {provider_id:"customer-s3",tier:"byo-provider",kind:"s3",customer_controlled:true,online_required:true,business_authority:false},
 {provider_id:"titan-managed-storage",tier:"titan-managed",kind:"custom",customer_controlled:false,online_required:true,business_authority:false}
 ])}
export type ReconciliationResult=Readonly<{accepted:readonly string[];conflicts:readonly string[];rejected:readonly string[];next_sequence:number}>;
export function reconcileOfflineQueue(queue:OfflinePresentationQueue,input:{acknowledged?:readonly string[];conflicts?:readonly string[];rejected?:readonly string[]}):ReconciliationResult{
 const ack=new Set(input.acknowledged??[]),con=new Set(input.conflicts??[]),rej=new Set(input.rejected??[]);
 for(const x of queue.snapshot()){if(ack.has(x.queue_id))queue.mark(x.queue_id,"ACKNOWLEDGED");else if(con.has(x.queue_id))queue.mark(x.queue_id,"CONFLICT","remote presentation conflict");else if(rej.has(x.queue_id))queue.mark(x.queue_id,"REJECTED","remote rejected presentation event")}
 const seq=Math.max(0,...queue.snapshot().filter(x=>x.state==="ACKNOWLEDGED").map(x=>x.event.sequence));
 return Object.freeze({accepted:Object.freeze([...ack].sort()),conflicts:Object.freeze([...con].sort()),rejected:Object.freeze([...rej].sort()),next_sequence:seq});
}
export function assertPresentationSyncEnvelope(envelope:SyncEnvelope){if(envelope.business_writes!==false)throw new Error("offline reconciliation cannot contain business writes");return true}
