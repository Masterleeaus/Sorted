// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/feed/feed-human-decision-routing.mjs
import { feedSeverityProfile, normalizeFeedSeverity } from './feed-severity.js';

export const FEED_HUMAN_DECISION_ROUTING_SCHEMA = 'titan.feed.human-decision-routing.v1';
export const HUMAN_DECISION_SURFACES = Object.freeze({
  FEED: 'feed',
  DECISION_FEED: 'decision_feed',
  APPROVAL_QUEUE: 'approval_queue',
  HUMAN_REVIEW: 'human_review'
});

const LEGACY_TENANT_KEYS = new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId']);
const text=(v)=>typeof v==='string'&&v.trim()?v.trim():null;
const obj=(v)=>v&&typeof v==='object'&&!Array.isArray(v);
function assertNoLegacy(value,path='root'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((v,i)=>assertNoLegacy(v,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value)){
    if(LEGACY_TENANT_KEYS.has(k)) throw new Error(`legacy_tenant_field_rejected:${path}.${k}`);
    assertNoLegacy(v,`${path}.${k}`);
  }
}
function company(record){
  const id=text(record?.company_id);
  if(!id) throw new Error('company_id_required');
  for(const candidate of [record?.payload?.company_id,record?.authority_requirement?.company_id,record?.decision_packet?.company_id,record?.recommended_action?.company_id]){
    if(text(candidate)&&text(candidate)!==id) throw new Error('company_mismatch');
  }
  return id;
}
function riskToken(record){
  return String(record?.risk_level ?? record?.risk?.level ?? record?.risk ?? '').trim().toLowerCase();
}
function requirement(record){
  const r=obj(record?.authority_requirement)?record.authority_requirement:{};
  const level=String(r.requirement_level ?? record?.requirement_level ?? '').trim().toLowerCase();
  const required=r.authority_required===true || record?.authority_required===true || record?.approval_required===true || ['approval','human_only'].includes(level);
  return {required,level,requirement_id:text(r.authority_requirement_id),reason_codes:Array.isArray(r.reason_codes)?[...new Set(r.reason_codes.map(text).filter(Boolean))].sort():[]};
}
function navigation(record,surface){
  const existing=obj(record?.navigation)?record.navigation:{};
  const packetId=text(record?.packet_id ?? record?.decision_packet?.packet_id);
  const decisionId=text(record?.decision_id);
  const actionId=text(record?.action_id ?? record?.recommended_action_id ?? record?.recommended_action?.recommended_action_id);
  return Object.freeze({
    surface,
    route:text(existing.route),
    view:text(existing.view) ?? surface,
    packet_id:packetId,
    decision_id:decisionId,
    action_id:actionId,
    entity_type:text(existing.entity_type),
    entity_id:text(existing.entity_id)
  });
}

/** Read-only routing projection. It never grants approval, authority, or execution permission. */
export function routeFeedItemToHumanDecisionSurface(record, expectedCompanyId=null){
  if(!obj(record)) throw new Error('feed_record_required');
  assertNoLegacy(record);
  const companyId=company(record);
  if(expectedCompanyId!==null && text(expectedCompanyId)!==companyId) throw new Error('company_mismatch');
  const req=requirement(record);
  const severity=normalizeFeedSeverity(record.severity ?? record.urgency ?? record.priority ?? 'UNKNOWN');
  const severityProfile=feedSeverityProfile(severity);
  const risk=riskToken(record);
  const highRisk=['high','critical','immediate'].includes(risk) || severityProfile.rank>=4;
  const packetId=text(record.packet_id ?? record?.decision_packet?.packet_id);
  let surface=HUMAN_DECISION_SURFACES.FEED;
  let reason='routine_feed_projection';
  if(req.level==='human_only') { surface=HUMAN_DECISION_SURFACES.HUMAN_REVIEW; reason='human_only_requirement'; }
  else if(req.required) { surface=HUMAN_DECISION_SURFACES.APPROVAL_QUEUE; reason='approval_required'; }
  else if(highRisk || packetId) { surface=HUMAN_DECISION_SURFACES.DECISION_FEED; reason=highRisk?'high_risk_human_review':'decision_packet_review'; }
  return Object.freeze({
    schema:FEED_HUMAN_DECISION_ROUTING_SCHEMA,
    company_id:companyId,
    source_entry_id:text(record.entry_id ?? record.id),
    packet_id:packetId,
    decision_id:text(record.decision_id),
    recommended_action_id:text(record.recommended_action_id ?? record?.recommended_action?.recommended_action_id),
    authority_requirement_id:req.requirement_id,
    severity,
    risk_level:risk||'unknown',
    authority_required:req.required,
    requirement_level:req.level||'none',
    reason_codes:req.reason_codes,
    target_surface:surface,
    routing_reason:reason,
    navigation:navigation(record,surface),
    projection_only:true,
    human_attention_required:surface!==HUMAN_DECISION_SURFACES.FEED,
    authority_granted:false,
    execution_permitted:false,
    grants_authority:false,
    authority_effect:false,
    identity_not_authority:true
  });
}

export function partitionHumanDecisionRouting(records, expectedCompanyId){
  if(!Array.isArray(records)) throw new Error('feed_records_array_required');
  const out={feed:[],decision_feed:[],approval_queue:[],human_review:[]};
  for(const record of records){
    const routed=routeFeedItemToHumanDecisionSurface(record,expectedCompanyId);
    out[routed.target_surface].push(routed);
  }
  return Object.freeze(Object.fromEntries(Object.entries(out).map(([k,v])=>[k,Object.freeze(v)])));
}
