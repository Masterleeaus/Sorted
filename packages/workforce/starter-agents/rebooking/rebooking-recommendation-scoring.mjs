const LEGACY_KEYS=["tenant_company_id","tenant_id","account_id","business_id"];
const req=(v,n)=>{if(typeof v!=="string"||!v.trim())throw new Error(`missing ${n}`);return v.trim()};
const rejectLegacy=i=>{for(const k of LEGACY_KEYS)if(i&&Object.prototype.hasOwnProperty.call(i,k))throw new Error(`legacy company boundary rejected: ${k}`)};
const parseDate=(v,n)=>{const s=req(v,n);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error(`invalid ${n}`);const [y,m,d]=s.split("-").map(Number);const dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)throw new Error(`invalid ${n}`);return dt};
const daysBetween=(a,b)=>Math.floor((b-a)/86400000);
const clamp=n=>Math.max(0,Math.min(100,n));
const band=s=>s>=75?"HIGH":s>=50?"MEDIUM":s>=25?"LOW":"NONE";
const uniq=a=>[...new Set(a.filter(Boolean))];
const validateOpportunity=(o,company_id)=>{if(!o||o.schema!=="titan.workforce.starter.rebooking-opportunity.v1")throw new Error("invalid opportunity");rejectLegacy(o);if(o.company_id!==company_id)throw new Error("cross-company opportunity");return o};
const validateDue=(d,company_id,opportunity_id)=>{if(d==null)return null;if(d.schema!=="titan.workforce.starter.rebooking-due-date-candidate.v1")throw new Error("invalid due-date candidate");rejectLegacy(d);if(d.company_id!==company_id)throw new Error("cross-company due-date candidate");if(d.opportunity_id!==opportunity_id)throw new Error("due-date opportunity mismatch");return d};
function recurringScore({due,service_history_count,prior_completed_services,customer_signal}){
  let score=0;const reasons=[];
  if(due?.state==="CANDIDATE"){score+=25;reasons.push("DETERMINISTIC_DUE_DATE_AVAILABLE");const c=due.confidence_class;if(c==="AUTHORITATIVE"){score+=25;reasons.push("AUTHORITATIVE_CADENCE_EVIDENCE")}else if(c==="HIGH"){score+=20;reasons.push("HIGH_CONFIDENCE_CADENCE_EVIDENCE")}else if(c==="MEDIUM"){score+=12;reasons.push("HISTORY_DERIVED_CADENCE_EVIDENCE")}else if(c==="CONFIGURED_DEFAULT"){score+=8;reasons.push("SERVICE_DEFAULT_CADENCE_EVIDENCE")}}
  const history=Math.max(service_history_count,prior_completed_services);
  if(history>=3){score+=25;reasons.push("MULTIPLE_COMPLETED_SERVICES")}else if(history===2){score+=18;reasons.push("REPEAT_SERVICE_EVIDENCE")}else if(history===1){score+=8;reasons.push("ONE_COMPLETED_SERVICE")}
  if(customer_signal?.recurring_interest===true){score+=25;reasons.push("CUSTOMER_RECURRING_INTEREST")}
  if(customer_signal?.recent_rebooking_decline===true){score-=20;reasons.push("RECENT_REBOOKING_DECLINE")}
  return{score:clamp(score),reasons};
}
function reactivationScore({asOf,lastCompleted,due,threshold,prior_completed_services,customer_signal}){
  if(!lastCompleted)return{score:0,reasons:["NO_LAST_COMPLETED_DATE"],dormancy_days:null,dormant:false};
  const dormantDays=daysBetween(lastCompleted,asOf);if(dormantDays<0)throw new Error("future last_completed_date rejected");
  const dormant=dormantDays>=threshold;let score=0;const reasons=[];
  if(dormant){score+=45;reasons.push("DORMANCY_THRESHOLD_REACHED")}else reasons.push("DORMANCY_THRESHOLD_NOT_REACHED");
  if(prior_completed_services>=3){score+=20;reasons.push("STRONG_PRIOR_SERVICE_HISTORY")}else if(prior_completed_services>=2){score+=12;reasons.push("PRIOR_REPEAT_SERVICE_HISTORY")}
  if(due?.state==="CANDIDATE"&&due.due_date){const dueDate=parseDate(due.due_date,"due_date_candidate.due_date");if(dueDate<asOf){score+=20;reasons.push("DETERMINISTIC_DUE_DATE_OVERDUE")}}
  if(customer_signal?.positive_prior_engagement===true){score+=10;reasons.push("POSITIVE_PRIOR_ENGAGEMENT")}
  if(customer_signal?.rebook_interest===true){score+=10;reasons.push("CUSTOMER_REBOOK_INTEREST")}
  if(customer_signal?.recent_rebooking_decline===true){score-=20;reasons.push("RECENT_REBOOKING_DECLINE")}
  return{score:clamp(score),reasons,dormancy_days:dormantDays,dormant};
}
export function scoreRebookingRecommendation(input={}){
  rejectLegacy(input);
  const company_id=req(input.company_id,"company_id");
  const opportunity=validateOpportunity(input.opportunity,company_id);
  const due=validateDue(input.due_date_candidate,company_id,opportunity.opportunity_id);
  const asOf=parseDate(input.as_of_date,"as_of_date");
  const lastCompleted=input.last_completed_date?parseDate(input.last_completed_date,"last_completed_date"):null;
  const threshold=Number(input.dormancy_threshold_days);if(!Number.isInteger(threshold)||threshold<1||threshold>3650)throw new Error("invalid dormancy_threshold_days");
  const service_history_count=Number.isInteger(input.service_history_count)&&input.service_history_count>=0?input.service_history_count:0;
  const prior_completed_services=Number.isInteger(input.prior_completed_services)&&input.prior_completed_services>=0?input.prior_completed_services:0;
  const customer_signal=input.customer_signal&&typeof input.customer_signal==="object"?input.customer_signal:{};rejectLegacy(customer_signal);
  const base={schema:"titan.workforce.starter.rebooking-recommendation-score.v1",company_id,opportunity_id:opportunity.opportunity_id,customer_id:opportunity.customer_id,service_id:opportunity.service_id,as_of_date:input.as_of_date,dormancy_threshold_days:threshold,evidence_refs:uniq([opportunity.source_event_id,...(due?.evidence_refs||[]),...(Array.isArray(input.evidence_refs)?input.evidence_refs:[])]).sort(),model_role:"ADVISORY_ONLY_AFTER_DETERMINISTIC_SCORING",model_may_override:false,creates_schedule:false,creates_booking:false,sends_outreach:false,execution_permitted:false,grants_authority:false,identity_is_authority:false};
  if(opportunity.suppression?.suppressed||!opportunity.consent?.known||!opportunity.consent?.permitted||opportunity.consent?.opted_out){return{...base,state:"SUPPRESSED",recommendation:"NONE",score:0,confidence_band:"NONE",recurring_conversion:{score:0,band:"NONE",reasons:["SUPPRESSION_OR_CONSENT_BLOCK"]},reactivation:{score:0,band:"NONE",reasons:["SUPPRESSION_OR_CONSENT_BLOCK"],dormancy_days:lastCompleted?daysBetween(lastCompleted,asOf):null,dormant:false},reasons:["SUPPRESSION_OR_CONSENT_BLOCK"],requires_human_review:false}}
  const recurring=recurringScore({due,service_history_count,prior_completed_services,customer_signal});
  const reactivation=reactivationScore({asOf,lastCompleted,due,threshold,prior_completed_services,customer_signal});
  let recommendation="NONE",score=0,reasons=[];
  if(reactivation.dormant&&reactivation.score>=recurring.score&&reactivation.score>=50){recommendation="REACTIVATION_RECOMMENDED";score=reactivation.score;reasons=reactivation.reasons}
  else if(recurring.score>=50){recommendation="RECURRING_CONVERSION_RECOMMENDED";score=recurring.score;reasons=recurring.reasons}
  else {score=Math.max(recurring.score,reactivation.score);reasons=uniq([...recurring.reasons,...reactivation.reasons,"INSUFFICIENT_SCORE_FOR_RECOMMENDATION"])}
  return{...base,state:recommendation==="NONE"?"REVIEW":"RECOMMENDED",recommendation,score,confidence_band:band(score),recurring_conversion:{score:recurring.score,band:band(recurring.score),reasons:recurring.reasons},reactivation:{score:reactivation.score,band:band(reactivation.score),reasons:reactivation.reasons,dormancy_days:reactivation.dormancy_days,dormant:reactivation.dormant},reasons,requires_human_review:true};
}
