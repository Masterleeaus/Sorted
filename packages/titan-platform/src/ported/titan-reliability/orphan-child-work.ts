// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/orphan-child-work.mjs
const clean=v=>String(v??'').trim();
const freeze=v=>Object.freeze(v);
const arr=v=>Array.isArray(v)?v:[];
const terminal=new Set(['completed','complete','failed','cancelled','canceled','aborted','terminated']);
export function evaluateOrphanedChildWork({company_id,parents=[],children=[]}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const parentMap=new Map();
  for(const parent of arr(parents)){
    const cid=clean(parent?.company_id); if(cid&&cid!==companyId) throw new Error('cross-company:parent-work');
    const id=clean(parent?.operation_id); if(id) parentMap.set(id, clean(parent?.status).toLowerCase());
  }
  const orphanIds=[], blockedAuthorityIds=[];
  for(const child of arr(children)){
    const cid=clean(child?.company_id); if(cid&&cid!==companyId) throw new Error('cross-company:child-work');
    const childId=clean(child?.operation_id); const parentId=clean(child?.parent_operation_id);
    const childStatus=clean(child?.status).toLowerCase();
    if(!childId || terminal.has(childStatus)) continue;
    const parentStatus=parentMap.get(parentId);
    const orphan=!parentId || parentStatus===undefined || terminal.has(parentStatus);
    if(orphan){ orphanIds.push(childId); if(child?.authority_sensitive===true) blockedAuthorityIds.push(childId); }
  }
  orphanIds.sort(); blockedAuthorityIds.sort();
  return freeze({
    schema:'titan.reliability.orphan-child-work.v1', company_id:companyId,
    orphan_ids:freeze(orphanIds), blocked_authority_ids:freeze(blockedAuthorityIds), orphan_count:orphanIds.length,
    safe_to_continue:orphanIds.length===0, reason:orphanIds.length?'orphaned_child_work':'no_orphaned_child_work',
    auto_reparent:false, auto_replay:false, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
