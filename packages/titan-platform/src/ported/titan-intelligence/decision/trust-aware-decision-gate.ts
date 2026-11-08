// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/trust-aware-decision-gate.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { stableCorrelationHash } from "./correlation-layer.js";

export const TRUST_AWARE_DECISION_GATE_VERSION = "1.0.0";
export const TRUST_GATE_STATES = Object.freeze(["allow", "review", "hold_for_evidence", "blocked_expired"]);
export const TRUST_AWARE_GATE_FIELDS = Object.freeze([
  "trust_gate_id", "company_id", "packet_id", "recommended_action_id", "action_type",
  "source_provider", "source_revision", "evidence_state", "evidence_signals", "evidence_quality",
  "business_impact", "risk_level", "high_impact", "gate_state", "recommendation_permitted",
  "human_review_required", "evidence_refresh_required", "escalation_required", "reason_codes",
  "policy_revision", "inputs_digest", "evaluated_at", "projection_only", "authority_granted",
  "execution_permitted"
]);

const BAD_STATES = new Set(["missing", "stale", "contradictory", "expired", "untrusted"]);
const REVIEW_STATES = new Set(["partial", "unknown"]);
const IMPACT_RANK = Object.freeze({none:0, low:1, medium:2, high:3, critical:4, immediate:4, unknown:2});
const QUALITY = Object.freeze({
  verified:"strong", partial:"limited", stale:"degraded", contradictory:"conflicted",
  missing:"insufficient", expired:"expired", untrusted:"untrusted", unknown:"unknown"
});
const isObject=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const text=(v,c)=>{if(typeof v!=="string"||!v.trim()) throw new Error(c); return v.trim();};
const token=v=>String(v??"").trim().toLowerCase().replace(/[\s-]+/g,"_").replace(/[^a-z0-9._:]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"");
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const uniq=v=>[...new Set(v)];

function normalizeImpact(value){
  const t=token(isObject(value)?value.level:value)||"unknown";
  return own(IMPACT_RANK,t) ? (t==="immediate"?"critical":t) : "unknown";
}
function normalizeRisk(value){
  const t=token(isObject(value)?value.level:value)||"unknown";
  return ["none","low","medium","high","critical","immediate","unknown"].includes(t) ? (t==="immediate"?"critical":t) : "unknown";
}
function normalizeEvidence(value){
  const t=token(value)||"unknown";
  return own(QUALITY,t)?t:"unknown";
}
function normalizePolicy(policy,companyId){
  const base={company_id:companyId,policy_revision:"trust-gate-default-v1",high_impact_at_or_above:"high",additional_hold_states:[],additional_review_states:[]};
  if(policy==null) return Object.freeze(base);
  if(!isObject(policy)) throw new Error("invalid_trust_gate_policy");
  if(text(policy.company_id,"trust_policy_company_id_required")!==companyId) throw new Error("company_mismatch");
  let threshold=token(policy.high_impact_at_or_above||base.high_impact_at_or_above);
  if(!own(IMPACT_RANK,threshold)) throw new Error("invalid_high_impact_threshold");
  // Company policy may tighten the threshold, never weaken the default HIGH boundary.
  if(IMPACT_RANK[threshold] > IMPACT_RANK.high) threshold="high";
  const addHold=Array.isArray(policy.additional_hold_states)?policy.additional_hold_states.map(token).filter(x=>own(QUALITY,x)):[];
  const addReview=Array.isArray(policy.additional_review_states)?policy.additional_review_states.map(token).filter(x=>own(QUALITY,x)):[];
  return Object.freeze({company_id:companyId,policy_revision:text(policy.policy_revision||"unversioned","trust_policy_revision_required"),high_impact_at_or_above:threshold,additional_hold_states:Object.freeze(uniq(addHold)),additional_review_states:Object.freeze(uniq(addReview))});
}
function evidenceSignals(refs, nowMs){
  const signals=[];
  for(const ref of Array.isArray(refs)?refs:[]){
    if(!isObject(ref)) continue;
    for(const k of ["evidence_state","state","status","trust_state","quality_state"]){
      const t=token(ref[k]); if(BAD_STATES.has(t)||REVIEW_STATES.has(t)) signals.push(t);
    }
    if(ref.trusted===false||ref.untrusted===true) signals.push("untrusted");
    if(ref.stale===true) signals.push("stale");
    if(ref.contradictory===true||ref.contradiction===true) signals.push("contradictory");
    if(ref.missing===true) signals.push("missing");
    for(const k of ["expires_at","valid_until","evidence_expires_at"]){
      const ms=Date.parse(ref[k]); if(Number.isFinite(ms)&&ms<=nowMs) signals.push("expired");
    }
  }
  return uniq(signals);
}
function worstEvidence(primary, signals, sourceExpired){
  const order={verified:0,partial:1,unknown:2,stale:3,expired:4,missing:5,contradictory:6,untrusted:7};
  const values=[normalizeEvidence(primary),...signals.map(normalizeEvidence)];
  if(sourceExpired) values.push("expired");
  return values.sort((a,b)=>(order[b]??2)-(order[a]??2))[0]||"unknown";
}

/**
 * Read-only evidence/trust gate for recommendation projections.
 * It never grants authority, executes an action, or mutates the source DecisionPacket.
 */
export function evaluateTrustAwareDecisionGate(recommendedAction, expectedCompanyId, context={}, now=Date.now()){
  if(!isObject(recommendedAction)) throw new Error("recommended_action_required");
  const companyId=text(expectedCompanyId,"expected_company_id_required");
  if(text(recommendedAction.company_id,"company_id_required")!==companyId) throw new Error("company_mismatch");
  if(recommendedAction.projection_only!==true||recommendedAction.proposal_only!==true||recommendedAction.execution_permitted!==false||recommendedAction.authority_granted!==false) throw new Error("recommended_action_boundary_invalid");
  if(!isObject(recommendedAction.adaptive_risk)) throw new Error("adaptive_risk_required");
  const currentMs=Number(now); if(!Number.isFinite(currentMs)) throw new Error("invalid_now");
  const policy=normalizePolicy(context.company_policy,companyId);
  const dims=recommendedAction.adaptive_risk.dimensions||{};
  const impact=normalizeImpact(dims.business_impact?.level||context.business_impact||recommendedAction.risk);
  const risk=normalizeRisk(recommendedAction.adaptive_risk.level||recommendedAction.risk);
  const sourceExpiry=Date.parse(recommendedAction.expires_at);
  const sourceExpired=Number.isFinite(sourceExpiry)&&sourceExpiry<=currentMs;
  const signals=evidenceSignals(recommendedAction.evidence_refs,currentMs);
  if(Array.isArray(recommendedAction.evidence_refs)&&recommendedAction.evidence_refs.length===0) signals.push("missing");
  const evidence=worstEvidence(recommendedAction.evidence_state,signals,sourceExpired);
  const threshold=IMPACT_RANK[policy.high_impact_at_or_above]??IMPACT_RANK.high;
  const irreversibleWide = dims.reversibility?.level==="irreversible" && ["company","multi_company"].includes(dims.blast_radius?.level);
  const highImpact=IMPACT_RANK[impact]>=threshold || ["high","critical"].includes(risk) || irreversibleWide;
  const holdStates=new Set([...BAD_STATES,...policy.additional_hold_states]);
  const reviewStates=new Set([...REVIEW_STATES,...policy.additional_review_states]);
  const reasons=[];
  let gateState="allow";
  if(sourceExpired||evidence==="expired"){
    gateState="blocked_expired"; reasons.push(sourceExpired?"source_projection_expired":"evidence_expired");
  }else if(highImpact&&holdStates.has(evidence)){
    gateState="hold_for_evidence"; reasons.push("high_impact_unreliable_evidence",`evidence_${evidence}`);
  }else if(highImpact&&reviewStates.has(evidence)){
    gateState="review"; reasons.push("high_impact_evidence_review_required",`evidence_${evidence}`);
  }else if(holdStates.has(evidence)||reviewStates.has(evidence)){
    gateState="review"; reasons.push("evidence_review_required",`evidence_${evidence}`);
  }
  if(highImpact) reasons.push("high_impact_context");
  if(irreversibleWide) reasons.push("irreversible_wide_blast_context");
  for(const s of signals) if(BAD_STATES.has(s)&&s!==evidence) reasons.push(`evidence_signal_${s}`);
  const permitted=gateState==="allow"||gateState==="review";
  const humanReview=gateState!=="allow";
  const evidenceRefresh=gateState==="hold_for_evidence"||gateState==="blocked_expired"||["missing","stale","expired","untrusted","contradictory"].includes(evidence);
  const escalation=gateState==="hold_for_evidence"||gateState==="blocked_expired";
  const reasonCodes=Object.freeze(uniq(reasons));
  const material={company_id:companyId,packet_id:recommendedAction.packet_id,recommended_action_id:recommendedAction.recommended_action_id,action_type:recommendedAction.action_type,source_provider:recommendedAction.source_provider,source_revision:recommendedAction.source_revision,evidence_state:evidence,evidence_signals:uniq(signals),business_impact:impact,risk_level:risk,high_impact:highImpact,gate_state:gateState,policy_revision:policy.policy_revision};
  const digest=stableCorrelationHash(material);
  return Object.freeze({
    trust_gate_id:`dtg_${digest}`,
    company_id:companyId,
    packet_id:text(recommendedAction.packet_id,"packet_id_required"),
    recommended_action_id:text(recommendedAction.recommended_action_id,"recommended_action_id_required"),
    action_type:text(recommendedAction.action_type,"action_type_required"),
    source_provider:text(recommendedAction.source_provider,"source_provider_required"),
    source_revision:clone(recommendedAction.source_revision),
    evidence_state:evidence,
    evidence_signals:Object.freeze(uniq(signals)),
    evidence_quality:QUALITY[evidence]||"unknown",
    business_impact:impact,
    risk_level:risk,
    high_impact:highImpact,
    gate_state:gateState,
    recommendation_permitted:permitted,
    human_review_required:humanReview,
    evidence_refresh_required:evidenceRefresh,
    escalation_required:escalation,
    reason_codes:reasonCodes,
    policy_revision:policy.policy_revision,
    inputs_digest:digest,
    evaluated_at:new Date(currentMs).toISOString(),
    projection_only:true,
    authority_granted:false,
    execution_permitted:false
  });
}

export function validateTrustAwareDecisionGate(value, expectedCompanyId){
  try{
    if(!isObject(value)) return {valid:false,error:"invalid_trust_gate"};
    const missing=TRUST_AWARE_GATE_FIELDS.filter(k=>!own(value,k)); if(missing.length) return {valid:false,error:"missing_fields",missing};
    const extra=Object.keys(value).filter(k=>!TRUST_AWARE_GATE_FIELDS.includes(k)); if(extra.length) return {valid:false,error:"unexpected_fields",extra};
    if(text(value.company_id,"company_id_required")!==text(expectedCompanyId,"expected_company_id_required")) return {valid:false,error:"company_mismatch"};
    if(!TRUST_GATE_STATES.includes(value.gate_state)) return {valid:false,error:"invalid_gate_state"};
    if(typeof value.high_impact!=="boolean"||typeof value.recommendation_permitted!=="boolean"||typeof value.human_review_required!=="boolean"||typeof value.evidence_refresh_required!=="boolean"||typeof value.escalation_required!=="boolean") return {valid:false,error:"invalid_trust_gate_boolean"};
    if(!Array.isArray(value.evidence_signals)||!Array.isArray(value.reason_codes)) return {valid:false,error:"invalid_trust_gate_reasons"};
    if((value.gate_state==="hold_for_evidence"||value.gate_state==="blocked_expired")&&value.recommendation_permitted!==false) return {valid:false,error:"held_recommendation_cannot_be_permitted"};
    if(value.projection_only!==true||value.authority_granted!==false||value.execution_permitted!==false) return {valid:false,error:"trust_gate_boundary_invalid"};
    text(value.trust_gate_id,"trust_gate_id_required"); text(value.packet_id,"packet_id_required"); text(value.recommended_action_id,"recommended_action_id_required"); text(value.inputs_digest,"inputs_digest_required");
    if(!Number.isFinite(Date.parse(value.evaluated_at))) return {valid:false,error:"invalid_evaluated_at"};
    return {valid:true};
  }catch(error){return {valid:false,error:error instanceof Error?error.message:String(error)};}
}

async function getTrustedTrustContext(){
  const storage=await chrome.storage.local.get(["currentCompanyId","decisionTrustGatePolicy","decisionTrustGateContext"]);
  return {company_id:storage.currentCompanyId||null,company_policy:storage.decisionTrustGatePolicy||null,trust_context:storage.decisionTrustGateContext||null};
}
if(typeof chrome!=="undefined"&&chrome.runtime?.onMessage){
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=="TITAN_TRUST_AWARE_DECISION_GATE_EVALUATE") return undefined;
    (async()=>{try{
      const trusted=await getTrustedTrustContext(); if(!trusted.company_id) throw new Error("company_context_required");
      const ctx={...(isObject(trusted.trust_context)?trusted.trust_context:{}),company_policy:trusted.company_policy};
      const result=evaluateTrustAwareDecisionGate(message.recommended_action,trusted.company_id,ctx,message.now_ms??Date.now());
      sendResponse({success:true,data:result});
    }catch(error){sendResponse({success:false,error:error instanceof Error?error.message:String(error)});}})();
    return true;
  });
}
