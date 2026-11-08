import { buildCleaningExecutionPack, type CleaningExecutionPackInput } from './execution.js';

export const CLEANING_QA_REVIEW_SCHEMA = 'titan.vertical.cleaning.qa-review.v1' as const;
export type CleaningQaOutcome = 'PASS'|'PASS_WITH_NOTES'|'REWORK_REQUIRED'|'ESCALATION_REQUIRED';

export interface CleaningQaInspectionItemInput {
  item_ref: string;
  area_ref?: string;
  status: 'PASS'|'MISS'|'DEFECT'|'BLOCKED';
  note_ref?: string;
  evidence_refs?: readonly string[];
  severity?: 'LOW'|'MEDIUM'|'HIGH';
}
export interface CleaningCustomerIssueInput {
  issue_ref: string;
  category: 'missed_item'|'damage_concern'|'quality_concern'|'access_issue'|'timing_issue'|'other';
  note_ref: string;
  evidence_refs?: readonly string[];
  customer_requested_followup?: boolean;
}
export interface CleaningQaReviewInput {
  company_id: string;
  job_ref: string;
  execution_pack?: ReturnType<typeof buildCleaningExecutionPack>;
  execution_input?: CleaningExecutionPackInput;
  supervisor_ref: string;
  inspection_ref: string;
  inspection_items: readonly CleaningQaInspectionItemInput[];
  customer_issues?: readonly CleaningCustomerIssueInput[];
  customer_signoff_ref?: string;
  supervisor_signoff_ref?: string;
  quality_dimensions?: Readonly<{ checklist: number; evidence: number; finish: number; customer_readiness: number }>;
  [key:string]: unknown;
}

const LEGACY_KEYS=new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacy(v:unknown,path='input'):void{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const [k,x] of Object.entries(v as Record<string,unknown>)){if(LEGACY_KEYS.has(k))throw new Error(`${path}.${k} is a legacy tenant boundary; company_id is required`);rejectLegacy(x,`${path}.${k}`);}}
function req(v:unknown,n:string):string{const x=String(v??'').trim();if(!x)throw new Error(`${n} is required`);return x;}
function opt(v:unknown):string|null{const x=String(v??'').trim();return x||null;}
function uniq(v:readonly string[]|undefined):readonly string[]{return Object.freeze([...new Set((v??[]).map(x=>String(x).trim()).filter(Boolean))]);}
function score(v:unknown,n:string,fallback:number):number{if(v==null)return fallback;const x=Number(v);if(!Number.isFinite(x)||x<0||x>100)throw new Error(`${n} must be between 0 and 100`);return Math.round(x*100)/100;}

export function buildCleaningQaReview(input:CleaningQaReviewInput){
  rejectLegacy(input);
  const company_id=req(input.company_id,'company_id');
  const job_ref=req(input.job_ref,'job_ref');
  const supervisor_ref=req(input.supervisor_ref,'supervisor_ref');
  const inspection_ref=req(input.inspection_ref,'inspection_ref');
  const pack=input.execution_pack??(input.execution_input?buildCleaningExecutionPack(input.execution_input):null);
  if(!pack)throw new Error('execution_pack or execution_input is required');
  if(pack.company_id!==company_id)throw new Error('cross-company cleaning execution pack');
  if(pack.job_ref!==job_ref)throw new Error('cleaning execution pack job_ref mismatch');

  const areaRefs=new Set(pack.areas.map(a=>a.area_ref));
  const seen=new Set<string>();
  const inspection_items=(input.inspection_items??[]).map((raw,i)=>{
    const item_ref=req(raw.item_ref,`inspection_items[${i}].item_ref`);if(seen.has(item_ref))throw new Error(`duplicate inspection item_ref: ${item_ref}`);seen.add(item_ref);
    const area_ref=opt(raw.area_ref);if(area_ref&&!areaRefs.has(area_ref))throw new Error(`inspection references unknown cleaning area: ${area_ref}`);
    if(!['PASS','MISS','DEFECT','BLOCKED'].includes(raw.status))throw new Error(`unsupported inspection status: ${raw.status}`);
    const severity=raw.severity??(raw.status==='DEFECT'?'MEDIUM':'LOW');
    const note_ref=opt(raw.note_ref);const evidence_refs=uniq(raw.evidence_refs);
    if(raw.status!=='PASS'&&!note_ref)throw new Error(`inspection note_ref required for ${raw.status}: ${item_ref}`);
    if((raw.status==='DEFECT'||raw.status==='BLOCKED')&&!evidence_refs.length)throw new Error(`inspection evidence required for ${raw.status}: ${item_ref}`);
    return Object.freeze({item_ref,area_ref,status:raw.status,note_ref,evidence_refs,severity});
  });
  if(!inspection_items.length)throw new Error('at least one QA inspection item is required');

  const issueSeen=new Set<string>();
  const customer_issues=(input.customer_issues??[]).map((raw,i)=>{
    const issue_ref=req(raw.issue_ref,`customer_issues[${i}].issue_ref`);if(issueSeen.has(issue_ref))throw new Error(`duplicate customer issue_ref: ${issue_ref}`);issueSeen.add(issue_ref);
    return Object.freeze({issue_ref,category:raw.category,note_ref:req(raw.note_ref,`customer_issues[${i}].note_ref`),evidence_refs:uniq(raw.evidence_refs),customer_requested_followup:raw.customer_requested_followup===true});
  });

  const misses=inspection_items.filter(x=>x.status==='MISS');
  const defects=inspection_items.filter(x=>x.status==='DEFECT');
  const blocked=inspection_items.filter(x=>x.status==='BLOCKED');
  const highSeverity=inspection_items.filter(x=>x.severity==='HIGH');
  const completionReady=pack.completion.completion_ready===true;
  const requiresRework=misses.length>0||defects.length>0;
  const requiresEscalation=blocked.length>0||highSeverity.length>0||customer_issues.some(x=>x.category==='damage_concern');
  const requiresCustomerCare=customer_issues.length>0||requiresRework||requiresEscalation;
  const outcome:CleaningQaOutcome=!completionReady?'ESCALATION_REQUIRED':requiresEscalation?'ESCALATION_REQUIRED':requiresRework?'REWORK_REQUIRED':customer_issues.length?'PASS_WITH_NOTES':'PASS';

  const dims=input.quality_dimensions??{} as any;
  const quality=Object.freeze({
    checklist:score(dims.checklist,'quality_dimensions.checklist',completionReady?100:0),
    evidence:score(dims.evidence,'quality_dimensions.evidence',pack.completion.evidence_shortage===0?100:50),
    finish:score(dims.finish,'quality_dimensions.finish',Math.max(0,100-(misses.length*15)-(defects.length*30)-(blocked.length*40))),
    customer_readiness:score(dims.customer_readiness,'quality_dimensions.customer_readiness',customer_issues.length?70:100)
  });
  const quality_score=Math.round(((quality.checklist+quality.evidence+quality.finish+quality.customer_readiness)/4)*100)/100;

  const rework_items=Object.freeze([...misses,...defects].map(x=>Object.freeze({source_inspection_item_ref:x.item_ref,area_ref:x.area_ref,reason_code:x.status,requires_jobs_owner_task_creation:true as const,automatic_reassignment:false as const})));
  const service_recovery=Object.freeze(customer_issues.map(x=>Object.freeze({issue_ref:x.issue_ref,category:x.category,requires_customer_care_review:true as const,remedy_authorized:false as const,refund_authorized:false as const,credit_authorized:false as const})));

  return Object.freeze({
    schema:CLEANING_QA_REVIEW_SCHEMA,company_id,job_ref,service_id:pack.service_id,supervisor_ref,inspection_ref,outcome,
    completion_ready_before_qa:completionReady,inspection_items:Object.freeze(inspection_items),customer_issues:Object.freeze(customer_issues),
    customer_signoff_ref:opt(input.customer_signoff_ref),supervisor_signoff_ref:opt(input.supervisor_signoff_ref),
    quality:Object.freeze({...quality,quality_score}),rework_items,service_recovery,
    requires_rework:requiresRework,requires_escalation:requiresEscalation,requires_customer_care:requiresCustomerCare,
    qa_passed:outcome==='PASS'||outcome==='PASS_WITH_NOTES',
    owners:Object.freeze({job:'shared_jobs_owner',evidence:'shared_evidence_owner',customer_care:'shared_customer_care_owner',workforce_quality:'shared_workforce_quality_owner'}),
    job_mutation_emitted:false,rework_task_mutation_emitted:false,customer_remedy_mutation_emitted:false,quality_is_projection:true,
    requires_fresh_rework_authority:requiresRework,requires_fresh_customer_remedy_authority:requiresCustomerCare,
    grants_authority:false,execution_permitted:false
  });
}
