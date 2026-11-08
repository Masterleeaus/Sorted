// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/authority-snapshot-freshness.mjs
const clean=v=>String(v??'').trim();
export function evaluateAuthoritySnapshotFreshness({company_id,snapshot_company_id=null,snapshot_version=null,live_version=null,captured_at=null,now=Date.now(),max_age_ms=30000}={}){
 const c=clean(company_id); if(!c) throw new Error('company_id-required');
 const sc=clean(snapshot_company_id)||c; if(sc!==c) throw new Error('cross-company:authority-snapshot');
 const cv=Number(captured_at), n=Number(now), max=Math.max(0,Number(max_age_ms)||0);
 const ageOk=Number.isFinite(cv)&&Number.isFinite(n)?(n-cv)<=max:false;
 const versionOk=snapshot_version==null||live_version==null?true:String(snapshot_version)===String(live_version);
 const fresh=ageOk&&versionOk;
 return Object.freeze({schema:'titan.reliability.authority-snapshot-freshness.v1',company_id:c,company_boundary:'company_id',fresh,safe_to_consider:fresh,age_ms:Number.isFinite(cv)&&Number.isFinite(n)?Math.max(0,n-cv):null,version_match:versionOk,advisory_only:true,grants_authority:false,changes_permissions:false,changes_autonomy:false});
}
