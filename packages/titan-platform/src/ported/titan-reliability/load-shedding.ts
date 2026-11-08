// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/load-shedding.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];
const RANK=Object.freeze({critical:0,high:1,normal:2,low:3,background:4});
function rank(priority){ const p=clean(priority).toLowerCase(); return p in RANK ? RANK[p] : RANK.normal; }
export function planLoadShedding({company_id,capacity,requests=[]}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const cap=Math.max(0,Math.floor(Number(capacity)||0));
  const normalized=arr(requests).map((request,index)=>{
    const requestCompany=clean(request?.company_id); if(requestCompany && requestCompany!==companyId) throw new Error(`cross-company:load-shedding:${clean(request?.request_id)||index}`);
    return {id:clean(request?.request_id||request?.id)||`request-${index}`,priority:clean(request?.priority).toLowerCase()||'normal',authority_sensitive:request?.authority_sensitive===true,index};
  });
  normalized.sort((a,b)=>Number(b.authority_sensitive)-Number(a.authority_sensitive)||rank(a.priority)-rank(b.priority)||a.index-b.index||a.id.localeCompare(b.id));
  const admitted=normalized.slice(0,cap); const shed=normalized.slice(cap);
  return Object.freeze({
    schema:'titan.reliability.load-shedding-plan.v1',company_id:companyId,company_boundary:'company_id',capacity:cap,total_requests:normalized.length,
    admit_ids:Object.freeze(admitted.map(x=>x.id)),shed_ids:Object.freeze(shed.map(x=>x.id).sort()),authority_sensitive_shed_count:shed.filter(x=>x.authority_sensitive).length,
    advisory_only:true,executable_actions:Object.freeze([]),authority_neutral:true,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false,
  });
}
