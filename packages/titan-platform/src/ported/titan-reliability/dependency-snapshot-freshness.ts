// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/dependency-snapshot-freshness.mjs
const clean=v=>String(v??'').trim(); const arr=v=>Array.isArray(v)?v:[]; const freeze=v=>Object.freeze(v);
export function evaluateDependencySnapshotFreshness({company_id,now_ms=Date.now(),max_age_ms=60000,snapshots=[]}={}){
 const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
 const now=Number(now_ms), maxAge=Math.max(0,Number(max_age_ms)||0); const stale=[]; const invalid=[];
 for(const s of arr(snapshots)){const sid=clean(s?.company_id); if(sid&&sid!==companyId) throw new Error('cross-company:dependency-snapshot'); const id=clean(s?.dependency_id)||'unknown'; const at=Number(s?.captured_at_ms); if(!Number.isFinite(at)){invalid.push(id); continue;} if(now-at>maxAge||at>now) stale.push(id);}
 const affected=[...new Set([...stale,...invalid])].sort();
 return freeze({schema:'titan.reliability.dependency-snapshot-freshness.v1',company_id:companyId,stale_dependency_ids:freeze(stale.sort()),invalid_dependency_ids:freeze(invalid.sort()),safe_to_decide:affected.length===0,reason:affected.length?'dependency_snapshot_stale_or_invalid':'dependency_snapshots_fresh',rewrites_timestamps:false,auto_refresh:false,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false});
}
