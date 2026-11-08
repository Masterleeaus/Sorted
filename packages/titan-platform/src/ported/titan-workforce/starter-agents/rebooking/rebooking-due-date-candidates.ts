// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/rebooking/rebooking-due-date-candidates.mjs
const LEGACY_KEYS=["tenant_company_id","tenant_id","account_id","business_id"];
const INTERVAL_UNITS=new Set(["DAYS","WEEKS","MONTHS"]);
const req=(v,n)=>{if(typeof v!=="string"||!v.trim())throw new Error(`missing ${n}`);return v.trim()};
const rejectLegacy=i=>{for(const k of LEGACY_KEYS)if(i&&Object.prototype.hasOwnProperty.call(i,k))throw new Error(`legacy company boundary rejected: ${k}`)};
const parseDate=(v,n)=>{const s=req(v,n);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error(`invalid ${n}`);const [y,m,d]=s.split("-").map(Number);const dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)throw new Error(`invalid ${n}`);return dt};
const fmt=dt=>`${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
const normalizeInterval=(raw,n)=>{if(raw==null)return null;rejectLegacy(raw);const value=Number(raw.value);const unit=String(raw.unit||"").toUpperCase();if(!Number.isInteger(value)||value<=0||value>3660)throw new Error(`invalid ${n}.value`);if(!INTERVAL_UNITS.has(unit))throw new Error(`invalid ${n}.unit`);return{value,unit,evidence_ref:raw.evidence_ref||null}};
const sameInterval=(a,b)=>!!a&&!!b&&a.value===b.value&&a.unit===b.unit;
const addInterval=(base,interval)=>{const d=new Date(base.getTime());if(interval.unit==="DAYS")d.setUTCDate(d.getUTCDate()+interval.value);else if(interval.unit==="WEEKS")d.setUTCDate(d.getUTCDate()+interval.value*7);else{const y=d.getUTCFullYear(),m=d.getUTCMonth(),day=d.getUTCDate();const first=new Date(Date.UTC(y,m+interval.value,1));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();first.setUTCDate(Math.min(day,last));return first}return d};
const median=xs=>{const a=[...xs].sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:Math.round((a[m-1]+a[m])/2)};
function historyInterval(history,reference){if(!Array.isArray(history)||history.length<3)return null;const dates=history.map((x,i)=>{rejectLegacy(x);if(x.company_id!==reference.company_id)throw new Error("cross-company service history");const d=parseDate(x.completed_date,`service_history[${i}].completed_date`);if(d>reference.completed)throw new Error("future service history date rejected");return{d,ref:x.evidence_ref||x.source_event_id||null}}).sort((a,b)=>a.d-b.d);const gaps=[];for(let i=1;i<dates.length;i++){const gap=Math.round((dates[i].d-dates[i-1].d)/86400000);if(gap<=0)throw new Error("non-monotonic or duplicate service history date");gaps.push(gap)}const days=median(gaps);if(!days||days<=0)return null;return{value:days,unit:"DAYS",evidence_refs:dates.map(x=>x.ref).filter(Boolean),derivation:"MEDIAN_HISTORY_GAP_DAYS"}}
export function buildDeterministicDueDateCandidate(input={}){
  rejectLegacy(input);
  const company_id=req(input.company_id,"company_id"),customer_id=req(input.customer_id,"customer_id"),service_id=req(input.service_id,"service_id"),opportunity_id=req(input.opportunity_id,"opportunity_id"),timezone=req(input.timezone,"timezone");
  const completed=parseDate(input.completed_date,"completed_date");
  const today=input.as_of_date?parseDate(input.as_of_date,"as_of_date"):completed;
  if(completed>today)throw new Error("future completed_date rejected");
  const configured=normalizeInterval(input.configured_interval,"configured_interval");
  const canonical=normalizeInterval(input.canonical_recurrence_interval,"canonical_recurrence_interval");
  if(configured&&canonical&&!sameInterval(configured,canonical))throw new Error("conflicting authoritative intervals");
  const prior=normalizeInterval(input.prior_cadence,"prior_cadence");
  const serviceDefault=normalizeInterval(input.service_type_default_interval,"service_type_default_interval");
  const hist=historyInterval(input.service_history,{company_id,completed});
  let interval=null,source=null,evidence_refs=[];
  if(configured||canonical){interval=configured||canonical;source=configured?"CONFIGURED_INTERVAL":"CANONICAL_RECURRENCE_INTERVAL";evidence_refs=[interval.evidence_ref].filter(Boolean)}
  else if(prior){interval=prior;source="VERIFIED_PRIOR_CADENCE";evidence_refs=[prior.evidence_ref].filter(Boolean)}
  else if(hist){interval={value:hist.value,unit:hist.unit};source=hist.derivation;evidence_refs=hist.evidence_refs}
  else if(serviceDefault){interval=serviceDefault;source="SERVICE_TYPE_DEFAULT";evidence_refs=[serviceDefault.evidence_ref].filter(Boolean)}
  if(!interval)return{schema:"titan.workforce.starter.rebooking-due-date-candidate.v1",company_id,customer_id,service_id,opportunity_id,state:"NEEDS_REVIEW",timezone,due_date:null,interval:null,derivation:null,evidence_refs:[],confidence_class:"NONE",reasons:["NO_DETERMINISTIC_INTERVAL_EVIDENCE"],model_suggestion_allowed:false,canonical_recurrence_engine:"titan.workforce.schedule-recurrence.v1",creates_schedule:false,creates_booking:false,execution_permitted:false,grants_authority:false};
  const due=addInterval(completed,interval);
  const confidence=source==="CONFIGURED_INTERVAL"||source==="CANONICAL_RECURRENCE_INTERVAL"?"AUTHORITATIVE":source==="VERIFIED_PRIOR_CADENCE"?"HIGH":source==="MEDIAN_HISTORY_GAP_DAYS"?"MEDIUM":"CONFIGURED_DEFAULT";
  const stable=`rebook-due:${company_id}:${opportunity_id}:${fmt(completed)}:${interval.value}:${interval.unit}:${source}`;
  return{schema:"titan.workforce.starter.rebooking-due-date-candidate.v1",company_id,customer_id,service_id,opportunity_id,candidate_id:stable,state:"CANDIDATE",timezone,completed_date:fmt(completed),due_date:fmt(due),interval:{value:interval.value,unit:interval.unit},derivation:source,evidence_refs:[...new Set(evidence_refs)].sort(),confidence_class:confidence,reasons:[`DETERMINISTIC_${source}`],model_suggestion_allowed:true,model_role:"ADVISORY_ONLY_AFTER_DETERMINISTIC_CANDIDATE",canonical_recurrence_engine:"titan.workforce.schedule-recurrence.v1",creates_schedule:false,creates_booking:false,execution_permitted:false,grants_authority:false};
}
