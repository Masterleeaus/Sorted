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
const CHECKPOINTS="restart-checkpoints";
const RECEIPTS="restart-receipts";
const text=(v:unknown,f:string)=>{const s=String(v??"").trim();if(!s)throw new Error(`${f}-required`);return s;};

function assertCompany(value:unknown,company_id:string,path="restart"):void{
  assertNoLegacyStorageBoundary(value,path);
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){value.forEach((x,i)=>assertCompany(x,company_id,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value as Record<string,unknown>)){
    if(k==="company_id"&&v!=null&&String(v).trim()!==company_id)throw new Error(`cross-company:${path}.company_id`);
    assertCompany(v,company_id,`${path}.${k}`);
  }
}
function continuationToken(company_id:string,operation_id:string,idempotency_key:string,recovery_count:number){
  return `titan-cont:${encodeURIComponent(company_id)}:${encodeURIComponent(operation_id)}:${encodeURIComponent(idempotency_key)}:${recovery_count}`;
}
function receiptId(operation_id:string,kind:string,recovery_count:number,at:number){
  return `${operation_id}:${kind}:${recovery_count}:${at}`;
}

export function createRestartRecoveryCoordinator({repository,clock=()=>Date.now()}:{repository:Repo;clock?:()=>number}){
  if(!repository?.get||!repository?.put||!repository?.list||typeof repository.transaction!=="function"){
    throw new Error("transaction-capable canonical repository required");
  }
  const descriptor=Object.freeze({
    protocol:"titan.offline.restart-recovery.v1" as const,
    company_boundary:"company_id" as const,
    requires_explicit_resume:true,
    automatic_effect_replay:false,
    identity_grants_authority:false,
    execution_authority:false,
  });

  async function read(contextInput:StorageContextInput,operation_id:string){
    const context=normalizeStorageContext(contextInput);
    const row=await repository.get(context,MODULE,CHECKPOINTS,text(operation_id,"operation_id"));
    if(!row)return null;
    if(row.company_id!==context.company_id)throw new Error("cross-company:restart-checkpoint-row");
    assertCompany(row.data,context.company_id,"restart-checkpoint-row");
    return row;
  }

  async function recordReceipt(tx:Repo,context:ReturnType<typeof normalizeStorageContext>,checkpoint:any,kind:string,details:Record<string,unknown>={}){
    const at=Number(clock());
    const receipt=Object.freeze({
      schema:"titan.offline.restart-receipt.v1",
      company_id:context.company_id,
      operation_id:checkpoint.operation_id,
      kind,
      recovery_count:Number(checkpoint.recovery_count||0),
      event_sequence:Number(checkpoint.event_sequence||0),
      idempotency_key:checkpoint.idempotency_key,
      checkpoint_state:checkpoint.state,
      created_at:at,
      details:structuredClone(details),
      authority_neutral:true,
      grants_authority:false,
      automatic_effect_replay:false,
      effect_replay_allowed:false,
    });
    await tx.put({...context,idempotency_key:null},{
      module_id:MODULE,collection:RECEIPTS,record_id:receiptId(checkpoint.operation_id,kind,receipt.recovery_count,at),data:receipt
    });
    return receipt;
  }

  return Object.freeze({
    descriptor,
    read,

    async checkpoint(contextInput:StorageContextInput,input:Readonly<{
      operation_id:string;idempotency_key:string;phase?:string;payload?:unknown;
    }>){
      const context=normalizeStorageContext(contextInput); assertCompany(input,context.company_id,"restart.checkpoint");
      const operation_id=text(input.operation_id,"operation_id");
      const idempotency_key=text(input.idempotency_key,"idempotency_key");
      return repository.transaction({...context,operation_id,idempotency_key:null},async(tx,txContext)=>{
        const storageContext=Object.freeze({...txContext,idempotency_key:null});
        const prior=await tx.get(storageContext,MODULE,CHECKPOINTS,operation_id);
        const priorData=prior?.data as any;
        if(priorData&&priorData.idempotency_key!==idempotency_key)throw new Error("restart-idempotency-key-mismatch");
        if(priorData?.terminal)throw new Error("restart-checkpoint-terminal");
        const now=Number(clock());
        const next=Object.freeze({
          schema:"titan.offline.restart-checkpoint.v1",
          company_id:txContext.company_id,operation_id,idempotency_key,
          phase:String(input.phase??priorData?.phase??"active"),
          payload:structuredClone(input.payload??priorData?.payload??null),
          state:"active" as const,terminal:false,
          recovery_count:Number(priorData?.recovery_count||0),
          event_sequence:Number(priorData?.event_sequence||0)+1,
          worker_lifecycle:"active",
          requires_explicit_resume:false,
          continuation_pending:false,continuation_claimed:false,continuation_token:null,
          created_at:Number(priorData?.created_at??now),updated_at:now,
          automatic_effect_replay:false,effect_replay_allowed:false,authority_neutral:true,grants_authority:false,
        });
        await tx.put(storageContext,{module_id:MODULE,collection:CHECKPOINTS,record_id:operation_id,expected_revision:prior?.version??0,data:next});
        await recordReceipt(tx,txContext,next,"checkpointed");
        return next;
      });
    },

    async beforeSuspend(contextInput:StorageContextInput,{reason="runtime-suspend"}={}){
      const context=normalizeStorageContext(contextInput);
      const rows=await repository.list(context,{module_id:MODULE,collection:CHECKPOINTS});
      const changed:any[]=[];
      for(const row of rows){
        const data=row.data as any;
        if(data.terminal)continue;
        await repository.transaction({...context,operation_id:data.operation_id,idempotency_key:null},async(tx,txContext)=>{
          const current=await tx.get(txContext,MODULE,CHECKPOINTS,data.operation_id);
          if(!current?.data||(current.data as any).terminal)return;
          const now=Number(clock());
          const next=Object.freeze({...structuredClone(current.data as any),worker_lifecycle:"suspended",suspended_at:now,suspend_reason:String(reason),updated_at:now,event_sequence:Number((current.data as any).event_sequence||0)+1,automatic_effect_replay:false,effect_replay_allowed:false});
          await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:CHECKPOINTS,record_id:data.operation_id,expected_revision:current.version,data:next});
          await recordReceipt(tx,txContext,next,"suspended",{reason:String(reason)});
          changed.push(next);
        });
      }
      return Object.freeze(changed.map(x=>structuredClone(x)));
    },

    async afterStart(contextInput:StorageContextInput){
      const context=normalizeStorageContext(contextInput);
      const rows=await repository.list(context,{module_id:MODULE,collection:CHECKPOINTS});
      const recovered:any[]=[];
      for(const row of rows){
        const data=row.data as any;
        if(data.terminal)continue;
        if(!["active","suspended","recovery_required","resumed"].includes(String(data.state)))continue;
        await repository.transaction({...context,operation_id:data.operation_id,idempotency_key:null},async(tx,txContext)=>{
          const current=await tx.get(txContext,MODULE,CHECKPOINTS,data.operation_id);
          if(!current?.data||(current.data as any).terminal)return;
          const cur=current.data as any;
          const now=Number(clock());
          const next=Object.freeze({...structuredClone(cur),state:"recovery_required",worker_lifecycle:"restarted",
            recovery_count:Number(cur.recovery_count||0)+1,event_sequence:Number(cur.event_sequence||0)+1,recovered_at:now,updated_at:now,
            requires_explicit_resume:true,continuation_pending:false,continuation_claimed:false,continuation_token:null,
            automatic_effect_replay:false,effect_replay_allowed:false,authority_neutral:true,grants_authority:false});
          await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:CHECKPOINTS,record_id:data.operation_id,expected_revision:current.version,data:next});
          await recordReceipt(tx,txContext,next,"recovered");
          recovered.push(next);
        });
      }
      return Object.freeze({
        schema:"titan.offline.restart-result.v1",
        company_id:context.company_id,
        status:recovered.length?"recovery-required":"ready",
        requires_explicit_resume:recovered.length>0,
        recovered:Object.freeze(recovered.map(x=>structuredClone(x))),
        automatic_effect_replay:false,effect_replay_allowed:false,grants_authority:false
      });
    },

    async resume(contextInput:StorageContextInput,{operation_id,idempotency_key}:{operation_id:string;idempotency_key:string}){
      const context=normalizeStorageContext(contextInput);
      const op=text(operation_id,"operation_id"), idem=text(idempotency_key,"idempotency_key");
      return repository.transaction({...context,operation_id:op,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,CHECKPOINTS,op);
        if(!row?.data)throw new Error("restart-checkpoint-not-found");
        const prior=row.data as any;
        if(prior.state!=="recovery_required")throw new Error("continuation-requires-recovery-required");
        if(prior.idempotency_key!==idem)throw new Error("restart-idempotency-key-mismatch");
        const now=Number(clock());
        const token=continuationToken(txContext.company_id,op,idem,Number(prior.recovery_count||0));
        const next=Object.freeze({...structuredClone(prior),state:"resumed",resumed_at:now,updated_at:now,event_sequence:Number(prior.event_sequence||0)+1,
          requires_explicit_resume:false,continuation_pending:true,continuation_claimed:false,continuation_token:token,
          automatic_effect_replay:false,effect_replay_allowed:false,authority_neutral:true,grants_authority:false});
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:CHECKPOINTS,record_id:op,expected_revision:row.version,data:next});
        await recordReceipt(tx,txContext,next,"resumed");
        return next;
      });
    },

    async claimContinuation(contextInput:StorageContextInput,{operation_id,idempotency_key,continuation_token}:{operation_id:string;idempotency_key:string;continuation_token:string}){
      const context=normalizeStorageContext(contextInput);
      const op=text(operation_id,"operation_id"), idem=text(idempotency_key,"idempotency_key"), token=text(continuation_token,"continuation_token");
      return repository.transaction({...context,operation_id:op,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,CHECKPOINTS,op);
        if(!row?.data)throw new Error("restart-checkpoint-not-found");
        const prior=row.data as any;
        if(prior.idempotency_key!==idem)throw new Error("continuation-idempotency-key-mismatch");
        if(prior.continuation_token!==token)throw new Error("continuation-token-mismatch");
        if(prior.continuation_claimed===true||prior.continuation_pending===false){
          return Object.freeze({claimed:false,duplicate:true,record:structuredClone(prior)});
        }
        if(prior.state!=="resumed")throw new Error("continuation-requires-resumed-state");
        const now=Number(clock());
        const next=Object.freeze({...structuredClone(prior),continuation_pending:false,continuation_claimed:true,continuation_claimed_at:now,updated_at:now,event_sequence:Number(prior.event_sequence||0)+1,
          automatic_effect_replay:false,effect_replay_allowed:false,authority_neutral:true,grants_authority:false});
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:CHECKPOINTS,record_id:op,expected_revision:row.version,data:next});
        await recordReceipt(tx,txContext,next,"continuation_claimed");
        return Object.freeze({claimed:true,duplicate:false,record:next});
      });
    },

    async complete(contextInput:StorageContextInput,{operation_id}:{operation_id:string}){
      const context=normalizeStorageContext(contextInput); const op=text(operation_id,"operation_id");
      return repository.transaction({...context,operation_id:op,idempotency_key:null},async(tx,txContext)=>{
        const row=await tx.get(txContext,MODULE,CHECKPOINTS,op);
        if(!row?.data)throw new Error("restart-checkpoint-not-found");
        const prior=row.data as any;
        if(prior.terminal)return structuredClone(prior);
        const now=Number(clock());
        const next=Object.freeze({...structuredClone(prior),state:"completed",terminal:true,completed_at:now,updated_at:now,event_sequence:Number(prior.event_sequence||0)+1,
          requires_explicit_resume:false,continuation_pending:false,automatic_effect_replay:false,effect_replay_allowed:false,
          authority_neutral:true,grants_authority:false});
        await tx.put({...txContext,idempotency_key:null},{module_id:MODULE,collection:CHECKPOINTS,record_id:op,expected_revision:row.version,data:next});
        await recordReceipt(tx,txContext,next,"completed");
        return next;
      });
    },

    async receipts(contextInput:StorageContextInput,{operation_id}:{operation_id?:string}={}){
      const context=normalizeStorageContext(contextInput);
      const rows=await repository.list(context,{module_id:MODULE,collection:RECEIPTS});
      return Object.freeze(rows.map(r=>structuredClone(r.data as any))
        .filter(r=>!operation_id||r.operation_id===operation_id)
        .sort((a,b)=>Number(a.event_sequence||0)-Number(b.event_sequence||0)||Number(a.created_at||0)-Number(b.created_at||0)));
    }
  });
}
