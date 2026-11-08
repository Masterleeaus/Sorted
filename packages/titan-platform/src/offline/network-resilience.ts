import {
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
  type StorageContextInput,
  type StorageRecord,
} from "../storage/contracts.js";

type Repo = Readonly<{
  get(context: StorageContextInput,module_id:string,collection:string,record_id:string):Promise<StorageRecord|null>;
  put(context: StorageContextInput,input:Readonly<{module_id:string;collection:string;record_id:string;expected_revision?:number;data?:unknown}>):Promise<StorageRecord>;
  list(context: StorageContextInput,query?:Readonly<{module_id?:string;collection?:string}>):Promise<readonly StorageRecord[]>;
  transaction<T>(context:StorageContextInput,work:(repository:Repo,context:ReturnType<typeof normalizeStorageContext>)=>Promise<T>):Promise<T>;
}>;

const MODULE="titan.offline";
const NETWORK="network-state";
const DELIVERY="delivery-receipts";
const PARTIAL="partial-sync";
const text=(v:unknown,f:string)=>{const s=String(v??"").trim();if(!s)throw new Error(`${f}-required`);return s;};

function assertCompany(value:unknown,company_id:string,path="network-resilience"):void{
  assertNoLegacyStorageBoundary(value,path);
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){value.forEach((x,i)=>assertCompany(x,company_id,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value as Record<string,unknown>)){
    if(k==="company_id"&&v!=null&&String(v).trim()!==company_id)throw new Error(`cross-company:${path}.company_id`);
    assertCompany(v,company_id,`${path}.${k}`);
  }
}
function finiteTime(v:unknown,f:string){const n=Number(v);if(!Number.isFinite(n))throw new Error(`${f}-invalid`);return n;}

export function createOfflineNetworkResilience({
  repository,
  clock=()=>Date.now(),
  max_clock_skew_ms=5*60_000,
}:{
  repository:Repo;clock?:()=>number;max_clock_skew_ms?:number;
}){
  if(!repository?.get||!repository?.put||!repository?.list||typeof repository.transaction!=="function"){
    throw new Error("transaction-capable canonical repository required");
  }
  if(!Number.isFinite(max_clock_skew_ms)||max_clock_skew_ms<0)throw new Error("max_clock_skew_ms-invalid");

  const descriptor=Object.freeze({
    protocol:"titan.offline.network-resilience.v1" as const,
    company_boundary:"company_id" as const,
    network_epoch_durable:true,
    duplicate_delivery_idempotent:true,
    clock_skew_fail_closed:true,
    partial_sync_checkpointed:true,
    automatic_effect_replay:false,
    identity_grants_authority:false,
    execution_authority:false,
  });

  async function networkState(contextInput:StorageContextInput){
    const context=normalizeStorageContext(contextInput);
    return repository.get(context,MODULE,NETWORK,"singleton");
  }

  return Object.freeze({
    descriptor,

    async observeNetwork(contextInput:StorageContextInput,input:Readonly<{state:"online"|"offline";observed_at?:number}>){
      const context=normalizeStorageContext(contextInput);assertCompany(input,context.company_id,"network.observe");
      const observed_at=finiteTime(input.observed_at??clock(),"observed_at");
      const now=Number(clock());
      if(Math.abs(observed_at-now)>max_clock_skew_ms)throw new Error("network-clock-skew-exceeded");
      return repository.transaction({...context,operation_id:"network-state",idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,NETWORK,"singleton");
        const prior=row?.data as any;
        if(prior&&observed_at<Number(prior.observed_at??0)) {
          return Object.freeze({status:"stale_observation" as const,state:structuredClone(prior)});
        }
        const changed=!prior||prior.state!==input.state;
        const epoch=changed?Number(prior?.epoch??0)+1:Number(prior?.epoch??0);
        const next=Object.freeze({
          schema:"titan.offline.network-state.v1",
          company_id:txContext.company_id,state:input.state,epoch,observed_at,updated_at:now,
          changed,authority_neutral:true,grants_authority:false,automatic_effect_replay:false
        });
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:NETWORK,record_id:"singleton",expected_revision:row?.version??0,data:next});
        return Object.freeze({status:changed?"transition" as const:"unchanged" as const,state:next});
      });
    },

    async currentNetwork(contextInput:StorageContextInput){
      const row=await networkState(contextInput);return row?.data?structuredClone(row.data):null;
    },

    async acceptDelivery(contextInput:StorageContextInput,input:Readonly<{
      delivery_id:string;operation_id:string;idempotency_key:string;delivered_at:number;payload_fingerprint:string;
    }>){
      const context=normalizeStorageContext(contextInput);assertCompany(input,context.company_id,"network.delivery");
      const delivery_id=text(input.delivery_id,"delivery_id"),operation_id=text(input.operation_id,"operation_id"),
        idempotency_key=text(input.idempotency_key,"idempotency_key"),payload_fingerprint=text(input.payload_fingerprint,"payload_fingerprint");
      const delivered_at=finiteTime(input.delivered_at,"delivered_at"),now=Number(clock());
      if(Math.abs(delivered_at-now)>max_clock_skew_ms)throw new Error("delivery-clock-skew-exceeded");
      return repository.transaction({...context,operation_id,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,DELIVERY,delivery_id);
        if(row?.data){
          const prior=row.data as any;
          const same=prior.operation_id===operation_id&&prior.idempotency_key===idempotency_key&&prior.payload_fingerprint===payload_fingerprint;
          if(!same)throw new Error("duplicate-delivery-conflict");
          return Object.freeze({status:"duplicate" as const,receipt:structuredClone(prior)});
        }
        const receipt=Object.freeze({
          schema:"titan.offline.delivery-receipt.v1",
          company_id:txContext.company_id,delivery_id,operation_id,idempotency_key,payload_fingerprint,delivered_at,accepted_at:now,
          authority_neutral:true,grants_authority:false,automatic_effect_replay:false,effect_replay_allowed:false
        });
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:DELIVERY,record_id:delivery_id,data:receipt});
        return Object.freeze({status:"accepted" as const,receipt});
      });
    },

    async beginPartialSync(contextInput:StorageContextInput,input:Readonly<{sync_id:string;generation:number;total_parts:number}>){
      const context=normalizeStorageContext(contextInput);assertCompany(input,context.company_id,"network.partial-sync");
      const sync_id=text(input.sync_id,"sync_id"),generation=Number(input.generation),total_parts=Number(input.total_parts);
      if(!Number.isInteger(generation)||generation<0)throw new Error("partial-sync-generation-invalid");
      if(!Number.isInteger(total_parts)||total_parts<1)throw new Error("partial-sync-total-parts-invalid");
      return repository.transaction({...context,operation_id:`partial-sync:${sync_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,PARTIAL,sync_id);const prior=row?.data as any;
        if(prior){
          if(prior.generation!==generation||prior.total_parts!==total_parts)throw new Error("partial-sync-identity-conflict");
          return Object.freeze({status:"existing" as const,state:structuredClone(prior)});
        }
        const now=Number(clock());
        const state=Object.freeze({
          schema:"titan.offline.partial-sync.v1",company_id:txContext.company_id,sync_id,generation,total_parts,
          next_part:0,applied_parts:0,state:"active" as const,created_at:now,updated_at:now,last_error:null,
          authority_neutral:true,grants_authority:false,automatic_effect_replay:false
        });
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:PARTIAL,record_id:sync_id,data:state});
        return Object.freeze({status:"started" as const,state});
      });
    },

    async applyPartialPart(contextInput:StorageContextInput,input:Readonly<{sync_id:string;generation:number;part_index:number;part_fingerprint:string}>){
      const context=normalizeStorageContext(contextInput);assertCompany(input,context.company_id,"network.partial-sync-part");
      const sync_id=text(input.sync_id,"sync_id"),part_fingerprint=text(input.part_fingerprint,"part_fingerprint");
      const generation=Number(input.generation),part_index=Number(input.part_index);
      if(!Number.isInteger(generation)||generation<0||!Number.isInteger(part_index)||part_index<0)throw new Error("partial-sync-part-invalid");
      return repository.transaction({...context,operation_id:`partial-sync:${sync_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,PARTIAL,sync_id);
        if(!row?.data)throw new Error("partial-sync-not-found");
        const prior=row.data as any;
        if(prior.generation!==generation)throw new Error("partial-sync-generation-mismatch");
        if(part_index<Number(prior.next_part)){
          return Object.freeze({status:"duplicate" as const,state:structuredClone(prior)});
        }
        if(part_index!==Number(prior.next_part))throw new Error("partial-sync-out-of-order");
        if(part_index>=Number(prior.total_parts))throw new Error("partial-sync-part-out-of-range");
        const now=Number(clock()),nextPart=part_index+1;
        const next=Object.freeze({...structuredClone(prior),next_part:nextPart,applied_parts:nextPart,last_part_fingerprint:part_fingerprint,
          state:nextPart===Number(prior.total_parts)?"complete":"active",updated_at:now,completed_at:nextPart===Number(prior.total_parts)?now:null,
          last_error:null,automatic_effect_replay:false,grants_authority:false});
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:PARTIAL,record_id:sync_id,expected_revision:row.version,data:next});
        return Object.freeze({status:next.state==="complete"?"complete" as const:"applied" as const,state:next});
      });
    },

    async interruptPartialSync(contextInput:StorageContextInput,input:Readonly<{sync_id:string;error?:string}>){
      const context=normalizeStorageContext(contextInput);const sync_id=text(input.sync_id,"sync_id");
      return repository.transaction({...context,operation_id:`partial-sync:${sync_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,PARTIAL,sync_id);if(!row?.data)throw new Error("partial-sync-not-found");
        const prior=row.data as any;if(prior.state==="complete")return structuredClone(prior);
        const next=Object.freeze({...structuredClone(prior),state:"interrupted",last_error:String(input.error??"interrupted"),updated_at:Number(clock()),automatic_effect_replay:false,grants_authority:false});
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:PARTIAL,record_id:sync_id,expected_revision:row.version,data:next});
        return next;
      });
    },

    async resumePartialSync(contextInput:StorageContextInput,input:Readonly<{sync_id:string;generation:number}>){
      const context=normalizeStorageContext(contextInput);const sync_id=text(input.sync_id,"sync_id"),generation=Number(input.generation);
      return repository.transaction({...context,operation_id:`partial-sync:${sync_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,PARTIAL,sync_id);if(!row?.data)throw new Error("partial-sync-not-found");
        const prior=row.data as any;if(prior.generation!==generation)throw new Error("partial-sync-generation-mismatch");
        if(prior.state==="complete")return structuredClone(prior);
        const now=Number(clock());
        const next=Object.freeze({...structuredClone(prior),state:"active",last_error:null,resumed_at:now,updated_at:now,automatic_effect_replay:false,grants_authority:false});
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:PARTIAL,record_id:sync_id,expected_revision:row.version,data:next});
        return next;
      });
    }
  });
}
