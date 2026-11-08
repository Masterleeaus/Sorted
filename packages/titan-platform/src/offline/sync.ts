import {
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
  type StorageContextInput,
} from "../storage/contracts.js";
import { createStorageReconciler } from "../storage/reconciliation.js";

type Repo = Readonly<{
  put(context: StorageContextInput,input: Readonly<{module_id:string;collection:string;record_id:string;expected_revision?:number;data?:unknown}>): Promise<any>;
  get(context: StorageContextInput,module_id:string,collection:string,record_id:string): Promise<any>;
  list(context: StorageContextInput,query?:Readonly<{module_id?:string;collection?:string}>): Promise<readonly any[]>;
}>;

const META_MODULE="titan.offline";
const META_COLLECTION="sync-state";
const text=(v:unknown,f:string)=>{const s=String(v??"").trim();if(!s)throw new Error(`${f}-required`);return s;};

function assertCompany(value:unknown,company_id:string,path="sync"):void{
  assertNoLegacyStorageBoundary(value,path);
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){value.forEach((x,i)=>assertCompany(x,company_id,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value as Record<string,unknown>)){
    if(k==="company_id"&&v!=null&&String(v).trim()!==company_id)throw new Error(`cross-company:${path}.company_id`);
    assertCompany(v,company_id,`${path}.${k}`);
  }
}
function key(module_id:string,collection:string){return `${module_id}:${collection}`;}

export function createOfflineSyncCoordinator({repository,clock=()=>Date.now()}:{repository:Repo;clock?:()=>number}){
  if(!repository?.put||!repository?.get||!repository?.list)throw new Error("canonical repository required");
  const reconciler=createStorageReconciler({repository,clock});
  const descriptor=Object.freeze({
    protocol:"titan.offline.sync.v1" as const,
    company_boundary:"company_id" as const,
    local_primary:true,
    explicit_conflicts:true,
    snapshot_cursor_durable:true,
    server_grants_authority:false,
    identity_grants_authority:false,
    execution_authority:false,
  });

  async function readState(contextInput:StorageContextInput,module_id:string,collection:string){
    const context=normalizeStorageContext(contextInput);
    const row=await repository.get(context,META_MODULE,META_COLLECTION,key(module_id,collection));
    return row?.data ? structuredClone(row.data) : null;
  }

  async function writeState(contextInput:StorageContextInput,module_id:string,collection:string,patch:Record<string,unknown>){
    const context=normalizeStorageContext(contextInput);
    const id=key(module_id,collection);
    const prior=await repository.get(context,META_MODULE,META_COLLECTION,id);
    const next=Object.freeze({
      schema:"titan.offline.sync-state.v1",
      cursor:null,generation:0,last_pull_at:null,last_apply_at:null,
      ...(prior?.data?structuredClone(prior.data):{}),...structuredClone(patch),
      company_id:context.company_id,module_id,collection,
      authority_neutral:true,grants_authority:false,
    });
    await repository.put({...context,idempotency_key:null},{
      module_id:META_MODULE,collection:META_COLLECTION,record_id:id,
      expected_revision:prior?.version??0,data:next
    });
    return next;
  }

  return Object.freeze({
    descriptor,
    readState,

    async snapshot(contextInput:StorageContextInput,{module_id,collection}:{module_id:string;collection:string}){
      const context=normalizeStorageContext(contextInput);
      const mod=text(module_id,"module_id"), coll=text(collection,"collection");
      const rows=await repository.list(context,{module_id:mod,collection:coll});
      const records=rows.map(row=>{
        const data=row.data as any;
        return Object.freeze({
          company_id:context.company_id,module_id:mod,collection:coll,record_id:row.record_id,
          revision:Number(data?.revision??0),dirty:Boolean(data?.dirty),data:structuredClone(data?.payload??data??null)
        });
      }).sort((a,b)=>a.record_id.localeCompare(b.record_id));
      return Object.freeze({
        schema:"titan.offline.snapshot.v1",company_id:context.company_id,module_id:mod,collection:coll,
        records:Object.freeze(records),generated_at:Number(clock()),
        authority_neutral:true,grants_authority:false
      });
    },

    async applyPull(contextInput:StorageContextInput,input:Readonly<{
      company_id?:string;module_id:string;collection:string;cursor?:string|null;generation:number;
      records:readonly Readonly<{record_id:string;revision:number;data?:unknown}>[];
    }>){
      const context=normalizeStorageContext(contextInput); assertCompany(input,context.company_id,"sync.pull");
      const module_id=text(input.module_id,"module_id"),collection=text(input.collection,"collection");
      const generation=Number(input.generation);
      if(!Number.isInteger(generation)||generation<0)throw new Error("sync generation must be a non-negative integer");
      const state=await readState(context,module_id,collection);
      const currentGeneration=Number(state?.generation??0);
      if(generation<currentGeneration){
        return Object.freeze({status:"stale_generation" as const,generation,current_generation:currentGeneration,results:Object.freeze([])});
      }

      const seen=new Set<string>(); const results:any[]=[];
      for(const record of input.records){
        assertCompany(record,context.company_id,"sync.pull.record");
        const record_id=text(record.record_id,"record_id");
        if(seen.has(record_id))throw new Error(`duplicate remote record: ${record_id}`);
        seen.add(record_id);
        results.push(await reconciler.applyRemote(context,{
          company_id:context.company_id,module_id,collection,record_id,
          revision:Number(record.revision),data:record.data??null
        }));
      }

      const conflicts=results.filter(r=>r.status==="conflict").length;
      const next=await writeState(context,module_id,collection,{
        generation,
        cursor:input.cursor==null?null:String(input.cursor),
        last_pull_at:Number(clock()),
        last_apply_at:Number(clock()),
        last_result:Object.freeze({
          applied:results.filter(r=>r.status==="remote_applied").length,
          acknowledged:results.filter(r=>r.status==="acknowledged").length,
          already_current:results.filter(r=>r.status==="already_current").length,
          stale:results.filter(r=>r.status==="remote_stale").length,
          conflicts,
        })
      });
      return Object.freeze({status:conflicts?"conflicts" as const:"applied" as const,generation,cursor:next.cursor,results:Object.freeze(results)});
    },

    async writeLocal(contextInput:StorageContextInput,input:Readonly<{
      module_id:string;collection:string;record_id:string;revision?:number;data?:unknown;
    }>){
      return reconciler.writeLocal(contextInput,{...input,dirty:true});
    },

    async listConflicts(contextInput:StorageContextInput){return reconciler.listConflicts(contextInput);},
  });
}
