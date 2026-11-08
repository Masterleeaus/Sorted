import { assertCompanyId, rejectLegacyTenantBoundary } from './contracts.js';

export const WORKFORCE_QUALITY_SCHEMA = 'titan.workforce.quality-outcome.v1' as const;
export type QualityState = 'EXCELLENT' | 'GOOD' | 'REVIEW' | 'POOR' | 'INSUFFICIENT_EVIDENCE';

export interface QualityOutcomeInput {
  company_id: string;
  subject_id: string;
  task_count?: number;
  success_count?: number;
  failure_count?: number;
  rework_count?: number;
  evidence_count?: number;
  validation_pass_count?: number;
  validation_fail_count?: number;
  customer_score?: number | null;
  business_score?: number | null;
  on_time_count?: number;
  source_refs?: string[];
}

function nn(v: unknown): number { const n=Number(v); return Number.isFinite(n)&&n>=0?n:0; }
function metric(v: unknown): number | null { if(v==null||v==='') return null; const n=Number(v); if(!Number.isFinite(n)) return null; if(n>1&&n<=5) return Math.max(0,Math.min(1,n/5)); if(n>5&&n<=100) return Math.max(0,Math.min(1,n/100)); return Math.max(0,Math.min(1,n)); }
function uniq(v: unknown): string[] { return [...new Set((Array.isArray(v)?v:[]).map(x=>String(x??'').trim()).filter(Boolean))].sort(); }
function ratio(a:number,b:number): number | null { return b>0?Number((a/b).toFixed(4)):null; }

export function scoreQualityOutcome(input: QualityOutcomeInput) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id=assertCompanyId(input.company_id);
  const subject_id=String(input.subject_id??'').trim();
  if(!subject_id) throw new Error('subject_id is required');
  const task_count=nn(input.task_count);
  const success_count=nn(input.success_count);
  const failure_count=nn(input.failure_count);
  const rework_count=nn(input.rework_count);
  const evidence_count=nn(input.evidence_count);
  const validation_pass_count=nn(input.validation_pass_count);
  const validation_fail_count=nn(input.validation_fail_count);
  const validation_total=validation_pass_count+validation_fail_count;
  const on_time_count=nn(input.on_time_count);
  const success_rate=ratio(success_count,task_count);
  const validation_rate=ratio(validation_pass_count,validation_total);
  const on_time_rate=ratio(on_time_count,task_count);
  const customer_score=metric(input.customer_score);
  const business_score=metric(input.business_score);
  const rework_rate=ratio(rework_count,task_count);
  const failure_rate=ratio(failure_count,task_count);
  const dimensions=[success_rate,validation_rate,on_time_rate,customer_score,business_score].filter((x):x is number=>x!=null);
  const evidence_confidence=task_count>0?Math.min(1,evidence_count/Math.max(1,task_count)):0;
  const base=dimensions.length?dimensions.reduce((a,b)=>a+b,0)/dimensions.length:0.5;
  const penalty=Math.min(0.7,(rework_rate??0)*0.35+(failure_rate??0)*0.45+(validation_fail_count>0?Math.min(0.2,validation_fail_count*0.03):0));
  const score=Number(Math.max(0,Math.min(1,(base-penalty)*(0.5+0.5*evidence_confidence))).toFixed(4));
  let state: QualityState='INSUFFICIENT_EVIDENCE';
  if(evidence_count>0||task_count>0){ if(score>=0.9) state='EXCELLENT'; else if(score>=0.75) state='GOOD'; else if(score>=0.55) state='REVIEW'; else state='POOR'; }
  const review_reasons:string[]=[];
  if(evidence_count===0) review_reasons.push('NO_EVIDENCE');
  if((failure_rate??0)>=0.2) review_reasons.push('ELEVATED_FAILURE_RATE');
  if((rework_rate??0)>=0.15) review_reasons.push('ELEVATED_REWORK_RATE');
  if(validation_fail_count>0) review_reasons.push('VALIDATION_FAILURES');
  if(customer_score!=null&&customer_score<0.7) review_reasons.push('LOW_CUSTOMER_OUTCOME');
  if(business_score!=null&&business_score<0.7) review_reasons.push('LOW_BUSINESS_OUTCOME');
  return {
    schema:WORKFORCE_QUALITY_SCHEMA, company_id, subject_id, score, state,
    dimensions:{success_rate,validation_rate,on_time_rate,customer_score,business_score,rework_rate,failure_rate,evidence_confidence},
    counts:{task_count,success_count,failure_count,rework_count,evidence_count,validation_pass_count,validation_fail_count,on_time_count},
    review_required:review_reasons.length>0||state==='POOR'||state==='REVIEW', review_reasons,
    source_refs:uniq(input.source_refs), derived_measurement:true, proposal_only:true,
    automatic_staffing_change:false, execution_permitted:false, grants_authority:false,
  } as const;
}

export function adaptPerformanceOutcomeSnapshot(input:{company_id:string;snapshot:Record<string,any>}){
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id=assertCompanyId(input.company_id);
  if(input.snapshot?.company_id!==company_id) throw new Error('cross-company performance snapshot rejected');
  if(input.snapshot?.schema!=='titan.workforce.performance-outcome-evidence.v1') throw new Error('performance snapshot schema invalid');
  return (Array.isArray(input.snapshot.worker_performance)?input.snapshot.worker_performance:[]).map((w:any)=>scoreQualityOutcome({
    company_id, subject_id:String(w.worker_id??''), task_count:w.outcome_count, failure_count:Math.max(0,Number(w.outcome_count??0)-Number(w.evidence_backed_count??0)),
    rework_count:w.correction_count, evidence_count:w.evidence_backed_count, customer_score:w.customer_score, business_score:w.business_result_score,
    on_time_count:w.on_time_rate==null?0:Math.round(Number(w.on_time_rate)*Number(w.outcome_count??0)), source_refs:['titan.workforce.performance-outcome-evidence.v1']
  }));
}
