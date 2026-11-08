// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/jobs/jobs-evidence-policy.mjs
const clean=v=>typeof v==='string'?v.trim():'';const list=v=>Array.isArray(v)?v:[];const LEGACY=['tenant_id','tenantId','tenant_company_id'];
function requireCompany(input){for(const k of LEGACY)if(input?.[k]!=null)throw new Error(`jobs-evidence-legacy-tenant-forbidden:${k}`);const c=clean(input?.company_id);if(!c)throw new Error('jobs-evidence-company-id-required');return c;}
export const DEFAULT_JOBS_EVIDENCE_POLICY=Object.freeze({require_checklist:true,min_attachments:0,require_signature:false,require_exception_note_when_damage:true,require_blocked_evidence:true});
export function evaluateJobEvidence(input={},policy={}){
 const company_id=requireCompany(input);if(input.job_company_id&&clean(input.job_company_id)!==company_id)throw new Error('jobs-evidence-cross-company-job');const p={...DEFAULT_JOBS_EVIDENCE_POLICY,...policy};const blockers=[];const attachments=list(input.evidence_attachment_ids).map(clean).filter(Boolean);const checklist=list(input.checklist);
 if(p.require_checklist&&checklist.some(x=>x?.required!==false&&x?.completed!==true))blockers.push('REQUIRED_CHECKLIST_INCOMPLETE');
 if(attachments.length<Number(p.min_attachments||0))blockers.push('MINIMUM_EVIDENCE_ATTACHMENTS_NOT_MET');
 if(p.require_signature&&!clean(input.customer_signature))blockers.push('CUSTOMER_SIGNATURE_REQUIRED');
 if(p.require_exception_note_when_damage&&input.damage_reported===true&&!clean(input.exception_notes))blockers.push('DAMAGE_EXCEPTION_NOTE_REQUIRED');
 if(p.require_blocked_evidence&&input.from_state==='blocked'&&!attachments.length&&!clean(input.exception_notes))blockers.push('BLOCKED_STATE_EVIDENCE_REQUIRED');
 const evidence_refs=[...new Set([...attachments,...list(input.evidence_refs).map(clean).filter(Boolean)])];
 return {schema:'titan.zero.jobs.evidence-evaluation.v1',company_id,job_id:clean(input.job_id),ready:blockers.length===0,blockers,evidence_refs,checklist_required:p.require_checklist,signature_required:p.require_signature,damage_exception_note_required:p.require_exception_note_when_damage,authority_granted:false,execution_permitted:false};
}
export function createJobEvidenceHandoff(input={},evaluation={}){const company_id=requireCompany(input);if(evaluation.company_id!==company_id)throw new Error('jobs-evidence-cross-company-evaluation');return {schema:'titan.zero.jobs.evidence-handoff.v1',company_id,job_id:clean(input.job_id),evidence_refs:[...list(evaluation.evidence_refs)],evidence_ready:evaluation.ready===true,blockers:[...list(evaluation.blockers)],source:'Jobs Agent',destination:'Titan Field forms/evidence authority',authority_granted:false};}
