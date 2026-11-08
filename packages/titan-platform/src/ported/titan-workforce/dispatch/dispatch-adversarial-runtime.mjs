import { assessDispatchRecovery } from './dispatch-recovery-runtime.mjs';

const text=v=>String(v??'').trim();
const list=v=>Array.isArray(v)?v:[];
const LEGACY=new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId']);
const ACTIVE=new Set(['proposed','assigned','dispatched','en_route','arrived','in_progress']);
const TERMINAL=new Set(['completed','cancelled','canceled','rejected','expired']);
const URGENT=new Set(['urgent','critical','emergency']);
function rejectLegacy(v,path='$'){if(!v||typeof v!=='object')return;if(Array.isArray(v))return v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(input){const id=text(input.company_id);if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id))throw new Error('dispatch-adversarial-company_id-required');return id;}
function scoped(company_id,rows,label){return list(rows).map((r,i)=>{const c=text(r?.company_id);if(c&&c!==company_id)throw new Error(`dispatch-adversarial-cross-company-${label}:${i}`);return r||{};});}
function workId(x={}){return text(x.work_item_id||x.job_id||x.work_order_id||x.id);}
function assignmentId(x={}){return text(x.assignment_id||x.public_id||x.id);}
function state(x={}){return text(x.state||x.status||x.decision_state).toLowerCase();}
function revision(x={}){const n=Number(x.revision??x.source_revision??x.job_revision);return Number.isInteger(n)&&n>=0?n:null;}
function urgency(x={}){const u=text(x.urgency||x.priority).toLowerCase();const n=Number(x.priority);return URGENT.has(u)||(Number.isFinite(n)&&n>=4);}
function finding(company_id,type,severity,work_item_id,details={},next='HUMAN_REVIEW'){const suffix=text(work_item_id)||'none';return Object.freeze({finding_id:`dispatch-adversarial:${company_id}:${type.toLowerCase()}:${suffix}`,type,severity,work_item_id:work_item_id||null,recommended_next_step:next,...details});}
function activeAssignments(rows,id){return rows.filter(a=>workId(a)===id&&ACTIVE.has(state(a))).sort((a,b)=>assignmentId(a).localeCompare(assignmentId(b)));}
function overlap(a,b){const as=Number(a?.scheduled_start_ms),ae=Number(a?.scheduled_end_ms),bs=Number(b?.scheduled_start_ms),be=Number(b?.scheduled_end_ms);return [as,ae,bs,be].every(Number.isFinite)&&as<be&&bs<ae;}

export function assessDispatchAdversarialScenario(input={}){
  rejectLegacy(input);const company_id=company(input);
  const work=scoped(company_id,input.work_items||input.jobs,'work-item');
  const assignments=scoped(company_id,input.assignments,'assignment');
  const events=scoped(company_id,input.events,'event');
  const findings=[];const seenWork=new Set();
  for(const w of work){const id=workId(w);if(!id)throw new Error('dispatch-adversarial-work_item_id-required');if(seenWork.has(id))throw new Error('dispatch-adversarial-duplicate-work-item');seenWork.add(id);const active=activeAssignments(assignments,id);const ws=state(w);
    if(urgency(w)&&!TERMINAL.has(ws)&&active.length===0)findings.push(finding(company_id,'URGENT_UNASSIGNED','CRITICAL',id,{priority:w.priority??w.urgency??null},'HUMAN_REVIEW_GOVERNED_ASSIGNMENT'));
    if(active.length>1){const revisions=active.map(revision).filter(x=>x!==null);const uniqueWorkers=[...new Set(active.map(a=>text(a.worker_id||a.worker_user_id)).filter(Boolean))];findings.push(finding(company_id,'MULTIPLE_ACTIVE_ASSIGNMENTS','HIGH',id,{assignment_ids:active.map(assignmentId),worker_ids:uniqueWorkers},'REFRESH_CANONICAL_ASSIGNMENT_TRUTH'));
      if(uniqueWorkers.length>1||new Set(revisions).size>1)findings.push(finding(company_id,'REASSIGNMENT_RACE','CRITICAL',id,{assignment_ids:active.map(assignmentId),assignment_revisions:revisions},'BLOCK_AND_REEVALUATE_GOVERNED_REASSIGNMENT'));
    }
    if((ws==='cancelled'||ws==='canceled')&&active.length>0)findings.push(finding(company_id,'CANCELLED_WITH_ACTIVE_ASSIGNMENT','CRITICAL',id,{assignment_ids:active.map(assignmentId)},'REFRESH_JOB_AND_ASSIGNMENT_TRUTH_BEFORE_ANY_ACTION'));
  }
  const byWorker=new Map();for(const a of assignments){if(!ACTIVE.has(state(a)))continue;const worker=text(a.worker_id||a.worker_user_id);if(!worker)continue;if(!byWorker.has(worker))byWorker.set(worker,[]);byWorker.get(worker).push(a);}
  for(const [worker,rows] of byWorker){rows.sort((a,b)=>workId(a).localeCompare(workId(b)));for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){if(workId(rows[i])!==workId(rows[j])&&overlap(rows[i],rows[j]))findings.push(finding(company_id,'WORKER_OVERLAP_EVIDENCE','HIGH',workId(rows[j]),{worker_id:worker,conflicts_with_work_item_id:workId(rows[i]),evidence_only:true},'DEFER_TO_SCHEDULING_CONFLICT_REVIEW'));}}
  let recovery=null;if(events.length||input.canonical_job_revision!==undefined||list(input.recovery_entries).length||list(input.pending_operations).length){recovery=assessDispatchRecovery({company_id,events,canonical_job_revision:input.canonical_job_revision,recovery_entries:list(input.recovery_entries),pending_operations:list(input.pending_operations),dependencies:list(input.dependencies),circuits:list(input.circuits),now:input.now,stale_after_ms:input.stale_after_ms});
    for(const id of recovery.duplicate_event_ids)findings.push(finding(company_id,'DUPLICATE_EVENT','LOW',null,{event_id:id},'SUPPRESS_DUPLICATE_EFFECT'));
    for(const id of recovery.conflicting_event_ids)findings.push(finding(company_id,'CONFLICTING_EVENT','CRITICAL',null,{event_id:id},'BLOCK_AND_REFRESH_AUTHORITATIVE_TRUTH'));
    for(const id of recovery.stale_event_ids)findings.push(finding(company_id,'STALE_JOB_REVISION','HIGH',null,{event_id:id},'REFRESH_AUTHORITATIVE_JOB_TRUTH'));
    for(const id of recovery.future_revision_event_ids)findings.push(finding(company_id,'FUTURE_JOB_REVISION','HIGH',null,{event_id:id},'REFRESH_AUTHORITATIVE_JOB_TRUTH'));
  }
  const order={CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3};findings.sort((a,b)=>order[a.severity]-order[b.severity]||a.type.localeCompare(b.type)||String(a.work_item_id||'').localeCompare(String(b.work_item_id||''))||a.finding_id.localeCompare(b.finding_id));
  const blocked=findings.some(f=>f.severity==='CRITICAL'&&['REASSIGNMENT_RACE','CANCELLED_WITH_ACTIVE_ASSIGNMENT','CONFLICTING_EVENT'].includes(f.type));
  return Object.freeze({schema:'titan.workforce.dispatch.adversarial-assessment.v1',company_id,state:blocked?'BLOCKED_CONFLICTING_EVIDENCE':findings.length?'REVIEW_REQUIRED':'CLEAR',findings:Object.freeze(findings),summary:Object.freeze({total:findings.length,critical:findings.filter(f=>f.severity==='CRITICAL').length,high:findings.filter(f=>f.severity==='HIGH').length,urgent_unassigned:findings.filter(f=>f.type==='URGENT_UNASSIGNED').length,reassignment_races:findings.filter(f=>f.type==='REASSIGNMENT_RACE').length,cross_company_rejected:true}),recovery_assessment:recovery,requires_human_review:findings.length>0,requires_fresh_authority_evaluation_before_any_mutation:true,scheduling_overlap_evidence_advisory_only:true,canonical_job_state_owned_elsewhere:true,automatic_dispatch:false,automatic_reassignment:false,automatic_cancellation:false,automatic_contact:false,automatic_effect_replay:false,direct_mutation:false,execution_permitted:false,identity_confers_authority:false,role_confers_authority:false,grants_authority:false,authority_effect:false});
}

export function summarizeDispatchAdversarialAssessment(v={}){return Object.freeze({company_id:v.company_id||null,state:v.state||null,total:list(v.findings).length,critical:Number(v.summary?.critical||0),high:Number(v.summary?.high||0),requires_human_review:v.requires_human_review===true,automatic_dispatch:false,automatic_reassignment:false,direct_mutation:false,execution_permitted:false,grants_authority:false});}
