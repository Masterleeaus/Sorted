// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/rebooking/rebooking-response-handoff.mjs
const LEGACY_KEYS=["tenant_company_id","tenant_id","account_id","business_id"];
const RESPONSE_TYPES=new Set(["YES","NO","LATER","CHANGE_FREQUENCY"]);
const INTERVAL_UNITS=new Set(["DAYS","WEEKS","MONTHS"]);
const req=(v,n)=>{if(typeof v!=="string"||!v.trim())throw new Error(`missing ${n}`);return v.trim()};
const rejectLegacy=i=>{for(const k of LEGACY_KEYS)if(i&&Object.prototype.hasOwnProperty.call(i,k))throw new Error(`legacy company boundary rejected: ${k}`)};
const uniq=a=>[...new Set((a||[]).filter(Boolean))].sort();
const parseDateTime=(v,n)=>{const s=req(v,n);const d=new Date(s);if(Number.isNaN(d.getTime()))throw new Error(`invalid ${n}`);return d};
const validateOpportunity=(o,company_id)=>{if(!o||o.schema!=="titan.workforce.starter.rebooking-opportunity.v1")throw new Error("invalid opportunity");rejectLegacy(o);if(o.company_id!==company_id)throw new Error("cross-company opportunity");return o};
const validateRecommendation=(r,company_id,opportunity_id)=>{if(!r)return null;if(r.schema!=="titan.workforce.starter.rebooking-recommendation-score.v1")throw new Error("invalid recommendation");rejectLegacy(r);if(r.company_id!==company_id)throw new Error("cross-company recommendation");if(r.opportunity_id!==opportunity_id)throw new Error("recommendation opportunity mismatch");return r};
const validateOutreach=(o,company_id,opportunity_id)=>{if(!o)return null;if(o.schema!=="titan.workforce.starter.rebooking-governed-outreach.v1")throw new Error("invalid outreach");rejectLegacy(o);if(o.company_id!==company_id)throw new Error("cross-company outreach");if(o.opportunity_id!==opportunity_id)throw new Error("outreach opportunity mismatch");return o};
const validateVerifiedResponse=(r,company_id,opportunity_id)=>{if(!r||typeof r!=="object")throw new Error("missing response_event");rejectLegacy(r);if(r.company_id!==company_id)throw new Error("cross-company response");if(r.opportunity_id!==opportunity_id)throw new Error("response opportunity mismatch");if(r.verified!==true)throw new Error("unverified response event");const response_type=req(r.response_type,"response_event.response_type").toUpperCase();if(!RESPONSE_TYPES.has(response_type))throw new Error("unsupported response_type");const response_id=req(r.response_id,"response_event.response_id");const source_message_id=req(r.source_message_id,"response_event.source_message_id");const responded_at=req(r.responded_at,"response_event.responded_at");parseDateTime(responded_at,"response_event.responded_at");return{...r,response_type,response_id,source_message_id,responded_at}};
const validateHistory=(history,company_id,response_id)=>{for(const e of history){rejectLegacy(e);if(e.company_id!==company_id)throw new Error("cross-company response history");if(e.response_id===response_id)return true}return false};
const normalizeFrequency=f=>{if(!f||typeof f!=="object")throw new Error("change-frequency response requires frequency");rejectLegacy(f);const unit=req(f.unit,"frequency.unit").toUpperCase();if(!INTERVAL_UNITS.has(unit))throw new Error("unsupported frequency unit");if(!Number.isInteger(f.value)||f.value<1||f.value>3650)throw new Error("invalid frequency value");return{value:f.value,unit,evidence_ref:f.evidence_ref||null}};
const consentBlock=o=>o?.consent?.known!==true||o?.consent?.permitted!==true||o?.consent?.opted_out===true;
export function buildRebookingResponseHandoff(input={}){
  rejectLegacy(input);
  const company_id=req(input.company_id,"company_id");
  const opportunity=validateOpportunity(input.opportunity,company_id);
  const recommendation=validateRecommendation(input.recommendation,company_id,opportunity.opportunity_id);
  const outreach=validateOutreach(input.outreach,company_id,opportunity.opportunity_id);
  const response=validateVerifiedResponse(input.response_event,company_id,opportunity.opportunity_id);
  const history=Array.isArray(input.response_history)?input.response_history:[];
  const duplicate=validateHistory(history,company_id,response.response_id);
  const reasons=[];
  if(duplicate)reasons.push("DUPLICATE_RESPONSE_SUPPRESSED");
  if(input.open_complaint===true)reasons.push("OPEN_COMPLAINT");
  if(input.service_recovery_active===true)reasons.push("SERVICE_RECOVERY_ACTIVE");
  if(input.customer_closed===true)reasons.push("CUSTOMER_CLOSED");
  const requestedWindow=response.requested_window||input.requested_window||opportunity.recurrence?.preferred_window||null;
  const result={
    schema:"titan.workforce.starter.rebooking-response-handoff.v1",
    response_handoff_id:`rebook-response:${company_id}:${opportunity.opportunity_id}:${response.response_id}`,
    company_id,customer_id:opportunity.customer_id,service_id:opportunity.service_id,opportunity_id:opportunity.opportunity_id,
    recommendation_id:recommendation?.recommendation_id||null,outreach_id:outreach?.outreach_id||null,response_id:response.response_id,
    response_type:response.response_type,responded_at:response.responded_at,source_message_id:response.source_message_id,
    state:"REVIEW",reasons:[],
    response_provenance:{verified:true,producer:req(response.producer,"response_event.producer"),source_message_id:response.source_message_id,channel:response.channel||outreach?.channel||null},
    booking_handoff:null,scheduling_handoff:null,defer_handoff:null,decline:null,
    consent_effect:{changes_consent:false,opt_out_requested:response.opt_out===true,requires_canonical_consent_update:response.opt_out===true},
    evidence_refs:uniq([response.evidence_ref,outreach?.governance?.authority_evidence_ref,...(recommendation?.evidence_refs||[]),...(Array.isArray(input.evidence_refs)?input.evidence_refs:[])]),
    creates_booking:false,creates_schedule:false,creates_followup:false,changes_consent:false,changes_authority:false,execution_permitted:false,grants_authority:false,identity_is_authority:false
  };
  if(duplicate){result.state="DUPLICATE_SUPPRESSED";result.reasons=uniq(reasons);return result}
  if(response.response_type==="NO"){
    result.state=response.opt_out===true?"DECLINED_OPT_OUT_REVIEW":"DECLINED";
    result.decline={scope:"CURRENT_REBOOKING_OPPORTUNITY",permanent_suppression:false,opt_out_requested:response.opt_out===true};
    result.reasons=uniq([...reasons,"CUSTOMER_DECLINED"]);
    return result;
  }
  if(response.response_type==="LATER"){
    let revisit_at=response.revisit_at||input.revisit_at||null;
    if(!revisit_at&&Number.isInteger(response.defer_days)&&response.defer_days>0){const d=parseDateTime(response.responded_at,"response_event.responded_at");d.setUTCDate(d.getUTCDate()+response.defer_days);revisit_at=d.toISOString()}
    if(!revisit_at)throw new Error("later response requires revisit_at or defer_days");
    const revisit=parseDateTime(revisit_at,"revisit_at"),responded=parseDateTime(response.responded_at,"response_event.responded_at");if(revisit<=responded)throw new Error("revisit_at must be after response");
    result.state=reasons.length?"REVIEW":"DEFERRED";
    result.defer_handoff={revisit_at,scheduler_owned:true,creates_followup:false,requires_future_governance_recheck:true,requires_fresh_consent_recheck:true};
    result.reasons=uniq(reasons);
    return result;
  }
  if(response.response_type==="CHANGE_FREQUENCY"){
    const frequency=normalizeFrequency(response.frequency||input.frequency);
    result.state=reasons.length?"REVIEW":"SCHEDULING_REVIEW_READY";
    result.scheduling_handoff={canonical_engine:"titan.workforce.schedule-recurrence.v1",action:"PROPOSE_FREQUENCY_CHANGE",frequency,customer_explicit:true,creates_schedule:false,mutates_schedule:false,requires_existing_schedule_resolution:true,requires_fresh_authority_evaluation:true};
    result.reasons=uniq(reasons);
    return result;
  }
  // YES means customer intent, never direct booking authority.
  if(consentBlock(opportunity))reasons.push("CANONICAL_CONSENT_BLOCK");
  if(input.active_booking_exists===true)reasons.push("ACTIVE_BOOKING_EXISTS");
  if(opportunity.suppression?.suppressed===true)reasons.push("OPPORTUNITY_SUPPRESSED");
  result.state=reasons.length?"REVIEW":"BOOKING_REVIEW_READY";
  result.booking_handoff={workflow:"titan-business-services/workflows/service_booking.json",intent:"CUSTOMER_REBOOKING_YES",requested_window:requestedWindow,idempotency_key:opportunity.booking_handoff?.idempotency_key||`rebooking:${company_id}:${opportunity.opportunity_id}:booking`,requires_authoritative_duplicate_booking_check:true,requires_fresh_authority_evaluation:true,execution_permitted:false,customer_explicit:true};
  result.reasons=uniq(reasons);
  return result;
}
