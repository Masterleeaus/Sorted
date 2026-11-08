// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/rebooking/rebooking-governed-outreach.mjs
const LEGACY_KEYS=["tenant_company_id","tenant_id","account_id","business_id"];
const CHANNELS=new Set(["SMS","EMAIL","WHATSAPP","MESSENGER","TELEGRAM"]);
const req=(v,n)=>{if(typeof v!=="string"||!v.trim())throw new Error(`missing ${n}`);return v.trim()};
const rejectLegacy=i=>{for(const k of LEGACY_KEYS)if(i&&Object.prototype.hasOwnProperty.call(i,k))throw new Error(`legacy company boundary rejected: ${k}`)};
const uniq=a=>[...new Set((a||[]).filter(Boolean))].sort();
const parseDateTime=(v,n)=>{const s=req(v,n);const d=new Date(s);if(Number.isNaN(d.getTime()))throw new Error(`invalid ${n}`);return d};
const hhmm=v=>{if(typeof v!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error("invalid quiet-hours time");const [h,m]=v.split(":").map(Number);return h*60+m};
const localMinute=(iso,timeZone)=>{const d=parseDateTime(iso,"as_of_datetime");let parts;try{parts=new Intl.DateTimeFormat("en-AU",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d)}catch{throw new Error("invalid timezone")};const h=Number(parts.find(p=>p.type==="hour")?.value);const m=Number(parts.find(p=>p.type==="minute")?.value);return h*60+m};
const inQuietHours=(minute,start,end)=>start===end?false:start<end?(minute>=start&&minute<end):(minute>=start||minute<end);
const validateRecommendation=(r,company_id)=>{if(!r||r.schema!=="titan.workforce.starter.rebooking-recommendation-score.v1")throw new Error("invalid recommendation");rejectLegacy(r);if(r.company_id!==company_id)throw new Error("cross-company recommendation");return r};
const validateAuthority=(a,company_id,asOf)=>{if(!a)return{valid:false,reason:"FRESH_AUTHORITY_REQUIRED",evidence_ref:null};rejectLegacy(a);if(a.company_id!==company_id)throw new Error("cross-company authority evidence");if(a.granted!==true)return{valid:false,reason:"AUTHORITY_NOT_GRANTED",evidence_ref:a.evidence_ref||null};const checked=parseDateTime(a.checked_at,"authority.checked_at");const age=Math.abs(asOf-checked);const max=Number.isInteger(a.max_age_seconds)&&a.max_age_seconds>0?a.max_age_seconds:300;if(age>max*1000)return{valid:false,reason:"AUTHORITY_STALE",evidence_ref:a.evidence_ref||null};if(a.scope!=="rebooking.outreach.dispatch")return{valid:false,reason:"AUTHORITY_SCOPE_MISMATCH",evidence_ref:a.evidence_ref||null};return{valid:true,reason:null,evidence_ref:a.evidence_ref||null}};
const countWindow=(events,asOf,days,company_id,customer_id,channel)=>{const floor=asOf.getTime()-days*86400000;return events.filter(e=>{rejectLegacy(e);if(e.company_id!==company_id)throw new Error("cross-company outreach history");if(e.customer_id!==customer_id)return false;if(e.channel!==channel)return false;const t=parseDateTime(e.sent_at,"history.sent_at").getTime();return t>=floor&&t<=asOf.getTime()}).length};
export function buildGovernedRebookingOutreach(input={}){
  rejectLegacy(input);
  const company_id=req(input.company_id,"company_id");
  const recommendation=validateRecommendation(input.recommendation,company_id);
  const customer_id=req(input.customer_id,"customer_id");
  if(recommendation.customer_id!==customer_id)throw new Error("recommendation customer mismatch");
  const channel=req(input.channel,"channel").toUpperCase();if(!CHANNELS.has(channel))throw new Error("unsupported channel");
  const asOf=parseDateTime(input.as_of_datetime,"as_of_datetime");
  const timezone=req(input.timezone,"timezone");
  const consent=input.consent&&typeof input.consent==="object"?input.consent:{};rejectLegacy(consent);
  const prefs=input.channel_preferences&&typeof input.channel_preferences==="object"?input.channel_preferences:{};rejectLegacy(prefs);
  const reasons=[];
  if(recommendation.state!=="RECOMMENDED")reasons.push("RECOMMENDATION_NOT_ELIGIBLE");
  if(consent.known!==true)reasons.push("CONSENT_UNKNOWN");
  if(consent.permitted!==true)reasons.push("CONSENT_NOT_PERMITTED");
  if(consent.opted_out===true)reasons.push("OPTED_OUT");
  if(Array.isArray(consent.allowed_channels)&&!consent.allowed_channels.map(x=>String(x).toUpperCase()).includes(channel))reasons.push("CHANNEL_NOT_CONSENTED");
  if(Array.isArray(prefs.blocked_channels)&&prefs.blocked_channels.map(x=>String(x).toUpperCase()).includes(channel))reasons.push("CHANNEL_BLOCKED_BY_PREFERENCE");
  if(Array.isArray(prefs.allowed_channels)&&!prefs.allowed_channels.map(x=>String(x).toUpperCase()).includes(channel))reasons.push("CHANNEL_NOT_ALLOWED_BY_PREFERENCE");
  const q=input.quiet_hours&&typeof input.quiet_hours==="object"?input.quiet_hours:null;
  if(q?.enabled===true){const start=hhmm(q.start);const end=hhmm(q.end);if(inQuietHours(localMinute(input.as_of_datetime,timezone),start,end))reasons.push("QUIET_HOURS_ACTIVE")}
  const caps=input.frequency_caps&&typeof input.frequency_caps==="object"?input.frequency_caps:{};
  const max7=Number.isInteger(caps.max_per_7_days)&&caps.max_per_7_days>=0?caps.max_per_7_days:1;
  const max30=Number.isInteger(caps.max_per_30_days)&&caps.max_per_30_days>=0?caps.max_per_30_days:3;
  const history=Array.isArray(input.outreach_history)?input.outreach_history:[];
  if(countWindow(history,asOf,7,company_id,customer_id,channel)>=max7)reasons.push("FREQUENCY_CAP_7D_REACHED");
  if(countWindow(history,asOf,30,company_id,customer_id,channel)>=max30)reasons.push("FREQUENCY_CAP_30D_REACHED");
  const duplicateKey=req(input.duplicate_key,"duplicate_key");
  for(const e of history){if(e.company_id===company_id&&e.duplicate_key===duplicateKey){reasons.push("DUPLICATE_OUTREACH_SUPPRESSED");break}}
  if(input.active_booking_exists===true)reasons.push("ACTIVE_BOOKING_EXISTS");
  if(input.open_complaint===true)reasons.push("OPEN_COMPLAINT");
  if(input.service_recovery_active===true)reasons.push("SERVICE_RECOVERY_ACTIVE");
  const hardBlocks=uniq(reasons);
  const authority=validateAuthority(input.authority_check,company_id,asOf);
  const state=hardBlocks.length?"SUPPRESSED":authority.valid?"READY_FOR_DISPATCH_HANDOFF":"AWAITING_FRESH_AUTHORITY";
  const allReasons=uniq([...hardBlocks,...(!hardBlocks.length&&!authority.valid?[authority.reason]:[])]);
  return{
    schema:"titan.workforce.starter.rebooking-governed-outreach.v1",
    outreach_id:`rebook-outreach:${company_id}:${customer_id}:${recommendation.opportunity_id}:${channel}:${duplicateKey}`,
    company_id,customer_id,service_id:recommendation.service_id,opportunity_id:recommendation.opportunity_id,recommendation_id:recommendation.recommendation_id||null,
    recommendation:recommendation.recommendation,channel,timezone,as_of_datetime:input.as_of_datetime,duplicate_key:duplicateKey,
    state,reasons:allReasons,
    consent:{known:consent.known===true,permitted:consent.permitted===true,opted_out:consent.opted_out===true,evidence_id:consent.evidence_id||null},
    governance:{quiet_hours_checked:true,frequency_caps_checked:true,duplicate_suppression_checked:true,customer_preferences_checked:true,fresh_authority_required:true,authority_valid:authority.valid,authority_evidence_ref:authority.evidence_ref},
    frequency:{max_per_7_days:max7,max_per_30_days:max30,current_7_days:countWindow(history,asOf,7,company_id,customer_id,channel),current_30_days:countWindow(history,asOf,30,company_id,customer_id,channel)},
    evidence_refs:uniq([...(recommendation.evidence_refs||[]),consent.evidence_id,authority.evidence_ref,...(Array.isArray(input.evidence_refs)?input.evidence_refs:[])]),
    dispatch_handoff:{provider_owned:true,channel_dispatch_permitted:state==="READY_FOR_DISPATCH_HANDOFF",requires_provider_idempotency:true,duplicate_key:duplicateKey},
    sends_outreach:false,creates_booking:false,creates_schedule:false,changes_authority:false,execution_permitted:false,grants_authority:false,identity_is_authority:false
  };
}
