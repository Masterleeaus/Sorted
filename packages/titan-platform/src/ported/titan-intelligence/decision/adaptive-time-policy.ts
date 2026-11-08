// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/adaptive-time-policy.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { stableCorrelationHash } from "./correlation-layer.js";

export const ADAPTIVE_TIME_POLICY_VERSION = "1.0.0";
export const ADAPTIVE_TIME_POLICY_FIELDS = Object.freeze([
  "time_policy_id", "company_id", "packet_id", "recommended_action_id", "action_type",
  "source_provider", "source_revision", "risk_level", "evidence_state", "urgency_level",
  "business_impact", "reversibility", "blast_radius", "authority_required", "requirement_level",
  "event_time", "review_at", "expires_at", "authority_valid_until", "review_after_ms",
  "expires_after_ms", "authority_valid_for_ms", "reason_codes", "invalidation_triggers",
  "policy_revision", "inputs_digest", "projection_only", "authority_granted", "execution_permitted"
]);

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;
const LEVEL = Object.freeze({unknown:0,none:0,low:1,medium:2,high:3,critical:4,immediate:4});
const EVIDENCE = Object.freeze({verified:0,partial:1,unknown:2,stale:3,missing:4,untrusted:4,contradictory:4,expired:4});
const REVERSIBILITY = Object.freeze({reversible:0,partially_reversible:1,unknown:2,difficult:3,irreversible:4});
const BLAST = Object.freeze({single_record:0,single_subject:0,small:1,team:2,workflow:2,department:3,multi_department:3,company:4,cross_company:4,external:4,unknown:2});

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const text = (value,code) => { if(typeof value!=="string"||!value.trim()) throw new Error(code); return value.trim(); };
const token = value => String(value??"").trim().toLowerCase().replace(/[\s-]+/g,"_").replace(/[^a-z0-9._:]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"");
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uniq = values => [...new Set(values)];
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const iso = ms => new Date(ms).toISOString();

function scalarLevel(value, fallback="unknown") {
  const raw = isObject(value) ? (value.level ?? value.state ?? value.value) : value;
  const t = token(raw);
  return own(LEVEL,t) ? t : fallback;
}

function normalizeEvidence(value){ const t=token(value||"unknown"); return own(EVIDENCE,t)?t:"unknown"; }
function normalizeReversibility(value){ const t=token(value||"unknown"); return own(REVERSIBILITY,t)?t:"unknown"; }
function normalizeBlast(value){ const t=token(value||"unknown"); return own(BLAST,t)?t:"unknown"; }

function normalizePolicy(policy, companyId){
  const defaults={
    company_id:companyId, policy_revision:"adaptive-time-default-v1",
    minimum_expiry_ms:5*MINUTE, maximum_expiry_ms:14*DAY,
    minimum_review_ms:2*MINUTE, maximum_review_ms:7*DAY,
    maximum_authority_validity_ms:24*HOUR
  };
  if(policy==null) return Object.freeze(defaults);
  if(!isObject(policy)) throw new Error("invalid_adaptive_time_policy");
  if(text(policy.company_id,"policy_company_id_required")!==companyId) throw new Error("company_mismatch");
  const finite=(key,fallback)=>{ const n=Number(policy[key]??fallback); if(!Number.isFinite(n)||n<0) throw new Error(`invalid_${key}`); return Math.round(n); };
  const result={
    company_id:companyId,
    policy_revision:text(policy.policy_revision||"unversioned","policy_revision_required"),
    minimum_expiry_ms:finite("minimum_expiry_ms",defaults.minimum_expiry_ms),
    maximum_expiry_ms:finite("maximum_expiry_ms",defaults.maximum_expiry_ms),
    minimum_review_ms:finite("minimum_review_ms",defaults.minimum_review_ms),
    maximum_review_ms:finite("maximum_review_ms",defaults.maximum_review_ms),
    maximum_authority_validity_ms:finite("maximum_authority_validity_ms",defaults.maximum_authority_validity_ms)
  };
  if(result.minimum_expiry_ms>result.maximum_expiry_ms) throw new Error("invalid_expiry_policy_range");
  if(result.minimum_review_ms>result.maximum_review_ms) throw new Error("invalid_review_policy_range");
  return Object.freeze(result);
}

function baseExpiryForRisk(risk){
  switch(risk){
    case "critical": case "immediate": return 30*MINUTE;
    case "high": return 3*HOUR;
    case "medium": return 12*HOUR;
    case "low": return 3*DAY;
    case "none": return 7*DAY;
    default: return 12*HOUR;
  }
}

function actionVolatility(actionType){
  const t=token(actionType);
  if(/^(pay|refund|transfer|delete|remove|revoke|approve|grant|authorize|authorise|dispatch|book|invoice|publish|recover|restore|remediate)(_|$)/.test(t)) return 3;
  if(/^(create|update|change|modify|send|cancel|close)(_|$)/.test(t)) return 2;
  if(/^(recommend|propose|prepare|draft|request|notify|escalate)(_|$)/.test(t)) return 1;
  return 0;
}

function multiplierFromContext({risk,evidence,urgency,impact,reversibility,blast,actionType}){
  let pressure=0;
  pressure += LEVEL[risk] * 1.3;
  pressure += EVIDENCE[evidence] * 1.15;
  pressure += LEVEL[urgency] * 1.05;
  pressure += LEVEL[impact] * 1.1;
  pressure += REVERSIBILITY[reversibility] * 0.9;
  pressure += BLAST[blast] * 0.9;
  pressure += actionVolatility(actionType) * 0.8;
  // Smooth continuous shortening: roughly 1.0 at benign context to ~0.08 under maximum pressure.
  return clamp(1 / (1 + pressure * 0.22), 0.08, 1);
}

function authorityBase(requirementLevel,risk){
  if(requirementLevel==="human_only") return 15*MINUTE;
  if(risk==="critical"||risk==="immediate") return 10*MINUTE;
  if(risk==="high") return 30*MINUTE;
  if(requirementLevel==="approval") return 60*MINUTE;
  if(requirementLevel==="review") return 2*HOUR;
  return 0;
}

/**
 * Event-time advisory time policy. It does not issue, refresh or validate authority.
 * Any actual authority proof must be independently granted and may not outlive authority_valid_until.
 */
export function determineAdaptiveTimePolicy(recommendedAction, expectedCompanyId, context={}, now=Date.now()){
  if(!isObject(recommendedAction)) throw new Error("recommended_action_required");
  const companyId=text(expectedCompanyId,"expected_company_id_required");
  if(text(recommendedAction.company_id,"company_id_required")!==companyId) throw new Error("company_mismatch");
  if(recommendedAction.projection_only!==true||recommendedAction.proposal_only!==true||recommendedAction.execution_permitted!==false||recommendedAction.authority_granted!==false) throw new Error("recommended_action_boundary_invalid");
  if(!isObject(recommendedAction.adaptive_risk)) throw new Error("adaptive_risk_required");
  if(!isObject(recommendedAction.authority_requirement)) throw new Error("authority_requirement_required");
  const eventMs=Number(now); if(!Number.isFinite(eventMs)) throw new Error("invalid_now");
  const policy=normalizePolicy(context.company_policy,companyId);
  const risk=scalarLevel(recommendedAction.adaptive_risk.level||recommendedAction.risk,"unknown");
  const evidence=normalizeEvidence(recommendedAction.evidence_state);
  const urgency=scalarLevel(recommendedAction.urgency,"unknown");
  const dims=recommendedAction.adaptive_risk.dimensions||{};
  const impact=scalarLevel(dims.business_impact?.level||context.business_impact||"unknown","unknown");
  const reversibility=normalizeReversibility(dims.reversibility?.level||context.reversibility||"unknown");
  const blast=normalizeBlast(dims.blast_radius?.level||context.blast_radius||"unknown");
  const requirementLevel=token(recommendedAction.authority_requirement.requirement_level||"none")||"none";
  const authorityRequired=recommendedAction.authority_requirement.authority_required===true;
  const factor=multiplierFromContext({risk,evidence,urgency,impact,reversibility,blast,actionType:recommendedAction.action_type});

  let expiryMs=Math.round(baseExpiryForRisk(risk)*factor);
  const reasons=[];
  if(EVIDENCE[evidence]>=3) reasons.push("evidence_requires_faster_revalidation");
  if(LEVEL[urgency]>=3) reasons.push("time_sensitive_event");
  if(LEVEL[impact]>=3) reasons.push("high_business_impact");
  if(REVERSIBILITY[reversibility]>=3) reasons.push("low_reversibility");
  if(BLAST[blast]>=3) reasons.push("wide_blast_radius");
  if(risk==="critical"||risk==="immediate") reasons.push("critical_contextual_risk");
  else if(risk==="high") reasons.push("high_contextual_risk");
  if(actionVolatility(recommendedAction.action_type)>=2) reasons.push("state_changing_action");

  expiryMs=clamp(expiryMs,policy.minimum_expiry_ms,policy.maximum_expiry_ms);
  const sourceExpiresMs=Date.parse(recommendedAction.expires_at);
  if(Number.isFinite(sourceExpiresMs)){
    const remaining=Math.max(0,sourceExpiresMs-eventMs);
    if(remaining<expiryMs){ expiryMs=remaining; reasons.push("source_projection_expiry_ceiling"); }
  }
  // Never revive an already expired source projection.
  expiryMs=Math.max(0,expiryMs);

  const trustHeld=isObject(recommendedAction.trust_gate)&&recommendedAction.trust_gate.recommendation_permitted===false;
  if(trustHeld){ expiryMs=Math.min(expiryMs,30*MINUTE); reasons.push("trust_gate_hold_expiry_ceiling"); }
  let reviewMs=Math.round(expiryMs * (risk==="critical"||risk==="immediate" ? 0.25 : risk==="high" ? 0.4 : evidence==="verified" ? 0.7 : 0.5));
  if(expiryMs>0) reviewMs=clamp(reviewMs,Math.min(policy.minimum_review_ms,expiryMs),Math.min(policy.maximum_review_ms,expiryMs));
  else reviewMs=0;

  let authorityMs=0;
  if(authorityRequired){
    authorityMs=Math.round(authorityBase(requirementLevel,risk)*factor);
    const lowerBound=Math.min(2*MINUTE,expiryMs);
    authorityMs=clamp(authorityMs,lowerBound,Math.min(policy.maximum_authority_validity_ms,expiryMs));
    reasons.push("authority_window_context_bound");
  }
  if(trustHeld){
    reviewMs=Math.min(reviewMs,5*MINUTE,expiryMs);
    authorityMs=0;
    reasons.push("trust_gate_blocks_authority_validity");
  }

  const invalidationTriggers=Object.freeze(uniq([
    "source_revision_change","evidence_state_change","risk_increase","policy_change","scope_change",
    "actor_change","model_or_provider_change","hold_or_probation","source_expiry",
    ...(authorityRequired?["authority_context_change"]:[])
  ]));
  const material={company_id:companyId,packet_id:recommendedAction.packet_id,recommended_action_id:recommendedAction.recommended_action_id,
    action_type:recommendedAction.action_type,source_provider:recommendedAction.source_provider,source_revision:recommendedAction.source_revision,
    risk,evidence,urgency,impact,reversibility,blast,authority_required:authorityRequired,requirement_level:requirementLevel,
    expiry_ms:expiryMs,review_ms:reviewMs,authority_ms:authorityMs,policy_revision:policy.policy_revision,event_time:iso(eventMs)};
  const digest=stableCorrelationHash(material);

  return Object.freeze({
    time_policy_id:`datp_${digest}`,
    company_id:companyId,
    packet_id:text(recommendedAction.packet_id,"packet_id_required"),
    recommended_action_id:text(recommendedAction.recommended_action_id,"recommended_action_id_required"),
    action_type:text(recommendedAction.action_type,"action_type_required"),
    source_provider:text(recommendedAction.source_provider,"source_provider_required"),
    source_revision:clone(recommendedAction.source_revision),
    risk_level:risk,
    evidence_state:evidence,
    urgency_level:urgency,
    business_impact:impact,
    reversibility,
    blast_radius:blast,
    authority_required:authorityRequired,
    requirement_level:requirementLevel,
    event_time:iso(eventMs),
    review_at:iso(eventMs+reviewMs),
    expires_at:iso(eventMs+expiryMs),
    authority_valid_until:authorityRequired?iso(eventMs+authorityMs):null,
    review_after_ms:reviewMs,
    expires_after_ms:expiryMs,
    authority_valid_for_ms:authorityMs,
    reason_codes:Object.freeze(uniq(reasons)),
    invalidation_triggers:invalidationTriggers,
    policy_revision:policy.policy_revision,
    inputs_digest:digest,
    projection_only:true,
    authority_granted:false,
    execution_permitted:false
  });
}

export function validateAdaptiveTimePolicy(value, expectedCompanyId){
  try{
    if(!isObject(value)) return {valid:false,error:"invalid_adaptive_time_policy"};
    const missing=ADAPTIVE_TIME_POLICY_FIELDS.filter(k=>!own(value,k)); if(missing.length) return {valid:false,error:"missing_fields",missing};
    const extra=Object.keys(value).filter(k=>!ADAPTIVE_TIME_POLICY_FIELDS.includes(k)); if(extra.length) return {valid:false,error:"unexpected_fields",extra};
    if(text(value.company_id,"company_id_required")!==text(expectedCompanyId,"expected_company_id_required")) return {valid:false,error:"company_mismatch"};
    for(const k of ["review_after_ms","expires_after_ms","authority_valid_for_ms"]) if(!Number.isInteger(value[k])||value[k]<0) return {valid:false,error:`invalid_${k}`};
    for(const k of ["event_time","review_at","expires_at"]) if(!Number.isFinite(Date.parse(value[k]))) return {valid:false,error:`invalid_${k}`};
    if(value.authority_required===true && !Number.isFinite(Date.parse(value.authority_valid_until))) return {valid:false,error:"authority_valid_until_required"};
    if(value.authority_required===false && value.authority_valid_until!==null) return {valid:false,error:"unexpected_authority_valid_until"};
    if(!Array.isArray(value.reason_codes)||!Array.isArray(value.invalidation_triggers)) return {valid:false,error:"invalid_time_policy_reasons"};
    if(value.projection_only!==true||value.authority_granted!==false||value.execution_permitted!==false) return {valid:false,error:"adaptive_time_boundary_invalid"};
    if(value.authority_valid_for_ms>value.expires_after_ms) return {valid:false,error:"authority_window_exceeds_projection_expiry"};
    text(value.time_policy_id,"time_policy_id_required"); text(value.inputs_digest,"inputs_digest_required");
    return {valid:true};
  }catch(error){ return {valid:false,error:error instanceof Error?error.message:String(error)}; }
}

async function getTrustedTimeContext(){
  const storage=await chrome.storage.local.get(["currentCompanyId","decisionAdaptiveTimePolicy","decisionAdaptiveTimeContext"]);
  return {company_id:storage.currentCompanyId||null,company_policy:storage.decisionAdaptiveTimePolicy||null,time_context:storage.decisionAdaptiveTimeContext||null};
}

if(typeof chrome!=="undefined"&&chrome.runtime?.onMessage){
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=="TITAN_ADAPTIVE_TIME_POLICY_DETERMINE") return undefined;
    (async()=>{ try{
      const trusted=await getTrustedTimeContext(); if(!trusted.company_id) throw new Error("company_context_required");
      const ctx={...(isObject(trusted.time_context)?trusted.time_context:{}),company_policy:trusted.company_policy};
      const result=determineAdaptiveTimePolicy(message.recommended_action,trusted.company_id,ctx,message.now_ms??Date.now());
      sendResponse({success:true,data:result});
    }catch(error){ sendResponse({success:false,error:error instanceof Error?error.message:String(error)}); } })();
    return true;
  });
}
