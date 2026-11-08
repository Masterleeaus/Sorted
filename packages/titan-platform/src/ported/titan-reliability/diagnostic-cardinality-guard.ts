// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/diagnostic-cardinality-guard.mjs
const clean=v=>String(v??'').trim(); const arr=v=>Array.isArray(v)?v:[]; const freeze=v=>Object.freeze(v);
export function planDiagnosticCardinality({company_id,max_series=100,series=[]}={}){
 const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required'); const max=Math.max(0,Math.floor(Number(max_series)||0)); const keys=[];
 for(const s of arr(series)){const cid=clean(s?.company_id); if(cid&&cid!==companyId) throw new Error('cross-company:diagnostic-series'); const key=clean(s?.key); if(key&&!keys.includes(key)) keys.push(key);}
 keys.sort(); const accepted=keys.slice(0,max), rejected=keys.slice(max); return freeze({schema:'titan.reliability.diagnostic-cardinality-guard.v1',company_id:companyId,max_series:max,accepted_keys:freeze(accepted),rejected_keys:freeze(rejected),bounded:true,status:rejected.length?'degraded':'healthy',drops_excess_series:true,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false});
}
