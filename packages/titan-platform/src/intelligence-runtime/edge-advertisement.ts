import type { DeviceResourceSnapshot, DeviceRuntimeState } from './device-runtime.js';
import { effectiveCapabilityFingerprint, projectEdgeIntelligenceCapability, classifyRuntimeResourcePressure, type EdgeIntelligenceCapabilityAdvertisement } from './resource-reporting.js';

export type EdgeAdvertisementAction = 'publish'|'update'|'suspend'|'withdraw';
export interface EdgeAdvertisementEnvelope {
 schema:'titan-edge-capability-envelope/v1'; company_id:string; node_id:string; action:EdgeAdvertisementAction;
 advertisement?:EdgeIntelligenceCapabilityAdvertisement; reason:string; emittedAt:number; authorityGranted:false;
}
export interface EdgeAdvertisementReceipt {
 schema:'titan-edge-capability-receipt/v1'; company_id:string; node_id:string; action:EdgeAdvertisementAction;
 accepted:boolean; acceptedSequence?:number; receiptId?:string; reason?:string; authorityGranted:false;
}
/** Port into Edge Fabric. The sink owns node/capability persistence; Intelligence Runtime only emits projections. */
export interface EdgeCapabilityAdvertisementSink { emit(envelope:EdgeAdvertisementEnvelope):void|EdgeAdvertisementReceipt|Promise<void|EdgeAdvertisementReceipt>; }
interface PublishedState { sequence:number; fingerprint:string; suspended:boolean; }
export interface EdgeAdvertisementLifecycleSnapshot { schema:'titan-edge-advertisement-lifecycle-state/v1'; entries:{company_id:string;node_id:string;sequence:number;fingerprint:string;suspended:boolean}[]; }
function key(company_id:string,node_id:string){return `${company_id}\u0000${node_id}`;}
function fingerprint(ad:EdgeIntelligenceCapabilityAdvertisement):string { return effectiveCapabilityFingerprint(ad); }
function assertReceipt(envelope:EdgeAdvertisementEnvelope,receipt:void|EdgeAdvertisementReceipt){
 if(!receipt)return;
 if(receipt.schema!=='titan-edge-capability-receipt/v1'||receipt.company_id!==envelope.company_id||receipt.node_id!==envelope.node_id||receipt.action!==envelope.action)throw new Error('edge-advertisement-receipt-mismatch');
 if(receipt.authorityGranted!==false)throw new Error('edge-advertisement-receipt-authority-invalid');
 if(!receipt.accepted)throw new Error(`edge-advertisement-rejected:${receipt.reason??'unspecified'}`);
 if(envelope.advertisement&&receipt.acceptedSequence!==undefined&&receipt.acceptedSequence!==envelope.advertisement.sequence)throw new Error('edge-advertisement-receipt-sequence-mismatch');
}
export class EdgeIntelligenceAdvertisementLifecycle {
 private published=new Map<string,PublishedState>();
 constructor(private sink:EdgeCapabilityAdvertisementSink){}
 async reconcile(state:DeviceRuntimeState, resources:DeviceResourceSnapshot, now=Date.now()):Promise<EdgeAdvertisementEnvelope|null>{
  if(!state.company_id||!state.node_id)throw new Error('edge-advertisement-identity-required');
  const k=key(state.company_id,state.node_id), previous=this.published.get(k);
  if(previous&&state.sequence<previous.sequence)throw new Error('edge-advertisement-sequence-regression');
  const ad=projectEdgeIntelligenceCapability(state,resources), fp=fingerprint(ad);
  const pressure=classifyRuntimeResourcePressure(ad), shouldSuspend=pressure.level==='suspended';
  if(previous&&state.sequence===previous.sequence&&previous.fingerprint===fp&&previous.suspended===shouldSuspend)return null;
  const action:EdgeAdvertisementAction=!previous?'publish':shouldSuspend&&!previous.suspended?'suspend':'update';
  const reason=action==='publish'?'initial-capability-advertisement':action==='suspend'?`capability-unavailable:${pressure.reasons.join(',')}`:previous?.suspended?'capability-restored':'capability-updated';
  const envelope:EdgeAdvertisementEnvelope={schema:'titan-edge-capability-envelope/v1',company_id:state.company_id,node_id:state.node_id,action,advertisement:ad,reason,emittedAt:now,authorityGranted:false};
  const receipt=await this.sink.emit(envelope); assertReceipt(envelope,receipt);
  // Commit local projection state only after Edge Fabric accepts the advertisement.
  this.published.set(k,{sequence:state.sequence,fingerprint:fp,suspended:shouldSuspend}); return envelope;
 }
 async withdraw(company_id:string,node_id:string,reason='node-revoked',now=Date.now()):Promise<EdgeAdvertisementEnvelope|null>{
  if(!company_id||!node_id)throw new Error('edge-advertisement-identity-required');
  const k=key(company_id,node_id); if(!this.published.has(k))return null;
  const envelope:EdgeAdvertisementEnvelope={schema:'titan-edge-capability-envelope/v1',company_id,node_id,action:'withdraw',reason,emittedAt:now,authorityGranted:false};
  const receipt=await this.sink.emit(envelope); assertReceipt(envelope,receipt);
  this.published.delete(k); return envelope;
 }
 hasAdvertisement(company_id:string,node_id:string){return this.published.has(key(company_id,node_id));}
 exportState():EdgeAdvertisementLifecycleSnapshot{
  const entries=[...this.published.entries()].map(([k,v])=>{const [company_id,node_id]=k.split('\u0000');return {company_id,node_id,...v};}).sort((a,b)=>a.company_id.localeCompare(b.company_id)||a.node_id.localeCompare(b.node_id));
  return {schema:'titan-edge-advertisement-lifecycle-state/v1',entries};
 }
 importState(snapshot:EdgeAdvertisementLifecycleSnapshot){
  if(snapshot.schema!=='titan-edge-advertisement-lifecycle-state/v1')throw new Error('edge-advertisement-snapshot-schema-invalid');
  const next=new Map<string,PublishedState>();
  for(const e of snapshot.entries){
   if(!e.company_id||!e.node_id||!Number.isInteger(e.sequence)||e.sequence<0||!e.fingerprint)throw new Error('edge-advertisement-snapshot-invalid');
   const k=key(e.company_id,e.node_id); if(next.has(k))throw new Error('edge-advertisement-snapshot-duplicate');
   next.set(k,{sequence:e.sequence,fingerprint:e.fingerprint,suspended:e.suspended===true});
  }
  this.published=next;
 }
}
