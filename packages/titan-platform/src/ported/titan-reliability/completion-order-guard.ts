// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/completion-order-guard.mjs
const clean=v=>String(v??'').trim(); const arr=v=>Array.isArray(v)?v:[]; const freeze=v=>Object.freeze(v);
export function evaluateCompletionOrder({company_id,events=[]}={}){
 const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required'); const last=new Map(); const bad=new Set();
 for(const e of arr(events)){const cid=clean(e?.company_id); if(cid&&cid!==companyId) throw new Error('cross-company:completion-event'); const id=clean(e?.operation_id)||'unknown'; const seq=Number(e?.sequence); if(!Number.isFinite(seq)){bad.add(id); continue;} const prev=last.get(id); if(prev!==undefined&&seq<=prev) bad.add(id); last.set(id,seq);}
 const ids=[...bad].sort(); return freeze({schema:'titan.reliability.completion-order-guard.v1',company_id:companyId,out_of_order_operation_ids:freeze(ids),safe_to_apply:ids.length===0,reason:ids.length?'completion_order_violation':'completion_order_valid',auto_apply:false,auto_replay:false,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false});
}
