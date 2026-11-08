import {compileJobCreationContext,dedupeJobCreation} from './jobs-context-bridge.mjs';
import {evaluateJobTransition} from './jobs-lifecycle-contract.mjs';
import {buildWorkOrderTransitionCommand,applyWorkOrderTransitionResult} from './jobs-work-order-adapter.mjs';
import {buildJobFieldContext} from './jobs-field-context.mjs';
import {buildOfflineJobMutation,assessOfflineReplay,detectJobRevisionConflict} from './jobs-offline-sync.mjs';
import {evaluateJobEvidence,createJobEvidenceHandoff} from './jobs-evidence-policy.mjs';
import {classifyJobException,planExceptionResolution} from './jobs-exception-runtime.mjs';
import {evaluateJobCompletionReadiness,buildCompletionHandoffs} from './jobs-completion-readiness.mjs';
import {compileJobsSettings,jobsSettingsToPolicies} from './jobs-settings.mjs';

const clean=v=>typeof v==='string'?v.trim():'';
function company(input){for(const k of ['tenant_id','tenantId','tenant_company_id'])if(input?.[k]!=null)throw new Error(`jobs-runtime-legacy-tenant-forbidden:${k}`);const c=clean(input?.company_id);if(!c)throw new Error('jobs-runtime-company-id-required');return c;}

export function createJobsAgentRuntime({clock=()=>new Date().toISOString()}={}){
 const metrics=new Map();
 const bump=(company_id,key)=>{const m=metrics.get(company_id)||{proposals:0,denials:0,completions_ready:0,completions_blocked:0,exceptions:0,offline_conflicts:0};m[key]=(m[key]||0)+1;metrics.set(company_id,m);};
 const scoped=input=>company(input);
 return Object.freeze({
  schema:'titan.zero.jobs.agent-runtime.v1',
  worker:'Jobs Agent',
  canonical_owner:'Titan Field',
  company_boundary:'company_id',
  authority_model:'external-only',
  compileCreation(input){const c=scoped(input);const compiled=compileJobCreationContext(input);bump(c,'proposals');return {...compiled,proposal_only:true,requires_command_bus:true,authority_granted:false,execution_permitted:false};},
  dedupeCreation(existing,compiled){return dedupeJobCreation(existing,compiled);},
  evaluateTransition(input){const c=scoped(input);const d=evaluateJobTransition(input);if(!d.allowed)bump(c,'denials');return d;},
  buildTransitionProposal(input){const c=scoped(input);const p=buildWorkOrderTransitionCommand(input);if(p.status==='DENIED')bump(c,'denials');else bump(c,'proposals');return p;},
  applyTransitionResult(command,result){return applyWorkOrderTransitionResult(command,result);},
  buildFieldContext(input){scoped(input);return buildJobFieldContext(input);},
  buildOfflineMutation(input){scoped(input);return buildOfflineJobMutation(input);},
  assessOfflineReplay(record,failureClass,options){const c=scoped(record);const r=assessOfflineReplay(record,failureClass,options);if(r.conflict||r.prompt_user)bump(c,'offline_conflicts');return r;},
  detectRevisionConflict(input){const c=scoped(input);const r=detectJobRevisionConflict(input);if(r.conflict)bump(c,'offline_conflicts');return r;},
  evaluateEvidence(input,policy){scoped(input);return evaluateJobEvidence(input,policy);},
  buildEvidenceHandoff(input,evaluation){scoped(input);return createJobEvidenceHandoff(input,evaluation);},
  classifyException(input){const c=scoped(input);bump(c,'exceptions');return classifyJobException(input);},
  planExceptionResolution(exception,input){if(input?.company_id)scoped(input);return planExceptionResolution(exception,input);},
  compileSettings(input){scoped(input);return compileJobsSettings(input);},
  settingsToPolicies(compiled){return jobsSettingsToPolicies(compiled);},
  evaluateCompletion(input,settings){const c=scoped(input);const r=evaluateJobCompletionReadiness(input,settings);bump(c,r.ready?'completions_ready':'completions_blocked');return r;},
  buildCompletionHandoffs(readiness,input){scoped({...input,company_id:readiness.company_id});return buildCompletionHandoffs(readiness,input);},
  diagnostics({company_id}){const c=company({company_id});return {schema:'titan.zero.jobs.diagnostics.v1',company_id:c,worker:'Jobs Agent',generated_at:clock(),metrics:{...(metrics.get(c)||{proposals:0,denials:0,completions_ready:0,completions_blocked:0,exceptions:0,offline_conflicts:0})},authority_granted:false,execution_permitted:false,canonical_owner:'Titan Field'};}
 });
}
