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
const COLLECTION="field-evidence-sync";
const DEFAULT_CHUNK_SIZE=512*1024;
const DEFAULT_MAX_BYTES=25*1024*1024;

const text=(v:unknown,f:string)=>{const s=String(v??"").trim();if(!s)throw new Error(`${f}-required`);return s;};
function integer(v:unknown,f:string,min=0){const n=Number(v);if(!Number.isInteger(n)||n<min)throw new Error(`${f}-invalid`);return n;}
function assertCompany(value:unknown,company_id:string,path="field-evidence"):void{
  assertNoLegacyStorageBoundary(value,path);
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){value.forEach((x,i)=>assertCompany(x,company_id,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value as Record<string,unknown>)){
    if(k==="company_id"&&v!=null&&String(v).trim()!==company_id)throw new Error(`cross-company:${path}.company_id`);
    assertCompany(v,company_id,`${path}.${k}`);
  }
}
function expectedChunks(byte_size:number,chunk_size:number){return Math.max(1,Math.ceil(byte_size/chunk_size));}

export function createFieldEvidenceSync({
  repository,clock=()=>Date.now(),chunk_size=DEFAULT_CHUNK_SIZE,max_bytes=DEFAULT_MAX_BYTES,
}:{
  repository:Repo;clock?:()=>number;chunk_size?:number;max_bytes?:number;
}){
  if(!repository?.get||!repository?.put||!repository?.list||typeof repository.transaction!=="function")throw new Error("transaction-capable canonical repository required");
  const chunkSize=integer(chunk_size,"chunk_size",1);
  const maxBytes=integer(max_bytes,"max_bytes",1);

  const descriptor=Object.freeze({
    protocol:"titan.offline.field-evidence-sync.v1" as const,
    company_boundary:"company_id" as const,
    metadata_durable:true,
    bytes_authority:"caller_device_storage" as const,
    resumable:true,
    chunk_size:chunkSize,
    max_bytes:maxBytes,
    automatic_effect_replay:false,
    identity_grants_authority:false,
    execution_authority:false,
  });

  async function get(contextInput:StorageContextInput,evidence_id:string){
    const context=normalizeStorageContext(contextInput);
    const row=await repository.get(context,MODULE,COLLECTION,text(evidence_id,"evidence_id"));
    if(!row)return null;
    if(row.company_id!==context.company_id)throw new Error("cross-company:field-evidence-row");
    assertCompany(row.data,context.company_id,"field-evidence-row");
    return structuredClone(row.data as any);
  }

  return Object.freeze({
    descriptor,get,

    async enqueue(contextInput:StorageContextInput,input:Readonly<{
      evidence_id:string;
      operation_id:string;
      idempotency_key:string;
      media_kind:"photo"|"video"|"audio"|"document"|"other";
      mime_type:string;
      byte_size:number;
      checksum:string;
      local_blob_ref:string;
      metadata?:unknown;
    }>){
      const context=normalizeStorageContext(contextInput);
      assertCompany(input,context.company_id,"field-evidence.enqueue");
      const evidence_id=text(input.evidence_id,"evidence_id");
      const operation_id=text(input.operation_id,"operation_id");
      const idempotency_key=text(input.idempotency_key,"idempotency_key");
      const byte_size=integer(input.byte_size,"byte_size",1);
      if(byte_size>maxBytes)throw new Error("field-evidence-max-bytes-exceeded");
      const checksum=text(input.checksum,"checksum");
      const local_blob_ref=text(input.local_blob_ref,"local_blob_ref");
      const mime_type=text(input.mime_type,"mime_type");
      const media_kind=text(input.media_kind,"media_kind").toLowerCase();
      const chunks=expectedChunks(byte_size,chunkSize);

      return repository.transaction({...context,operation_id,idempotency_key:null},async(tx,txContext)=>{
        const prior=await tx.get(txContext,MODULE,COLLECTION,evidence_id);
        const priorData=prior?.data as any;
        if(priorData){
          const same=priorData.operation_id===operation_id&&priorData.idempotency_key===idempotency_key&&
            priorData.byte_size===byte_size&&priorData.checksum===checksum&&priorData.local_blob_ref===local_blob_ref;
          if(same)return Object.freeze({status:"duplicate" as const,item:structuredClone(priorData)});
          throw new Error("field-evidence-identity-conflict");
        }
        const now=Number(clock());
        const item=Object.freeze({
          schema:"titan.offline.field-evidence-item.v1",
          company_id:txContext.company_id,evidence_id,operation_id,idempotency_key,media_kind,mime_type,byte_size,checksum,local_blob_ref,
          metadata:structuredClone(input.metadata??null),
          chunk_size:chunkSize,total_chunks:chunks,next_chunk_index:0,uploaded_chunks:0,uploaded_bytes:0,
          remote_upload_id:null,remote_evidence_ref:null,
          state:"queued" as const,created_at:now,updated_at:now,completed_at:null,last_error:null,
          automatic_effect_replay:false,effect_replay_allowed:false,authority_neutral:true,grants_authority:false
        });
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:COLLECTION,record_id:evidence_id,data:item});
        return Object.freeze({status:"queued" as const,item});
      });
    },

    async begin(contextInput:StorageContextInput,input:Readonly<{evidence_id:string;remote_upload_id:string}>){
      const context=normalizeStorageContext(contextInput);
      const evidence_id=text(input.evidence_id,"evidence_id"),remote_upload_id=text(input.remote_upload_id,"remote_upload_id");
      return repository.transaction({...context,operation_id:`field-evidence:${evidence_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,COLLECTION,evidence_id);
        if(!row?.data)throw new Error("field-evidence-not-found");
        const prior=row.data as any;
        if(prior.state==="completed")return structuredClone(prior);
        if(prior.remote_upload_id&&prior.remote_upload_id!==remote_upload_id)throw new Error("field-evidence-upload-id-conflict");
        const next=Object.freeze({...structuredClone(prior),state:"uploading",remote_upload_id,updated_at:Number(clock()),last_error:null,
          automatic_effect_replay:false,effect_replay_allowed:false,grants_authority:false});
        await tx.put(txContext,{module_id:MODULE,collection:COLLECTION,record_id:evidence_id,expected_revision:row.version,data:next});
        return next;
      });
    },

    async acknowledgeChunk(contextInput:StorageContextInput,input:Readonly<{
      evidence_id:string;remote_upload_id:string;chunk_index:number;chunk_bytes:number;chunk_checksum:string;
    }>){
      const context=normalizeStorageContext(contextInput);
      assertCompany(input,context.company_id,"field-evidence.chunk");
      const evidence_id=text(input.evidence_id,"evidence_id"),remote_upload_id=text(input.remote_upload_id,"remote_upload_id");
      const chunk_index=integer(input.chunk_index,"chunk_index",0),chunk_bytes=integer(input.chunk_bytes,"chunk_bytes",1);
      text(input.chunk_checksum,"chunk_checksum");
      return repository.transaction({...context,operation_id:`field-evidence:${evidence_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,COLLECTION,evidence_id);
        if(!row?.data)throw new Error("field-evidence-not-found");
        const prior=row.data as any;
        if(prior.state==="completed")return structuredClone(prior);
        if(prior.remote_upload_id!==remote_upload_id)throw new Error("field-evidence-upload-id-mismatch");
        if(chunk_index<Number(prior.next_chunk_index)){
          return Object.freeze({...structuredClone(prior),duplicate_chunk:true});
        }
        if(chunk_index!==Number(prior.next_chunk_index))throw new Error("field-evidence-chunk-out-of-order");
        if(chunk_index>=Number(prior.total_chunks))throw new Error("field-evidence-chunk-out-of-range");
        const remaining=Number(prior.byte_size)-Number(prior.uploaded_bytes);
        if(chunk_bytes>chunkSize||chunk_bytes>remaining)throw new Error("field-evidence-chunk-size-invalid");
        const nextIndex=chunk_index+1;
        const uploadedBytes=Number(prior.uploaded_bytes)+chunk_bytes;
        const next=Object.freeze({...structuredClone(prior),
          next_chunk_index:nextIndex,uploaded_chunks:nextIndex,uploaded_bytes:uploadedBytes,
          state:nextIndex===Number(prior.total_chunks)?"awaiting_commit":"uploading",
          updated_at:Number(clock()),last_error:null,duplicate_chunk:false,
          automatic_effect_replay:false,effect_replay_allowed:false,grants_authority:false
        });
        await tx.put(txContext,{module_id:MODULE,collection:COLLECTION,record_id:evidence_id,expected_revision:row.version,data:next});
        return next;
      });
    },

    async markInterrupted(contextInput:StorageContextInput,input:Readonly<{evidence_id:string;error?:string}>){
      const context=normalizeStorageContext(contextInput);const evidence_id=text(input.evidence_id,"evidence_id");
      return repository.transaction({...context,operation_id:`field-evidence:${evidence_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,COLLECTION,evidence_id);
        if(!row?.data)throw new Error("field-evidence-not-found");
        const prior=row.data as any;
        if(prior.state==="completed")return structuredClone(prior);
        const next=Object.freeze({...structuredClone(prior),state:"interrupted",last_error:String(input.error??"interrupted"),updated_at:Number(clock()),
          automatic_effect_replay:false,effect_replay_allowed:false,grants_authority:false});
        await tx.put(txContext,{module_id:MODULE,collection:COLLECTION,record_id:evidence_id,expected_revision:row.version,data:next});
        return next;
      });
    },

    async resume(contextInput:StorageContextInput,input:Readonly<{evidence_id:string;remote_upload_id:string}>){
      const context=normalizeStorageContext(contextInput);const evidence_id=text(input.evidence_id,"evidence_id");
      const remote_upload_id=text(input.remote_upload_id,"remote_upload_id");
      return repository.transaction({...context,operation_id:`field-evidence:${evidence_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,COLLECTION,evidence_id);
        if(!row?.data)throw new Error("field-evidence-not-found");
        const prior=row.data as any;
        if(prior.remote_upload_id!==remote_upload_id)throw new Error("field-evidence-upload-id-mismatch");
        if(prior.state==="completed")return structuredClone(prior);
        const next=Object.freeze({...structuredClone(prior),state:Number(prior.next_chunk_index)>=Number(prior.total_chunks)?"awaiting_commit":"uploading",
          resumed_at:Number(clock()),updated_at:Number(clock()),last_error:null,
          automatic_effect_replay:false,effect_replay_allowed:false,grants_authority:false});
        await tx.put(txContext,{module_id:MODULE,collection:COLLECTION,record_id:evidence_id,expected_revision:row.version,data:next});
        return next;
      });
    },

    async complete(contextInput:StorageContextInput,input:Readonly<{evidence_id:string;remote_upload_id:string;remote_evidence_ref:string;checksum:string}>){
      const context=normalizeStorageContext(contextInput);assertCompany(input,context.company_id,"field-evidence.complete");
      const evidence_id=text(input.evidence_id,"evidence_id"),remote_upload_id=text(input.remote_upload_id,"remote_upload_id");
      const remote_evidence_ref=text(input.remote_evidence_ref,"remote_evidence_ref"),checksum=text(input.checksum,"checksum");
      return repository.transaction({...context,operation_id:`field-evidence:${evidence_id}`,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,COLLECTION,evidence_id);
        if(!row?.data)throw new Error("field-evidence-not-found");
        const prior=row.data as any;
        if(prior.state==="completed"){
          if(prior.remote_evidence_ref===remote_evidence_ref&&prior.checksum===checksum)return structuredClone(prior);
          throw new Error("field-evidence-completion-conflict");
        }
        if(prior.remote_upload_id!==remote_upload_id)throw new Error("field-evidence-upload-id-mismatch");
        if(prior.checksum!==checksum)throw new Error("field-evidence-checksum-mismatch");
        if(Number(prior.next_chunk_index)!==Number(prior.total_chunks)||Number(prior.uploaded_bytes)!==Number(prior.byte_size)){
          throw new Error("field-evidence-upload-incomplete");
        }
        const now=Number(clock());
        const next=Object.freeze({...structuredClone(prior),state:"completed",remote_evidence_ref,completed_at:now,updated_at:now,last_error:null,
          automatic_effect_replay:false,effect_replay_allowed:false,authority_neutral:true,grants_authority:false});
        await tx.put(txContext,{module_id:MODULE,collection:COLLECTION,record_id:evidence_id,expected_revision:row.version,data:next});
        return next;
      });
    },

    async pending(contextInput:StorageContextInput){
      const context=normalizeStorageContext(contextInput);
      const rows=await repository.list(context,{module_id:MODULE,collection:COLLECTION});
      return Object.freeze(rows.map(r=>structuredClone(r.data as any)).filter(x=>x.state!=="completed").sort((a,b)=>Number(a.created_at)-Number(b.created_at)||String(a.evidence_id).localeCompare(String(b.evidence_id))));
    }
  });
}
