// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/superseded-plan-guard.mjs
const clean=v=>String(v??'').trim();
export function evaluateSupersededRecoveryPlan({company_id,plan_id,plan_version,latest_plan_id,latest_plan_version}={}){
 const c=clean(company_id); if(!c) throw new Error('company_id-required');
 const id=clean(plan_id), latestId=clean(latest_plan_id);
 const version=Number.isFinite(Number(plan_version))?Number(plan_version):null;
 const latestVersion=Number.isFinite(Number(latest_plan_version))?Number(latest_plan_version):null;
 const superseded=(latestVersion!==null&&version!==null&&version<latestVersion) || (!!latestId&&!!id&&latestId!==id&&latestVersion!==null&&(version===null||latestVersion>=version));
 return Object.freeze({schema:'titan.reliability.superseded-plan-guard.v1',company_id:c,company_boundary:'company_id',plan_id:id||null,plan_version:version,latest_plan_id:latestId||null,latest_plan_version:latestVersion,superseded,allowed:!!id&&!superseded,requires_fresh_plan:superseded,auto_execute:false,advisory_only:true,grants_authority:false,authority_effect:false,changes_permissions:false,changes_autonomy:false});
}
