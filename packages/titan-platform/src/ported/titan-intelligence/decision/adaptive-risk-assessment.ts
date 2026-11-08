// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/adaptive-risk-assessment.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { stableCorrelationHash } from "./correlation-layer.js";

export const ADAPTIVE_RISK_ASSESSMENT_VERSION = "1.0.0";
export const ADAPTIVE_RISK_FIELDS = Object.freeze([
  "risk_assessment_id", "company_id", "packet_id", "recommended_action_id", "action_type",
  "source_provider", "source_revision", "source_risk_level", "dimensions", "score", "level",
  "reason_codes", "policy_revision", "inputs_digest", "assessed_at", "projection_only",
  "authoritative_risk_gate", "authority_granted", "execution_permitted"
]);

const LEVEL_SCORE = Object.freeze({none:5, low:25, medium:50, high:75, critical:100, immediate:100, unknown:55});
const EVIDENCE_SCORE = Object.freeze({verified:10, partial:35, stale:60, contradictory:85, missing:90, expired:80, untrusted:95, unknown:70});
const REVERSIBILITY_SCORE = Object.freeze({reversible:15, partially_reversible:45, difficult:70, irreversible:100, unknown:60});
const BLAST_SCORE = Object.freeze({single_record:15, limited:35, workflow:50, company:75, multi_company:100, unknown:55});
const isObject=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const requiredText=(v,c)=>{ if(typeof v!=="string"||!v.trim()) throw new Error(c); return v.trim(); };
const token=v=>String(v??"").trim().toLowerCase().replace(/[\s-]+/g,"_").replace(/[^a-z0-9._:]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"");
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const uniq=v=>[...new Set(v)];

function levelFromScore(score){
  if(score>=85) return "critical";
  if(score>=65) return "high";
  if(score>=40) return "medium";
  if(score>=20) return "low";
  return "none";
}
function sourceRiskLevel(value){
  const raw=isObject(value)?value.level:value;
  const t=token(raw);
  return own(LEVEL_SCORE,t)?t:"unknown";
}
function normalizeImpact(value, fallback){
  const t=token(value||fallback||"unknown");
  if(!own(LEVEL_SCORE,t)) throw new Error("invalid_business_impact");
  return t === "immediate" ? "critical" : t;
}
function normalizeReversibility(value, actionType){
  const t=token(value||"");
  if(t){ if(!own(REVERSIBILITY_SCORE,t)) throw new Error("invalid_reversibility"); return t; }
  const a=token(actionType);
  if(/^(delete|remove|revoke|transfer|pay|refund|publish|close|cancel)(_|$)/.test(a)) return "difficult";
  if(/^(read|view|list|search|inspect|observe|explain|summarize|analyse|analyze|check|compare|preview)(_|$)/.test(a)) return "reversible";
  return "unknown";
}
function normalizeTime(value, fallback){
  const raw=value||(isObject(fallback)?fallback.level:fallback)||"unknown";
  const t=token(raw);
  if(!own(LEVEL_SCORE,t)) throw new Error("invalid_time_sensitivity");
  return t;
}
function normalizeBlast(value, action){
  const t=token(value||"");
  if(t){ if(!own(BLAST_SCORE,t)) throw new Error("invalid_blast_radius"); return t; }
  const p=isObject(action?.parameters)?action.parameters:{};
  const n=[p.affected_resources,p.record_ids,p.resource_ids,p.targets].find(Array.isArray)?.length||0;
  if(n>100) return "company";
  if(n>10) return "workflow";
  if(n>1) return "limited";
  if(n===1) return "single_record";
  return "unknown";
}
function normalizePolicy(policy, companyId){
  if(policy==null) return Object.freeze({company_id:companyId,policy_revision:"adaptive-risk-default-v1",weights:Object.freeze({evidence_quality:0.24,business_impact:0.26,reversibility:0.20,time_sensitivity:0.15,blast_radius:0.15})});
  if(!isObject(policy)) throw new Error("invalid_adaptive_risk_policy");
  if(requiredText(policy.company_id,"risk_policy_company_id_required")!==companyId) throw new Error("company_mismatch");
  const defaults={evidence_quality:0.24,business_impact:0.26,reversibility:0.20,time_sensitivity:0.15,blast_radius:0.15};
  const weights={...defaults};
  if(policy.weights!=null){
    if(!isObject(policy.weights)) throw new Error("invalid_risk_weights");
    for(const k of Object.keys(defaults)) if(policy.weights[k]!=null){ const n=Number(policy.weights[k]); if(!Number.isFinite(n)||n<0||n>1) throw new Error("invalid_risk_weight"); weights[k]=n; }
  }
  const total=Object.values(weights).reduce((a,b)=>a+b,0);
  if(total<=0) throw new Error("invalid_risk_weight_total");
  for(const k of Object.keys(weights)) weights[k]=weights[k]/total;
  return Object.freeze({company_id:companyId,policy_revision:requiredText(policy.policy_revision||"unversioned","risk_policy_revision_required"),weights:Object.freeze(weights)});
}

/**
 * Deterministic, read-only contextual risk projection. It does not replace Titan Risk's authoritative gate.
 */
export function assessAdaptiveRisk(recommendedAction, expectedCompanyId, context={}, now=Date.now()){
  if(!isObject(recommendedAction)) throw new Error("recommended_action_required");
  const companyId=requiredText(expectedCompanyId,"expected_company_id_required");
  if(requiredText(recommendedAction.company_id,"company_id_required")!==companyId) throw new Error("company_mismatch");
  if(recommendedAction.projection_only!==true||recommendedAction.proposal_only!==true) throw new Error("recommended_action_must_be_proposal_projection");
  if(recommendedAction.execution_permitted!==false||recommendedAction.authority_granted!==false) throw new Error("recommended_action_authority_boundary_invalid");
  const currentMs=Number(now); if(!Number.isFinite(currentMs)) throw new Error("invalid_now");
  const policy=normalizePolicy(context.company_policy,companyId);
  const sourceLevel=sourceRiskLevel(recommendedAction.risk);
  const evidenceState=token(context.evidence_state||recommendedAction.evidence_state||"unknown");
  if(!own(EVIDENCE_SCORE,evidenceState)) throw new Error("invalid_evidence_state");
  const impact=normalizeImpact(context.business_impact,sourceLevel);
  const reversibility=normalizeReversibility(context.reversibility,recommendedAction.action_type);
  const time=normalizeTime(context.time_sensitivity,recommendedAction.urgency);
  const blast=normalizeBlast(context.blast_radius,recommendedAction);
  const dimensions=Object.freeze({
    evidence_quality:Object.freeze({state:evidenceState,risk_score:EVIDENCE_SCORE[evidenceState]}),
    business_impact:Object.freeze({level:impact,risk_score:LEVEL_SCORE[impact]}),
    reversibility:Object.freeze({level:reversibility,risk_score:REVERSIBILITY_SCORE[reversibility]}),
    time_sensitivity:Object.freeze({level:time,risk_score:LEVEL_SCORE[time]}),
    blast_radius:Object.freeze({level:blast,risk_score:BLAST_SCORE[blast]})
  });
  const w=policy.weights;
  let score=Math.round(
    dimensions.evidence_quality.risk_score*w.evidence_quality+
    dimensions.business_impact.risk_score*w.business_impact+
    dimensions.reversibility.risk_score*w.reversibility+
    dimensions.time_sensitivity.risk_score*w.time_sensitivity+
    dimensions.blast_radius.risk_score*w.blast_radius
  );
  const reasons=[];
  // Source/domain risk is a lower bound, never a value that this projection may average away.
  if(sourceLevel==="critical"||sourceLevel==="immediate"){ score=Math.max(score,90); reasons.push("source_critical_risk_floor"); }
  else if(sourceLevel==="high"){ score=Math.max(score,70); reasons.push("source_high_risk_floor"); }
  if(impact==="critical"){ score=Math.max(score,85); reasons.push("critical_business_impact_floor"); }
  if(reversibility==="irreversible"&&BLAST_SCORE[blast]>=75){ score=Math.max(score,90); reasons.push("irreversible_wide_blast_floor"); }
  if(["missing","untrusted","contradictory"].includes(evidenceState)&&LEVEL_SCORE[impact]>=75){ score=Math.max(score,80); reasons.push("poor_evidence_high_impact_floor"); }
  if(time==="immediate"&&LEVEL_SCORE[impact]>=75){ score=Math.max(score,80); reasons.push("time_critical_high_impact_floor"); }
  if(BLAST_SCORE[blast]>=75&&LEVEL_SCORE[impact]>=75){ score=Math.max(score,80); reasons.push("wide_blast_high_impact_floor"); }
  score=Math.max(0,Math.min(100,score));
  const level=levelFromScore(score);
  const material={company_id:companyId,packet_id:recommendedAction.packet_id,recommended_action_id:recommendedAction.recommended_action_id,source_provider:recommendedAction.source_provider,source_revision:recommendedAction.source_revision,source_risk_level:sourceLevel,dimensions,weights:w,policy_revision:policy.policy_revision};
  const digest=stableCorrelationHash(material);
  return Object.freeze({
    risk_assessment_id:`darisk_${digest}`,
    company_id:companyId,
    packet_id:requiredText(recommendedAction.packet_id,"packet_id_required"),
    recommended_action_id:requiredText(recommendedAction.recommended_action_id,"recommended_action_id_required"),
    action_type:requiredText(recommendedAction.action_type,"action_type_required"),
    source_provider:requiredText(recommendedAction.source_provider,"source_provider_required"),
    source_revision:clone(recommendedAction.source_revision),
    source_risk_level:sourceLevel,
    dimensions,
    score,
    level,
    reason_codes:Object.freeze(uniq(reasons)),
    policy_revision:policy.policy_revision,
    inputs_digest:digest,
    assessed_at:new Date(currentMs).toISOString(),
    projection_only:true,
    authoritative_risk_gate:false,
    authority_granted:false,
    execution_permitted:false
  });
}

export function validateAdaptiveRiskAssessment(value, expectedCompanyId){
  try{
    if(!isObject(value)) return {valid:false,error:"invalid_adaptive_risk_assessment"};
    const missing=ADAPTIVE_RISK_FIELDS.filter(k=>!own(value,k)); if(missing.length) return {valid:false,error:"missing_fields",missing};
    const extra=Object.keys(value).filter(k=>!ADAPTIVE_RISK_FIELDS.includes(k)); if(extra.length) return {valid:false,error:"unexpected_fields",extra};
    if(requiredText(value.company_id,"company_id_required")!==requiredText(expectedCompanyId,"expected_company_id_required")) return {valid:false,error:"company_mismatch"};
    if(!Number.isInteger(value.score)||value.score<0||value.score>100) return {valid:false,error:"invalid_risk_score"};
    if(!["none","low","medium","high","critical"].includes(value.level)) return {valid:false,error:"invalid_risk_level"};
    if(!Array.isArray(value.reason_codes)||!isObject(value.dimensions)) return {valid:false,error:"invalid_risk_components"};
    if(value.projection_only!==true||value.authoritative_risk_gate!==false||value.authority_granted!==false||value.execution_permitted!==false) return {valid:false,error:"adaptive_risk_boundary_invalid"};
    requiredText(value.risk_assessment_id,"risk_assessment_id_required"); requiredText(value.packet_id,"packet_id_required"); requiredText(value.recommended_action_id,"recommended_action_id_required"); requiredText(value.inputs_digest,"inputs_digest_required");
    if(!Number.isFinite(Date.parse(value.assessed_at))) return {valid:false,error:"invalid_assessed_at"};
    return {valid:true};
  }catch(error){ return {valid:false,error:error instanceof Error?error.message:String(error)}; }
}

async function getTrustedRiskContext(){
  const storage=await chrome.storage.local.get(["currentCompanyId","decisionAdaptiveRiskPolicy","decisionAdaptiveRiskContext"]);
  return {company_id:storage.currentCompanyId||null,company_policy:storage.decisionAdaptiveRiskPolicy||null,risk_context:storage.decisionAdaptiveRiskContext||null};
}

if(typeof chrome!=="undefined"&&chrome.runtime?.onMessage){
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=="TITAN_ADAPTIVE_RISK_ASSESS") return undefined;
    (async()=>{ try{
      const trusted=await getTrustedRiskContext(); if(!trusted.company_id) throw new Error("company_context_required");
      const ctx={...(isObject(trusted.risk_context)?trusted.risk_context:{}),company_policy:trusted.company_policy};
      // Caller hints may tighten only: they cannot replace trusted policy or lower trusted context.
      if(message.force_business_impact){ const t=token(message.force_business_impact); if(own(LEVEL_SCORE,t)) ctx.business_impact=t; }
      const result=assessAdaptiveRisk(message.recommended_action,trusted.company_id,ctx,message.now_ms??Date.now());
      sendResponse({success:true,data:result});
    }catch(error){ sendResponse({success:false,error:error instanceof Error?error.message:String(error)}); } })();
    return true;
  });
}
