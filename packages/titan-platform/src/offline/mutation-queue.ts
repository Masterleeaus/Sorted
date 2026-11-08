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
const QUEUE="mutation-queue";
const DEAD="mutation-dead-letter";
const TRANSIENT=new Set(["network_unavailable","timeout_before_dispatch","provider_unavailable","rate_limited","offline"]);
const AMBIGUOUS=new Set(["unknown_effect_outcome","timeout_after_dispatch","provider_response_lost","effect_status_unknown"]);
const TERMINAL=new Set(["authority_denied","validation_failed","policy_denied","terminal_failure","cancelled"]);
const text=(v:unknown,f:string)=>{const s=String(v??"").trim();if(!s)throw new Error(`${f}-required`);return s;};

function delay(retry:number,base:number,max:number){return Math.min(max,base*(2**Math.max(0,Math.min(10,retry-1))));}
function assertCompany(value:unknown,company_id:string,path="queue"):void{
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){value.forEach((x,i)=>assertCompany(x,company_id,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value as Record<string,unknown>)){
    if(k==="company_id"&&v!=null&&String(v).trim()!==company_id)throw new Error(`cross-company:${path}.company_id`);
    assertCompany(v,company_id,`${path}.${k}`);
  }
}

export function createOfflineMutationQueue({
  repository,clock=()=>Date.now(),base_delay_ms=1000,max_delay_ms=60000,max_retries=5,max_pending=256,
}:{
  repository:Repo; clock?:()=>number; base_delay_ms?:number; max_delay_ms?:number; max_retries?:number; max_pending?:number;
}){
  if(!repository?.put||!repository?.list||typeof repository.transaction!=="function")throw new Error("transaction-capable canonical repository required");
  const descriptor=Object.freeze({
    protocol:"titan.offline.mutation-queue.v1" as const,
    company_boundary:"company_id" as const,
    durable:true, bounded:true, poison_isolation:true,
    retry_backoff:"exponential_bounded" as const,
    automatic_effect_replay:false,
    identity_grants_authority:false,
    execution_authority:false,
  });

  async function rows(context:StorageContextInput,collection=QUEUE){
    return repository.list(context,{module_id:MODULE,collection});
  }

  return Object.freeze({
    descriptor,
    async enqueue(contextInput:StorageContextInput,input:Readonly<{
      operation_id:string; idempotency_key:string; mutation_kind:string; target:string; payload?:unknown;
    }>){
      assertNoLegacyStorageBoundary(input,"offline-queue");
      const context=normalizeStorageContext(contextInput); assertCompany(input,context.company_id);
      const operation_id=text(input.operation_id,"operation_id");
      const existing=await repository.get(context,MODULE,QUEUE,operation_id);
      if(existing?.data)return Object.freeze({status:"duplicate" as const,item:structuredClone(existing.data as object)});
      const pending=(await rows(context)).filter(r=>!["completed","dead_letter"].includes(String((r.data as any)?.state)));
      if(pending.length>=max_pending)throw new Error("offline-queue-backpressure");
      const now=Number(clock());
      const item=Object.freeze({
        schema:"titan.offline.mutation-queue-item.v1",
        company_id:context.company_id,operation_id,
        idempotency_key:text(input.idempotency_key,"idempotency_key"),
        mutation_kind:text(input.mutation_kind,"mutation_kind").toLowerCase(),
        target:text(input.target,"target"),payload:structuredClone(input.payload??null),
        state:"queued" as const,retry_count:0,max_retries,
        next_retry_at:now,created_at:now,updated_at:now,last_error:null,
        automatic_effect_replay:false,effect_replay_allowed:false,authority_neutral:true,grants_authority:false,
      });
      await repository.put({...context,idempotency_key:null},{module_id:MODULE,collection:QUEUE,record_id:operation_id,data:item});
      return Object.freeze({status:"queued" as const,item});
    },

    async due(contextInput:StorageContextInput,at=clock()){
      const context=normalizeStorageContext(contextInput);
      const list=(await rows(context)).map(r=>r.data as any)
        .filter(x=>["queued","retry_wait"].includes(String(x.state))&&Number(x.next_retry_at??0)<=Number(at))
        .sort((a,b)=>Number(a.created_at)-Number(b.created_at)||String(a.operation_id).localeCompare(String(b.operation_id)));
      return Object.freeze(list.map(x=>structuredClone(x)));
    },

    async resolve(contextInput:StorageContextInput,operationId:string,outcome:Readonly<{ok:boolean;failure_class?:string;error?:string}>){
      assertNoLegacyStorageBoundary(outcome,"offline-queue-outcome");
      const context=normalizeStorageContext(contextInput); const operation_id=text(operationId,"operation_id");
      return repository.transaction({...context,operation_id,idempotency_key:null},async(tx,txContext)=>{
        const storageContext=Object.freeze({...txContext,idempotency_key:null});
        const row=await tx.get(storageContext,MODULE,QUEUE,operation_id);
        if(!row?.data)throw new Error("offline-queue-item-not-found");
        const prior=row.data as any; if(prior.company_id!==txContext.company_id)throw new Error("cross-company:offline-queue-item");
        if(prior.state==="completed"||prior.state==="dead_letter")return structuredClone(prior);
        const now=Number(clock());
        if(outcome.ok){
          const next=Object.freeze({...structuredClone(prior),state:"completed",completed_at:now,updated_at:now,next_retry_at:null,last_error:null});
          await tx.put(storageContext,{module_id:MODULE,collection:QUEUE,record_id:operation_id,expected_revision:row.version,data:next});
          return next;
        }
        const failure_class=text(outcome.failure_class,"failure_class").toLowerCase();
        const retry_count=Number(prior.retry_count||0);
        const poison=AMBIGUOUS.has(failure_class)||TERMINAL.has(failure_class)||(!TRANSIENT.has(failure_class));
        const exhausted=retry_count>=Number(prior.max_retries??max_retries);
        if(poison||exhausted){
          const dead=Object.freeze({...structuredClone(prior),state:"dead_letter",dead_lettered_at:now,updated_at:now,
            failure_class,last_error:String(outcome.error??failure_class),next_retry_at:null,requires_review:true});
          await tx.put(storageContext,{module_id:MODULE,collection:QUEUE,record_id:operation_id,expected_revision:row.version,data:dead});
          await tx.put(storageContext,{module_id:MODULE,collection:DEAD,record_id:operation_id,data:dead});
          return dead;
        }
        const nextRetry=retry_count+1;
        const next=Object.freeze({...structuredClone(prior),state:"retry_wait",retry_count:nextRetry,
          failure_class,last_error:String(outcome.error??failure_class),updated_at:now,
          next_retry_at:now+delay(nextRetry,base_delay_ms,max_delay_ms),requires_review:false});
        await tx.put(storageContext,{module_id:MODULE,collection:QUEUE,record_id:operation_id,expected_revision:row.version,data:next});
        return next;
      });
    },

    async list(contextInput:StorageContextInput){const context=normalizeStorageContext(contextInput);return Object.freeze((await rows(context)).map(r=>structuredClone(r.data as object)));},
    async deadLetters(contextInput:StorageContextInput){const context=normalizeStorageContext(contextInput);return Object.freeze((await rows(context,DEAD)).map(r=>structuredClone(r.data as object)));},
  });
}
