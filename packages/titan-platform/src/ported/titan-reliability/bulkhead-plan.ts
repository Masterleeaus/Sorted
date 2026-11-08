// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/bulkhead-plan.mjs
const clean=v=>String(v??'').trim(); const arr=v=>Array.isArray(v)?v:[];
export function planBulkheadAdmission({company_id,partitions={default:1},requests=[]}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const caps={}; for(const [k,v] of Object.entries(partitions||{})) caps[clean(k)||'default']=Math.max(0,Math.floor(Number(v)||0));
  if(!Object.keys(caps).length) caps.default=1;
  const groups={}; const normalized=arr(requests).map((r,i)=>{ const rc=clean(r?.company_id); if(rc&&rc!==companyId) throw new Error(`cross-company:bulkhead:${clean(r?.request_id)||i}`); const cls=clean(r?.workload_class)||'default'; const item={id:clean(r?.request_id||r?.id)||`request-${i}`,workload_class:cls,index:i}; (groups[cls]??=[]).push(item); return item; });
  const admitted=[]; const rejected=[]; const status={};
  for(const cls of Object.keys(groups)){ const cap=Object.prototype.hasOwnProperty.call(caps,cls)?caps[cls]:(caps.default??0); const items=groups[cls]; admitted.push(...items.slice(0,cap)); rejected.push(...items.slice(cap)); status[cls]=items.length>cap?'saturated':'healthy'; }
  admitted.sort((a,b)=>a.index-b.index); rejected.sort((a,b)=>a.index-b.index);
  return Object.freeze({schema:'titan.reliability.bulkhead-plan.v1',company_id:companyId,company_boundary:'company_id',partition_capacities:Object.freeze({...caps}),partition_status:Object.freeze({...status}),admit_ids:Object.freeze(admitted.map(x=>x.id)),rejected_ids:Object.freeze(rejected.map(x=>x.id)),advisory_only:true,executable_actions:Object.freeze([]),authority_neutral:true,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false});
}
