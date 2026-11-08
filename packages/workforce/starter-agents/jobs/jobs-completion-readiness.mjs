import {missingOperationalPrerequisites} from './jobs-field-context.mjs';
import {evaluateJobEvidence} from './jobs-evidence-policy.mjs';
import {canSilentlyCompleteWithExceptions} from './jobs-exception-runtime.mjs';
const clean=v=>typeof v==='string'?v.trim():'';const list=v=>Array.isArray(v)?v:[];
function context(input){for(const k of ['tenant_id','tenantId','tenant_company_id'])if(input?.[k]!=null)throw new Error(`jobs-readiness-legacy-tenant-forbidden:${k}`);const c=clean(input?.company_id),j=clean(input?.job_id);if(!c)throw new Error('jobs-readiness-company-id-required');if(!j)throw new Error('jobs-readiness-job-id-required');return {company_id:c,job_id:j};}
export function evaluateJobCompletionReadiness(input={},settings={}){
 const c=context(input);const blockers=[];
 if(input.current_state!=='completed'&&input.current_state!=='qa_ready')blockers.push('JOB_NOT_IN_COMPLETION_STATE');
 const prereqs=missingOperationalPrerequisites(input.field_context||{});blockers.push(...prereqs.map(x=>`OPERATIONAL:${x}`));
 const evidence=evaluateJobEvidence({...input.evidence,company_id:c.company_id,job_id:c.job_id,job_company_id:c.company_id},settings.evidence_policy||{});blockers.push(...evidence.blockers.map(x=>`EVIDENCE:${x}`));
 const exceptions=list(input.exceptions);if(!canSilentlyCompleteWithExceptions(exceptions))blockers.push('UNRESOLVED_EXCEPTION_OR_REWORK');
 if(settings.require_supervisor_review===true&&input.supervisor_review_passed!==true)blockers.push('SUPERVISOR_REVIEW_REQUIRED');
 const ready=blockers.length===0;
 return {schema:'titan.zero.jobs.completion-readiness.v1',...c,ready,blockers,evidence_refs:evidence.evidence_refs,operational_prerequisites:prereqs,downstream:ready?{invoice:{eligible:input.request_invoice!==false,capability:'crm.invoice.create',owner:'Titan CRM revenue document authority'},customer_care:{eligible:true,stage:'post_job_followup',authority_neutral:true}}:{invoice:{eligible:false},customer_care:{eligible:false}},authority_granted:false,execution_permitted:false};
}
export function buildCompletionHandoffs(readiness={},input={}){const c=context({...input,company_id:readiness.company_id,job_id:readiness.job_id});if(!readiness.ready)throw new Error('jobs-readiness-handoff-blocked');const common={company_id:c.company_id,job_id:c.job_id,completion_ref:clean(input.completion_ref)||null,evidence_refs:[...list(readiness.evidence_refs)],source:'Jobs Agent',authority_granted:false};const out=[];if(readiness.downstream?.invoice?.eligible)out.push({...common,schema:'titan.zero.jobs.invoice-handoff.v1',destination:'Invoicing Agent / Titan CRM',capability:'crm.invoice.create',execution_permitted:false});out.push({...common,schema:'titan.zero.jobs.customer-care-handoff.v1',destination:'Customer Care Agent',stage:'post_job_followup',execution_permitted:false});return out;}
