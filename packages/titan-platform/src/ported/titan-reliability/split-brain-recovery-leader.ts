// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/split-brain-recovery-leader.mjs
const clean=v=>String(v??'').trim();
export function detectSplitBrainRecoveryLeader({company_id,claims=[]}={}){
 const c=clean(company_id); if(!c) throw new Error('company_id-required');
 const active=[];
 for(const claim of Array.isArray(claims)?claims:[]){
  const cc=clean(claim?.company_id); if(cc&&cc!==c) throw new Error('cross-company:leader-claim');
  if(claim?.active!==true) continue;
  const id=clean(claim?.leader_id); if(!id) continue;
  const epoch=Number.isFinite(Number(claim?.epoch))?Number(claim.epoch):null;
  active.push({id,epoch});
 }
 const byEpoch=new Map();
 for(const item of active){const key=item.epoch===null?'unknown':String(item.epoch); if(!byEpoch.has(key))byEpoch.set(key,new Set()); byEpoch.get(key).add(item.id)}
 const conflicts=[]; for(const ids of byEpoch.values()) if(ids.size>1) conflicts.push(...ids);
 const unique=[...new Set(conflicts)].sort(); const split=unique.length>1;
 return Object.freeze({schema:'titan.reliability.split-brain-recovery-leader.v1',company_id:c,company_boundary:'company_id',split_brain_detected:split,conflicting_leader_ids:Object.freeze(unique),safe_to_coordinate:!split,requires_explicit_resolution:split,advisory_only:true,auto_elect:false,grants_authority:false,authority_effect:false,changes_permissions:false,changes_autonomy:false});
}
