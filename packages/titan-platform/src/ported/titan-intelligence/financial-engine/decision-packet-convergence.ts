// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/financial-engine/decision-packet-convergence.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { createDecisionPacket } from "../decision/decision-packet.js";
import { validateMoneyAction, FINANCIAL_ENGINE_VERSION } from "./money-action-queue.js";

export const MONEY_DECISION_CONVERGENCE_VERSION = "1.0.0";
export const MONEY_DECISION_CONVERGENCE = Object.freeze({
  adapter_id: "titan.money.decision-packet.convergence.v1",
  domain: "money",
  source_provider: "financial_engine",
  authority_owner: "financial_engine",
  lifecycle_owner: "financial_engine",
  projection_only: true,
  action_lifecycle_mutable: false,
  execution_permitted: false,
  authority_granted: false
});

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const text = (value, fallback = null) => typeof value === "string" && value.trim() ? value.trim() : fallback;
const arr = value => Array.isArray(value) ? clone(value) : [];
const normalizeUrgency = value => {
  const v=String(value ?? "unknown").trim().toLowerCase().replace(/[\s-]+/g,"_");
  if (["immediate","high","medium","low","none","unknown"].includes(v)) return v;
  if (["urgent","critical"].includes(v)) return "immediate";
  return "unknown";
};

function normalizeObservation(input, expectedCompanyId) {
  if (!isObject(input)) throw new Error("invalid_financial_observation");
  if (text(input.company_id) !== text(expectedCompanyId)) throw new Error("company_mismatch");
  const revision = input.source_revision ?? input.revision;
  if (revision == null || (typeof revision === "string" && !revision.trim())) throw new Error("source_revision_required");
  return Object.freeze({
    observation_id:text(input.observation_id ?? input.financial_observation_id, null),
    company_id:input.company_id,
    metric:text(input.metric, "financial_observation"),
    observation:clone(input.observation ?? "unknown"),
    priority:clone(input.priority ?? null),
    urgency:normalizeUrgency(input.urgency),
    evidence:arr(input.evidence),
    evidence_state:text(input.evidence_state, null),
    recommended_response:clone(input.recommended_response ?? input.recommendation ?? null),
    expected_effect:clone(input.expected_effect ?? "unknown"),
    risk:clone(input.risk ?? "unknown"),
    source_revision:clone(revision),
    observed_at:text(input.observed_at ?? input.generated_at, null),
    expires_at:text(input.expires_at, null),
    source_event_id:text(input.source_event_id, null),
    ledger_snapshot_id:text(input.ledger_snapshot_id, null)
  });
}

function normalizeMoneyAction(input, expectedCompanyId) {
  if (input == null) return null;
  if (!isObject(input)) throw new Error("invalid_money_action");
  // Compatibility normalization for pre-0.9 callers: queue ownership remains strict in money-action-queue.js.
  const candidate={owner:null,due_at:null,...clone(input)};
  const checked=validateMoneyAction(candidate, expectedCompanyId);
  if (!checked.valid) throw new Error(`invalid_money_action:${checked.error}`);
  return Object.freeze(candidate);
}

function observationFromAction(action) {
  return Object.freeze({
    observation_id:null, company_id:action.company_id, metric:action.metric,
    observation:clone(action.observation), priority:clone(action.priority), urgency:normalizeUrgency(action.urgency),
    evidence:arr(action.evidence), evidence_state:null, recommended_response:clone(action.recommended_response),
    expected_effect:clone(action.expected_effect), risk:"unknown", source_revision:clone(action.source_revision),
    observed_at:text(action.created_at,null), expires_at:text(action.expires_at,null), source_event_id:null, ledger_snapshot_id:null
  });
}

function provenance(observation, action, packetMeta) {
  const upstream = packetMeta.source_revision ?? observation?.source_revision ?? action?.source_revision;
  if (upstream == null) throw new Error("source_revision_required");
  return Object.freeze({
    financial_engine_version:FINANCIAL_ENGINE_VERSION,
    convergence_version:MONEY_DECISION_CONVERGENCE_VERSION,
    observation_id:observation?.observation_id ?? null,
    money_action_id:action?.action_id ?? null,
    money_action_status:action?.status ?? null,
    money_action_source_revision:clone(action?.source_revision ?? null),
    ledger_snapshot_id:observation?.ledger_snapshot_id ?? null,
    source_event_id:observation?.source_event_id ?? null,
    upstream_revision:clone(upstream)
  });
}

function evidenceWithProvenance(observation, action) {
  const items = observation?.evidence?.length ? observation.evidence : (action?.evidence || []);
  return items.map((item,index)=>Object.freeze({
    evidence_ref:clone(item), ordinal:index,
    observation_id:observation?.observation_id ?? null,
    money_action_id:action?.action_id ?? null,
    source_provider:MONEY_DECISION_CONVERGENCE.source_provider
  }));
}

function projectedRecommendation(observation, action) {
  const recommendation = action?.recommended_response ?? observation?.recommended_response;
  if (recommendation == null) return [];
  return [Object.freeze({
    action_type:"financial_engine_recommendation",
    recommendation:clone(recommendation),
    money_action_id:action?.action_id ?? null,
    money_action_status:action?.status ?? null,
    lifecycle_owner:"financial_engine",
    lifecycle_projection_only:true,
    proposal_only:true,
    execution_permitted:false,
    authority_granted:false
  })];
}

/**
 * Converge Financial Engine observations and persistent MoneyActions into canonical money packets.
 * Financial Engine remains sole owner of MoneyAction lifecycle and all financial mutation semantics.
 */
export function convergeMoneyDecisionPacket(input, expectedCompanyId, packetMeta = {}) {
  if (!isObject(input)) throw new Error("invalid_money_convergence_request");
  const actionInput = isObject(input.money_action) ? input.money_action : (isObject(input.action) ? input.action : (input.action_id ? input : null));
  const action = normalizeMoneyAction(actionInput, expectedCompanyId);
  const observationInput = isObject(input.financial_observation) ? input.financial_observation : (isObject(input.observation_record) ? input.observation_record : (!actionInput ? input : null));
  const observation = observationInput ? normalizeObservation(observationInput, expectedCompanyId) : observationFromAction(action);
  if (!action && !observation) throw new Error("financial_observation_or_money_action_required");
  if (action && observation.company_id !== action.company_id) throw new Error("company_mismatch");
  if (action && observation.source_revision != null && action.source_revision != null && packetMeta.allow_revision_divergence !== true) {
    const a=JSON.stringify(action.source_revision), o=JSON.stringify(observation.source_revision);
    if (a!==o) throw new Error("financial_revision_mismatch");
  }
  const sourceRevision=provenance(observation, action, packetMeta);
  const evidence=evidenceWithProvenance(observation, action);
  const recommendations=projectedRecommendation(observation, action);
  const generatedAt=packetMeta.generated_at || observation.observed_at || action?.created_at;
  const expiresAt=packetMeta.expires_at || observation.expires_at || action?.expires_at;
  if (!generatedAt) throw new Error("generated_at_required");
  if (!expiresAt) throw new Error("expires_at_required");
  return createDecisionPacket({
    packet_id:packetMeta.packet_id,
    company_id:expectedCompanyId,
    domain:"money",
    subject:packetMeta.subject || `money:${action?.action_id || observation.observation_id || observation.metric}`,
    observation:Object.freeze({
      observation_id:observation.observation_id,
      metric:observation.metric,
      observation:clone(observation.observation),
      observed_at:observation.observed_at,
      money_action_id:action?.action_id ?? null,
      money_action_status:action?.status ?? null
    }),
    significance:Object.freeze({
      priority:clone(action?.priority ?? observation.priority),
      urgency:action?.urgency ?? observation.urgency,
      money_action_id:action?.action_id ?? null,
      money_action_status:action?.status ?? null,
      money_action_owner:clone(action?.owner ?? null),
      due_at:action?.due_at ?? null,
      lifecycle_owner:"financial_engine",
      lifecycle_projection_only:true,
      financial_provenance:clone(sourceRevision)
    }),
    evidence,
    evidence_state:packetMeta.evidence_state || observation.evidence_state || (evidence.length ? "unknown" : "missing"),
    explanation:Object.freeze({
      source:"financial_engine",
      persistent_money_action:!!action,
      lifecycle_owner:"financial_engine",
      lifecycle_status:action?.status ?? null,
      lifecycle_mutation_permitted:false
    }),
    recommended_actions:recommendations,
    expected_effect:clone(action?.expected_effect ?? observation.expected_effect),
    risk:clone(packetMeta.risk ?? observation.risk ?? "unknown"),
    urgency:clone(packetMeta.urgency ?? normalizeUrgency(action?.urgency ?? observation.urgency)),
    authority_required:packetMeta.authority_required === true,
    source_provider:"financial_engine",
    source_revision:sourceRevision,
    generated_at:generatedAt,
    expires_at:expiresAt
  }, expectedCompanyId, packetMeta.now_ms);
}

async function getCurrentCompanyId(){const s=await chrome.storage.local.get(["currentCompanyId"]);return s.currentCompanyId||null;}
if (typeof chrome!=="undefined" && chrome.runtime?.onMessage) chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type!=="TITAN_MONEY_DECISION_PACKET_CONVERGE") return undefined;
  (async()=>{try{const companyId=await getCurrentCompanyId();if(!companyId)throw new Error("company_context_required");const packet=convergeMoneyDecisionPacket(message.payload,companyId,message.packet_meta||{});sendResponse({success:true,data:packet,packet,convergence:MONEY_DECISION_CONVERGENCE});}catch(error){sendResponse({success:false,error:error instanceof Error?error.message:String(error)});}})();return true;
});
