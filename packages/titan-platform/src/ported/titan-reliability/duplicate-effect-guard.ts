// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/duplicate-effect-guard.mjs
const clean=v=>String(v??'').trim(); const arr=v=>Array.isArray(v)?v:[];
export function inspectEffectSubmissions({company_id,submissions=[]}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const byKey=new Map(); const duplicates=[]; const conflicts=new Set(); const missing=[];
  for(let i=0;i<arr(submissions).length;i++){
    const s=submissions[i]||{}; const sc=clean(s.company_id); if(sc&&sc!==companyId) throw new Error(`cross-company:duplicate-effect:${clean(s.operation_id)||i}`);
    const id=clean(s.operation_id||s.id)||`operation-${i}`; const key=clean(s.idempotency_key); const hash=clean(s.effect_hash);
    if(!key){ if(s.effectful!==false) missing.push(id); continue; }
    if(!byKey.has(key)){ byKey.set(key,{id,hash}); continue; }
    const first=byKey.get(key); if(first.hash===hash){ duplicates.push(id); } else { conflicts.add(first.id); conflicts.add(id); }
  }
  const duplicateIds=[...duplicates].sort(); const conflictIds=[...conflicts].sort(); const missingIds=[...missing].sort(); const safe=duplicateIds.length===0&&conflictIds.length===0&&missingIds.length===0;
  return Object.freeze({schema:'titan.reliability.duplicate-effect-guard.v1',company_id:companyId,company_boundary:'company_id',duplicate_operation_ids:Object.freeze(duplicateIds),conflict_operation_ids:Object.freeze(conflictIds),missing_key_operation_ids:Object.freeze(missingIds),safe_to_execute:safe,advisory_only:true,executable_actions:Object.freeze([]),requires_explicit_resolution:!safe,authority_neutral:true,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false});
}
