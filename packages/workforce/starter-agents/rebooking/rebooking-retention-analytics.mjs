const LEGACY_KEYS=["tenant_company_id","tenant_id","account_id","business_id"];
const req=(v,n)=>{if(typeof v!=="string"||!v.trim())throw new Error(`missing ${n}`);return v.trim()};
const rejectLegacy=i=>{for(const k of LEGACY_KEYS)if(i&&Object.prototype.hasOwnProperty.call(i,k))throw new Error(`legacy company boundary rejected: ${k}`)};
const uniq=a=>[...new Set((a||[]).filter(Boolean))].sort();
const parseDate=(v,n)=>{const s=req(v,n);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error(`invalid ${n}`);const d=new Date(`${s}T00:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw new Error(`invalid ${n}`);return d};
const days=(a,b)=>Math.floor((b-a)/86400000);
const pct=(n,d)=>d===0?0:Number(((n/d)*100).toFixed(2));
const validateEvent=(e,company_id)=>{if(!e||typeof e!=="object")throw new Error("invalid analytics event");rejectLegacy(e);if(e.company_id!==company_id)throw new Error("cross-company analytics event");return e};
export function buildRebookingRetentionAnalytics(input={}){
  rejectLegacy(input);
  const company_id=req(input.company_id,"company_id");
  const asOf=parseDate(input.as_of_date,"as_of_date");
  const events=Array.isArray(input.events)?input.events.map(e=>validateEvent(e,company_id)):[];
  const customers=new Map();
  let completed=0,rebooked=0,reactivated=0,declined=0,optedOut=0,outreach=0,convertedRecurring=0;
  const evidence=[];
  for(const e of events){
    const customer_id=req(e.customer_id,"event.customer_id");
    const type=req(e.type,"event.type").toUpperCase();
    const event_date=parseDate(e.event_date,"event.event_date");
    if(event_date>asOf)throw new Error("future analytics event rejected");
    evidence.push(e.event_id||null);
    const c=customers.get(customer_id)||{customer_id,completed_services:0,last_completed_date:null,last_rebooked_date:null,last_outreach_date:null,declines:0,opted_out:false,reactivations:0,recurring_conversions:0};
    if(type==="SERVICE_COMPLETED"){completed++;c.completed_services++;if(!c.last_completed_date||e.event_date>c.last_completed_date)c.last_completed_date=e.event_date}
    else if(type==="REBOOKED"){rebooked++;if(!c.last_rebooked_date||e.event_date>c.last_rebooked_date)c.last_rebooked_date=e.event_date}
    else if(type==="REACTIVATED"){reactivated++;c.reactivations++}
    else if(type==="REBOOKING_DECLINED"){declined++;c.declines++}
    else if(type==="OPTED_OUT"){optedOut++;c.opted_out=true}
    else if(type==="OUTREACH_SENT"){outreach++;if(!c.last_outreach_date||e.event_date>c.last_outreach_date)c.last_outreach_date=e.event_date}
    else if(type==="RECURRING_CONVERSION"){convertedRecurring++;c.recurring_conversions++}
    else throw new Error(`unsupported analytics event type: ${type}`);
    customers.set(customer_id,c);
  }
  const dormancyThreshold=Number(input.dormancy_threshold_days);if(!Number.isInteger(dormancyThreshold)||dormancyThreshold<1||dormancyThreshold>3650)throw new Error("invalid dormancy_threshold_days");
  const customerRows=[...customers.values()].map(c=>{
    const dormancy_days=c.last_completed_date?days(parseDate(c.last_completed_date,"customer.last_completed_date"),asOf):null;
    const dormant=dormancy_days!==null&&dormancy_days>=dormancyThreshold;
    return{...c,dormancy_days,dormant,analytics_only:true,eligible_for_action:null,consent_status_not_inferred:true,authority_status_not_inferred:true};
  }).sort((a,b)=>a.customer_id.localeCompare(b.customer_id));
  const dormantCustomers=customerRows.filter(c=>c.dormant).length;
  return{
    schema:"titan.workforce.starter.rebooking-retention-analytics.v1",
    company_id,
    as_of_date:input.as_of_date,
    dormancy_threshold_days:dormancyThreshold,
    counts:{events:events.length,customers:customerRows.length,completed_services:completed,rebooked,reactivated,rebooking_declines:declined,opted_out_events:optedOut,outreach_sent:outreach,recurring_conversions:convertedRecurring,dormant_customers:dormantCustomers},
    rates:{rebooking_per_completed_service_pct:pct(rebooked,completed),reactivation_per_dormant_customer_pct:pct(reactivated,dormantCustomers),decline_per_outreach_pct:pct(declined,outreach),recurring_conversion_per_rebooked_pct:pct(convertedRecurring,rebooked)},
    customers:customerRows,
    evidence_refs:uniq([...(Array.isArray(input.evidence_refs)?input.evidence_refs:[]),...evidence]),
    interpretation:{analytics_only:true,descriptive_not_authoritative:true,may_rank_for_review:false,may_trigger_outreach:false,may_create_booking:false,may_create_schedule:false,may_change_consent:false,may_override_suppression:false,may_grant_authority:false,may_execute:false},
    identity_is_authority:false,
    creates_schedule:false,
    creates_booking:false,
    sends_outreach:false,
    changes_consent:false,
    changes_suppression:false,
    execution_permitted:false,
    grants_authority:false
  };
}
