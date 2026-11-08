const clean=v=>typeof v==='string'?v.trim():'';const list=v=>Array.isArray(v)?v:[];
export const DEFAULT_JOBS_SETTINGS=Object.freeze({
 required_evidence:{require_checklist:true,min_attachments:0,require_signature:false,require_exception_note_when_damage:true,require_blocked_evidence:true},
 status_policy:{allow_reopen_from_completed:true,allow_reopen_from_qa_ready:true,auto_progress:false,max_auto_progress_steps:0},
 exception_thresholds:{cost_variation_review:0,time_variation_review_minutes:30,safety_always_escalates:true},
 completion:{require_supervisor_review:false,require_close_authority:true},
 checklist:{required_item_failure_blocks_completion:true}
});
function assertCompany(input){for(const k of ['tenant_id','tenantId','tenant_company_id'])if(input?.[k]!=null)throw new Error(`jobs-settings-legacy-tenant-forbidden:${k}`);const c=clean(input?.company_id);if(!c)throw new Error('jobs-settings-company-id-required');return c;}
function bool(v,d){return typeof v==='boolean'?v:d;}function num(v,d,min=0,max=1e9){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):d;}
export function compileJobsSettings(input={}){
 const company_id=assertCompany(input),r=input.required_evidence||{},s=input.status_policy||{},e=input.exception_thresholds||{},c=input.completion||{},q=input.checklist||{};
 const settings={required_evidence:{require_checklist:bool(r.require_checklist,true),min_attachments:num(r.min_attachments,0,0,20),require_signature:bool(r.require_signature,false),require_exception_note_when_damage:bool(r.require_exception_note_when_damage,true),require_blocked_evidence:bool(r.require_blocked_evidence,true)},status_policy:{allow_reopen_from_completed:bool(s.allow_reopen_from_completed,true),allow_reopen_from_qa_ready:bool(s.allow_reopen_from_qa_ready,true),auto_progress:bool(s.auto_progress,false),max_auto_progress_steps:num(s.max_auto_progress_steps,0,0,2)},exception_thresholds:{cost_variation_review:num(e.cost_variation_review,0,0),time_variation_review_minutes:num(e.time_variation_review_minutes,30,0,1440),safety_always_escalates:true},completion:{require_supervisor_review:bool(c.require_supervisor_review,false),require_close_authority:true},checklist:{required_item_failure_blocks_completion:true}};
 if(settings.status_policy.auto_progress&&settings.status_policy.max_auto_progress_steps<1)settings.status_policy.max_auto_progress_steps=1;
 return {schema:'titan.zero.jobs.settings.v1',company_id,settings,immutable_guards:{company_boundary:'company_id',ai_identity_confers_authority:false,close_authority_required:true,safety_escalation_cannot_be_disabled:true,required_checklist_failure_cannot_be_ignored:true},authority_granted:false};
}
export function jobsSettingsToPolicies(compiled={}){if(!compiled.company_id)throw new Error('jobs-settings-compiled-required');return {company_id:compiled.company_id,evidence_policy:{...compiled.settings.required_evidence},completion_policy:{require_supervisor_review:compiled.settings.completion.require_supervisor_review},exception_policy:{...compiled.settings.exception_thresholds},status_policy:{...compiled.settings.status_policy},authority_granted:false};}
