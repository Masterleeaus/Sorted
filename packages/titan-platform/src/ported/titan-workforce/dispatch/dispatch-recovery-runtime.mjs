import { inspectEffectSubmissions } from '../../titan-reliability/duplicate-effect-guard.mjs';
import { assessRecoveryJournal } from '../../titan-reliability/recovery-journal.mjs';
import { buildStartupRecoveryPlan } from '../../titan-reliability/startup-recovery.mjs';

const text=v=>String(v??'').trim();
const list=v=>Array.isArray(v)?v:[];
const LEGACY=new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId']);
function rejectLegacy(v,path='$'){if(!v||typeof v!=='object')return;if(Array.isArray(v))return v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(input){const id=text(input.company_id);if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id))throw new Error('dispatch-recovery-company_id-required');return id;}
function sameCompany(id,r,label){const c=text(r?.company_id);if(c&&c!==id)throw new Error(`dispatch-recovery-cross-company-${label}`);}
function eventId(e,i){return text(e?.event_id||e?.change_id||e?.id)||`event-${i}`;}
function rev(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isInteger(n)&&n>=0?n:null;}
function stableHash(e){return text(e?.effect_hash||e?.payload_hash||e?.semantic_hash||JSON.stringify({type:e?.event_type||e?.change_kind||null,work_item_id:e?.work_item_id||e?.job_id||null,source_revision:e?.source_revision??null,payload:e?.payload??null}));}

export function assessDispatchRecovery(input={}){
  rejectLegacy(input); const company_id=company(input); const events=list(input.events); const canonicalRevision=rev(input.canonical_job_revision??input.current_job_revision);
  const seenById=new Map(), duplicates=[], conflicts=[];
  events.forEach((e,i)=>{sameCompany(company_id,e,`event:${i}`);const id=eventId(e,i),hash=stableHash(e);if(!seenById.has(id)){seenById.set(id,hash);return;}if(seenById.get(id)===hash)duplicates.push(id);else conflicts.push(id);});
  const stale=[], future=[];
  events.forEach((e,i)=>{const id=eventId(e,i);const r=rev(e?.source_revision??e?.job_revision??e?.revision);if(r===null||canonicalRevision===null)return;if(r<canonicalRevision)stale.push(id);else if(r>canonicalRevision)future.push(id);});

  const effectGuard=inspectEffectSubmissions({company_id,submissions:events.map((e,i)=>({company_id,operation_id:eventId(e,i),idempotency_key:text(e?.idempotency_key||e?.event_id||e?.change_id),effect_hash:stableHash(e),effectful:e?.effectful!==false}))});
  const journal=assessRecoveryJournal({company_id,entries:list(input.recovery_entries),now:Number(input.now??Date.now()),stale_after_ms:Number(input.stale_after_ms??300000)});
  const startup=buildStartupRecoveryPlan({company_id,dependencies:list(input.dependencies),circuits:list(input.circuits),pending_operations:list(input.pending_operations),now:Number(input.now??Date.now())});

  const duplicateIds=[...new Set([...duplicates,...effectGuard.duplicate_operation_ids])].sort();
  const conflictIds=[...new Set([...conflicts,...effectGuard.conflict_operation_ids])].sort();
  const staleIds=[...new Set(stale)].sort(); const futureIds=[...new Set(future)].sort();
  const quarantine=[...new Set([...journal.quarantine_ids,...startup.blocked_operation_ids])].sort();
  const resume=[...new Set([...journal.preserve_queued_ids,...startup.preserve_queued_operation_ids])].sort();
  const blocked=conflictIds.length>0||staleIds.length>0||futureIds.length>0||quarantine.length>0||effectGuard.missing_key_operation_ids.length>0;
  const review=blocked||duplicateIds.length>0||resume.length>0;
  return Object.freeze({
    schema:'titan.workforce.dispatch.recovery-assessment.v1',company_id,
    state:blocked?'BLOCKED_STALE_OR_CONFLICTING_EVIDENCE':review?'REVIEW_REQUIRED':'CLEAR',
    canonical_job_revision:canonicalRevision,
    duplicate_event_ids:Object.freeze(duplicateIds),conflicting_event_ids:Object.freeze(conflictIds),stale_event_ids:Object.freeze(staleIds),future_revision_event_ids:Object.freeze(futureIds),
    missing_idempotency_event_ids:Object.freeze([...effectGuard.missing_key_operation_ids]),recovery_quarantine_ids:Object.freeze(quarantine),restart_resume_candidate_ids:Object.freeze(resume),
    requires_authoritative_refresh:staleIds.length>0||futureIds.length>0||conflictIds.length>0,
    requires_explicit_resume:resume.length>0||quarantine.length>0,
    canonical_job_state_owned_elsewhere:true,duplicate_detection_advisory_only:true,restart_recovery_advisory_only:true,
    auto_replay:false,automatic_effect_replay:false,automatic_job_state_repair:false,direct_mutation:false,execution_permitted:false,identity_confers_authority:false,grants_authority:false
  });
}

export function buildDispatchRestartRecoveryPlan(input={}){
  const assessment=assessDispatchRecovery(input);
  return Object.freeze({schema:'titan.workforce.dispatch.restart-recovery-plan.v1',company_id:assessment.company_id,state:assessment.state,refresh_job_truth_before_resume:assessment.requires_authoritative_refresh,quarantine_ids:assessment.recovery_quarantine_ids,resume_candidate_ids:assessment.restart_resume_candidate_ids,duplicate_event_ids:assessment.duplicate_event_ids,requires_explicit_resume:assessment.requires_explicit_resume,auto_replay:false,automatic_dispatch:false,automatic_effect_replay:false,direct_mutation:false,execution_permitted:false,grants_authority:false});
}

export function summarizeDispatchRecovery(v={}){return Object.freeze({company_id:v.company_id||null,state:v.state||null,duplicate_count:list(v.duplicate_event_ids).length,conflict_count:list(v.conflicting_event_ids).length,stale_count:list(v.stale_event_ids).length,future_revision_count:list(v.future_revision_event_ids).length,quarantine_count:list(v.recovery_quarantine_ids).length,resume_candidate_count:list(v.restart_resume_candidate_ids).length,auto_replay:false,execution_permitted:false,grants_authority:false});}
