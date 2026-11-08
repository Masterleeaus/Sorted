// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-reliability/evidence-window-completeness.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const clean=v=>String(v??'').trim();
export function assessEvidenceWindowCompleteness({company_id,required_ids=[],observations=[],window_start,window_end}={}){
 const c=clean(company_id); if(!c) throw new Error('company_id-required');
 const start=Number(window_start), end=Number(window_end); const validWindow=Number.isFinite(start)&&Number.isFinite(end)&&end>=start;
 const required=[...new Set((Array.isArray(required_ids)?required_ids:[]).map(clean).filter(Boolean))].sort();
 const seen=new Set(), out=new Set();
 for(const o of Array.isArray(observations)?observations:[]){const cc=clean(o?.company_id); if(cc&&cc!==c) throw new Error('cross-company:evidence'); const id=clean(o?.evidence_id); if(!id)continue; const t=Number(o?.observed_at); if(validWindow&&Number.isFinite(t)&&t>=start&&t<=end) seen.add(id); else out.add(id)}
 const missing=required.filter(id=>!seen.has(id)&&!out.has(id)); const outIds=required.filter(id=>out.has(id)&&!seen.has(id));
 const complete=validWindow&&missing.length===0&&outIds.length===0;
 return Object.freeze({schema:'titan.reliability.evidence-window-completeness.v1',company_id:c,company_boundary:'company_id',window_start:validWindow?start:null,window_end:validWindow?end:null,complete,safe_to_recover:complete,missing_ids:Object.freeze(missing),out_of_window_ids:Object.freeze(outIds),requires_fresh_evidence:!complete,advisory_only:true,auto_recover:false,grants_authority:false,authority_effect:false,changes_permissions:false,changes_autonomy:false});
}
