// @ts-nocheck
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from '../boundary.js';
import { createGovernedCapabilityIntent, dispatchGovernedCapabilityIntent } from './capability-intent-bridge.js';

const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new TypeError(`${n}-required`);return s;};

export function createInteractionOfflineCommandBridge({operation_registry,mutation_queue,gateway,clock=()=>Date.now()}){
  if(!operation_registry?.prepare||!operation_registry?.transition)throw new TypeError('canonical-offline-operation-registry-required');
  if(!mutation_queue?.enqueue||!mutation_queue?.due||!mutation_queue?.resolve)throw new TypeError('canonical-offline-mutation-queue-required');
  const descriptor=Object.freeze({protocol:'titan.interaction.offline-command-bridge.v1',company_boundary:'company_id',
    reuses_canonical_offline_runtime:true,automatic_effect_replay:false,reconnect_revalidation_required:true,
    authority_neutral:true,execution_authority:false});
  return Object.freeze({descriptor,
    async enqueue(context,command){
      rejectLegacyTenantAuthority(context,'interaction-offline-context');
      const company_id=assertCanonicalCompanyId(context.company_id??command?.metadata?.company_id);
      const intent=createGovernedCapabilityIntent(command,{...context,company_id});
      const operation_id=text(context.operation_id??intent.trusted_context.correlation_id,'operation_id');
      const idempotency_key=text(intent.trusted_context.idempotency_key,'idempotency_key');
      const storage={...context,company_id,operation_id,idempotency_key};
      const prepared=await operation_registry.prepare(storage,{operation_id,idempotency_key,mutation_kind:'capability_intent',target:intent.capability,payload:intent});
      if(prepared.conflict)return Object.freeze({status:'conflict',prepared,authority_neutral:true});
      const queued=await mutation_queue.enqueue(storage,{operation_id,idempotency_key,mutation_kind:'capability_intent',target:intent.capability,payload:intent});
      await operation_registry.transition({...storage,idempotency_key:null},operation_id,'queued',{queued_at:Number(clock())});
      return Object.freeze({status:queued.status,operation_id,idempotency_key,intent,queue_item:queued.item,authority_neutral:true});
    },
    async replayDue(context,{revalidate,limit=32}={}){
      rejectLegacyTenantAuthority(context,'interaction-offline-replay-context');
      const company_id=assertCanonicalCompanyId(context.company_id);
      if(typeof revalidate!=='function')throw new TypeError('reconnect-revalidation-required');
      const due=(await mutation_queue.due(context)).slice(0,Math.max(1,Number(limit)||32));
      const results=[];
      for(const item of due){
        if(item.company_id!==company_id)throw new Error('Cross-company offline replay rejected');
        const intent=item.payload;
        const validation=await revalidate(Object.freeze({company_id,intent:structuredClone(intent),queue_item:structuredClone(item)}));
        if(!validation?.allowed){
          const resolved=await mutation_queue.resolve(context,item.operation_id,{ok:false,failure_class:'authority_denied',error:String(validation?.reason??'revalidation-denied')});
          await operation_registry.transition({...context,operation_id:item.operation_id,idempotency_key:null},item.operation_id,'failed',{reason:String(validation?.reason??'revalidation-denied')});
          results.push(Object.freeze({operation_id:item.operation_id,status:'denied',queue_item:resolved}));continue;
        }
        try{
          await operation_registry.transition({...context,operation_id:item.operation_id,idempotency_key:null},item.operation_id,'submitted',{submitted_at:Number(clock())});
          const result=await dispatchGovernedCapabilityIntent(intent,gateway);
          const resolved=await mutation_queue.resolve(context,item.operation_id,{ok:true});
          await operation_registry.transition({...context,operation_id:item.operation_id,idempotency_key:null},item.operation_id,'committed',{committed_at:Number(clock()),receipt:result});
          results.push(Object.freeze({operation_id:item.operation_id,status:'committed',result,queue_item:resolved}));
        }catch(error){
          const failure_class=String(error?.failure_class??error?.code??'unknown_effect_outcome').toLowerCase();
          const resolved=await mutation_queue.resolve(context,item.operation_id,{ok:false,failure_class,error:String(error?.message??error)});
          const terminal=resolved.state==='dead_letter';
          if(terminal)await operation_registry.transition({...context,operation_id:item.operation_id,idempotency_key:null},item.operation_id,'failed',{failure_class,error:String(error?.message??error)});
          results.push(Object.freeze({operation_id:item.operation_id,status:terminal?'dead_letter':'retry_wait',error:String(error?.message??error),queue_item:resolved}));
        }
      }
      return Object.freeze({company_id,processed:results.length,results:Object.freeze(results),authority_neutral:true});
    }
  });
}
