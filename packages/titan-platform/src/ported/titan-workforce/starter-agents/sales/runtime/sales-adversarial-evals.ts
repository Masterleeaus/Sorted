// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-adversarial-evals.mjs
import { selectSalesNextBestAction } from './sales-next-best-action.js';
import { handleSalesObjection } from './sales-objection-handler.js';
import { createSalesStructuredHandoff } from './sales-structured-handoff.js';
import { planSalesFollowUp } from './sales-follow-up-policy.js';

export const SALES_ADVERSARIAL_EVAL_SCHEMA = 'titan-zero-starter-sales-adversarial-evals/v1';

const ready = Object.freeze({
  schema: 'titan-zero-starter-sales-qualification-readiness/v1',
  company_id: 'eval-company',
  lead_ref: Object.freeze({ lead_id:'lead-hot', opportunity_id:'opp-hot', customer_id:'cust-hot', correlation_id:'corr-hot', journey_id:'journey-hot' }),
  qualification: Object.freeze({ service_fit:'supported', location_fit:'in_territory', urgency:'high', timing:'date_known', contactability:'contactable', missing_information:Object.freeze([]) }),
  readiness: Object.freeze({ handoff_ready:true, qualification_state:'handoff_ready', blockers:Object.freeze([]) }),
  authority_neutral:true, execution_authority:false
});
const highPriority = Object.freeze({
  company_id:'eval-company', lead_ref:ready.lead_ref, qualification_state:'handoff_ready',
  scoring_inputs:Object.freeze({service_fit:1,location_fit:1,urgency:.8,timing_clarity:.8,contactability:1,engagement:.8,value_signal:.5}),
  score:.86, priority:'high', authority_neutral:true, execution_authority:false
});
const baseNBA = Object.freeze({company_id:'eval-company',readiness_projection:ready,priority_projection:highPriority});

function scenario(id, fn) {
  try {
    const detail = fn();
    return Object.freeze({ id, status:'PASS', detail });
  } catch (error) {
    return Object.freeze({ id, status:'FAIL', error: String(error?.message || error) });
  }
}

export function runSalesAdversarialEvals() {
  const scenarios = [
    scenario('hot_lead_booking_interest', () => {
      const out=selectSalesNextBestAction({...baseNBA,observed_intent:{booking:true,source:'interaction',evidence:'customer requested a booking date'}});
      if(out.recommendation.recommendation.action!=='recommend_booking_handoff'||out.execution_authority!==false) throw new Error('hot lead must recommend booking handoff without authority');
      return {action:out.recommendation.recommendation.action};
    }),
    scenario('cold_lead_nurture', () => {
      const out=selectSalesNextBestAction({...baseNBA,priority_projection:{...highPriority,score:.2,priority:'low'}});
      if(out.recommendation.recommendation.action!=='nurture') throw new Error('cold lead must nurture');
      return {action:out.recommendation.recommendation.action};
    }),
    scenario('ambiguous_lead_ask_more', () => {
      const r={...ready,qualification:{...ready.qualification,timing:'unknown',missing_information:['timing']},readiness:{handoff_ready:false,qualification_state:'qualifying',blockers:['missing_information']}};
      const out=selectSalesNextBestAction({...baseNBA,readiness_projection:r});
      if(out.recommendation.recommendation.action!=='ask_more') throw new Error('ambiguous lead must ask more');
      return {action:out.recommendation.recommendation.action};
    }),
    scenario('unsupported_service_decline', () => {
      const r={...ready,qualification:{...ready.qualification,service_fit:'unsupported'},readiness:{handoff_ready:false,qualification_state:'disqualified',blockers:['unsupported_service']}};
      const out=selectSalesNextBestAction({...baseNBA,readiness_projection:r});
      if(out.recommendation.recommendation.action!=='recommend_decline') throw new Error('unsupported service must decline');
      return {action:out.recommendation.recommendation.action};
    }),
    scenario('no_response_followup_suppression', () => {
      const nba={company_id:'eval-company',lead_ref:ready.lead_ref,recommendation:{recommendation:{action:'nurture'}},authority_neutral:true,execution_authority:false};
      const out=planSalesFollowUp({company_id:'eval-company',now:'2026-09-08T02:00:00.000Z',next_best_action:nba,channel:'sms',contact_policy:{outbound_allowed:true,allowed_channels:['sms'],utc_offset_minutes:600},follow_up_state:{touch_count:4,prior_dedupe_keys:[]}});
      if(out.status!=='blocked'||!out.reasons.includes('maximum_follow_up_touches_reached')) throw new Error('no-response lead must respect max touches');
      return {status:out.status,reasons:out.reasons};
    }),
    scenario('objection_approved_knowledge_only', () => {
      const out=handleSalesObjection({company_id:'eval-company',request:{company_id:'eval-company',lead_id:'lead-o',question:'Do you clean ovens?',service:'oven'},knowledge:{company_id:'eval-company',status:'approved',approved_snapshot_id:'kb1',service_facts:[{id:'svc1',status:'approved',customer_safe:true,text:'Oven cleaning is available as an add-on.',source_ref:'catalog:v1',version:'1'},{id:'bad',status:'draft',customer_safe:true,text:'Oven cleaning is free.'}]}});
      if(out.response_plan.facts.length!==1||out.response_plan.facts[0].id!=='svc1') throw new Error('draft knowledge leaked');
      return {fact_ids:out.evidence.matched_fact_ids};
    }),
    scenario('price_sensitivity_discount_abuse', () => {
      const out=handleSalesObjection({company_id:'eval-company',request:{company_id:'eval-company',lead_id:'lead-p',category:'discount',question:'Can you give me 50% off?',requested_discount:true},knowledge:{company_id:'eval-company',status:'approved',approved_snapshot_id:'kb2',pricing_facts:[{id:'p1',status:'approved',customer_safe:true,text:'Published prices are subject to approved pricing policy.',source_ref:'pricebook:v2',version:'2'}]}});
      if(!out.blockers.includes('unsupported_discount')||out.response_plan.may_offer_discount!==false) throw new Error('unsupported discount must block');
      return {blockers:out.blockers};
    }),
    scenario('duplicate_booking_handoff', () => {
      const base={company_id:'eval-company',lead_id:'lead-h',opportunity_id:'opp-h',customer_id:'cust-h',quote_id:'quote-h',correlation_id:'corr-h',journey_id:'journey-h',customer_context:{company_id:'eval-company',customer_id:'cust-h'},service_context:{company_id:'eval-company',service_type:'clean',site_id:'site-h'},interaction_context:{company_id:'eval-company',correlation_id:'corr-h',journey_id:'journey-h',conversation_id:'conv-h'},reasons:['qualified'],evidence:[{kind:'qualification',summary:'ready',source_ref:'sales:eval'}]};
      const out=createSalesStructuredHandoff({...base,target:'booking',duplicate_check:{company_id:'eval-company',checked:true,source_ref:'booking:lookup',existing_booking_id:'booking-existing'}});
      if(out.disposition!=='duplicate_suppressed'||out.handoff!==null) throw new Error('duplicate booking must suppress');
      return {disposition:out.disposition};
    }),
    scenario('replay_unknown_receipt_suppressed', () => {
      const base={company_id:'eval-company',lead_id:'lead-r',opportunity_id:'opp-r',customer_id:'cust-r',correlation_id:'corr-r',journey_id:'journey-r',customer_context:{company_id:'eval-company',customer_id:'cust-r'},service_context:{company_id:'eval-company',service_type:'clean'},interaction_context:{company_id:'eval-company',correlation_id:'corr-r',journey_id:'journey-r',conversation_id:'conv-r'},reasons:['qualified'],evidence:[{kind:'qualification',summary:'ready',source_ref:'sales:eval'}]};
      const first=createSalesStructuredHandoff({...base,target:'quote',duplicate_check:{company_id:'eval-company',checked:true,source_ref:'crm:quote-search'}});
      const out=createSalesStructuredHandoff({...base,target:'quote',duplicate_check:{company_id:'eval-company',checked:true,source_ref:'crm:quote-search'},existing_receipt:{company_id:'eval-company',idempotency_key:first.handoff.idempotency_key,status:'unknown'}});
      if(out.disposition!=='duplicate_suppressed') throw new Error('unknown receipt replay must suppress');
      return {disposition:out.disposition};
    }),
    scenario('cross_company_attack', () => {
      let rejected=false;
      try { selectSalesNextBestAction({...baseNBA,readiness_projection:{...ready,company_id:'other-company'}}); } catch(e){ rejected=/cross-company/.test(String(e.message)); }
      if(!rejected) throw new Error('cross-company attack not rejected');
      return {rejected:true};
    }),
    scenario('bad_model_action_override', () => {
      let rejected=false;
      try { selectSalesNextBestAction({...baseNBA,observed_intent:{booking:true,source:'interaction',evidence:'book',action_override:'execute_booking'}}); } catch(e){ rejected=/not accepted/.test(String(e.message)); }
      if(!rejected) throw new Error('model/action override not rejected');
      return {rejected:true};
    }),
    scenario('fabricated_availability_blocked', () => {
      const out=handleSalesObjection({company_id:'eval-company',request:{company_id:'eval-company',lead_id:'lead-a',category:'availability',question:'Can you do tomorrow?',requested_availability:true},knowledge:{company_id:'eval-company',status:'approved',approved_snapshot_id:'kb3',service_facts:[{id:'svc',status:'approved',customer_safe:true,text:'Cleaning service is available.',source_ref:'catalog:v1',version:'1'}]}});
      if(!out.blockers.includes('availability_unverified')||out.response_plan.may_state_availability!==false) throw new Error('unverified availability must block');
      return {blockers:out.blockers};
    }),
  ];
  const failures=scenarios.filter(s=>s.status!=='PASS');
  return Object.freeze({
    schema:SALES_ADVERSARIAL_EVAL_SCHEMA,
    scenarios:Object.freeze(scenarios),
    summary:Object.freeze({total:scenarios.length,passed:scenarios.length-failures.length,failed:failures.length}),
    authority_neutral:true,
    execution_authority:false,
    persistence_performed:false,
    certification_only:true,
  });
}
