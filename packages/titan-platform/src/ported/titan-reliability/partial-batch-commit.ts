// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/partial-batch-commit.mjs
const clean=v=>String(v??'').trim();
const arr=v=>Array.isArray(v)?v:[];
const freeze=v=>Object.freeze(v);
export function assessPartialBatchCommit({company_id,batch_id=null,items=[]}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const committed=[], failed=[], unresolved=[];
  for(const item of arr(items)){
    const id=clean(item?.id); if(!id) continue;
    const status=clean(item?.status).toLowerCase();
    if(['committed','applied','complete','completed','success'].includes(status)) committed.push(id);
    else if(['failed','error','rejected'].includes(status)) failed.push(id);
    else unresolved.push(id);
  }
  const complete=items.length>0 && failed.length===0 && unresolved.length===0;
  return freeze({
    schema:'titan.reliability.partial-batch-commit.v1', company_id:companyId,
    batch_id:clean(batch_id)||null, complete, safe_to_finalize:complete,
    committed_ids:freeze(committed), failed_ids:freeze(failed), unresolved_ids:freeze(unresolved),
    reconciliation_required:!complete, automatic_rollback_claimed:false,
    automatic_replay_permitted:false, grants_authority:false, authority_effect:false,
  });
}
