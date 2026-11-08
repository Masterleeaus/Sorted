// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/recommended-action.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import {
  DECISION_PACKET_DOMAINS,
  DECISION_PACKET_FIELDS,
  DECISION_EVIDENCE_STATES,
  decisionPacketExpiryState
} from "./decision-packet.js";
import { stableCorrelationHash, canonicalCorrelationJson } from "./correlation-layer.js";
import { determineAuthorityRequirement, validateAuthorityRequirement } from "./authority-requirement-engine.js";
import { assessAdaptiveRisk, validateAdaptiveRiskAssessment } from "./adaptive-risk-assessment.js";
import { determineAdaptiveTimePolicy, validateAdaptiveTimePolicy } from "./adaptive-time-policy.js";
import { evaluateTrustAwareDecisionGate, validateTrustAwareDecisionGate } from "./trust-aware-decision-gate.js";

export const RECOMMENDED_ACTION_VERSION = "1.4.0";
export const RECOMMENDED_ACTION_FIELDS = Object.freeze([
  "recommended_action_id", "company_id", "packet_id", "domain", "ordinal", "action_type",
  "summary", "parameters", "rationale", "evidence_state", "evidence_refs", "expected_effect",
  "risk", "urgency", "authority_required", "source_provider", "source_revision", "correlation_id",
  "generated_at", "expires_at", "projection_only", "proposal_only", "execution_permitted",
  "authority_granted", "adaptive_risk", "trust_gate", "recommendation_permitted", "gate_state", "authority_requirement", "time_policy"
]);

const RESERVED_AUTHORITY_KEYS = new Set([
  "approved", "approval", "approval_id", "approval_token", "authority", "authority_granted",
  "authorized", "authorised", "authorization", "authorisation", "capability_grant", "delegation",
  "delegation_token", "execute", "execute_now", "execution", "execution_permitted", "permission",
  "permission_granted", "command", "command_token", "command_bus_receipt", "mutation_authorized",
  "mutation_authorised", "bypass", "override_authority", "autonomy_grant"
]);

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};
const optionalText = value => typeof value === "string" && value.trim() ? value.trim() : null;
const normalizeToken = value => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9._:]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

function assertPacket(packet, expectedCompanyId) {
  if (!isObject(packet)) throw new Error("invalid_decision_packet_request");
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  if (requiredText(packet.company_id, "company_id_required") !== companyId) throw new Error("company_mismatch");
  const keys = Object.keys(packet);
  const missing = DECISION_PACKET_FIELDS.filter(key => !own(packet, key));
  if (missing.length) throw new Error("missing_decision_packet_fields");
  const extra = keys.filter(key => !DECISION_PACKET_FIELDS.includes(key));
  if (extra.length) throw new Error("unexpected_decision_packet_fields");
  requiredText(packet.packet_id, "packet_id_required");
  if (!DECISION_PACKET_DOMAINS.includes(packet.domain)) throw new Error("invalid_decision_domain");
  if (!DECISION_EVIDENCE_STATES.includes(packet.evidence_state)) throw new Error("invalid_evidence_state");
  if (!Array.isArray(packet.evidence)) throw new Error("invalid_evidence_array");
  if (!Array.isArray(packet.recommended_actions)) throw new Error("invalid_recommended_actions_array");
  if (typeof packet.authority_required !== "boolean") throw new Error("authority_required_boolean_required");
  requiredText(packet.source_provider, "source_provider_required");
  if (packet.source_revision == null) throw new Error("source_revision_required");
  if (!Number.isFinite(Date.parse(packet.generated_at))) throw new Error("invalid_generated_at");
  if (!Number.isFinite(Date.parse(packet.expires_at))) throw new Error("invalid_expires_at");
  return companyId;
}

function stripAuthorityAliases(value, depth = 0) {
  if (depth > 12) throw new Error("recommended_action_too_deep");
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("recommended_action_non_finite_number");
    return value;
  }
  if (Array.isArray(value)) return value.map(item => stripAuthorityAliases(item, depth + 1));
  if (!isObject(value)) return String(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const normalizedKey = normalizeToken(key);
    if (RESERVED_AUTHORITY_KEYS.has(normalizedKey)) continue;
    output[key] = stripAuthorityAliases(value[key], depth + 1);
  }
  return output;
}

function deriveActionType(action) {
  if (typeof action === "string") return "recommendation";
  if (!isObject(action)) return "recommendation";
  for (const key of ["type", "action_type", "kind", "operation", "name"]) {
    const token = normalizeToken(action[key]);
    if (token) return token.slice(0, 96);
  }
  return "recommendation";
}

function deriveSummary(action) {
  if (typeof action === "string") return requiredText(action, "recommended_action_summary_required");
  if (!isObject(action)) return String(action);
  for (const key of ["summary", "title", "label", "description", "message", "type", "action_type", "name"]) {
    const value = optionalText(action[key]);
    if (value) return value;
  }
  return canonicalCorrelationJson(stripAuthorityAliases(action)).slice(0, 1000) || "Recommended action";
}

function deriveParameters(action) {
  if (typeof action === "string") return Object.freeze({});
  if (!isObject(action)) return Object.freeze({value: stripAuthorityAliases(action)});
  const sanitized = stripAuthorityAliases(action);
  for (const key of ["type", "action_type", "kind", "operation", "name", "summary", "title", "label", "description", "message", "rationale", "reason"]) {
    delete sanitized[key];
  }
  return Object.freeze(sanitized);
}

function deriveRationale(action, packet) {
  if (isObject(action)) {
    const candidate = optionalText(action.rationale) || optionalText(action.reason);
    if (candidate) return candidate;
  }
  if (typeof packet.explanation === "string" && packet.explanation.trim()) return packet.explanation.trim();
  return "Recommendation projected from the source DecisionPacket; no independent authority is inferred.";
}

function normalizeCorrelation(correlation, packet, expectedCompanyId) {
  if (correlation == null) return null;
  if (!isObject(correlation)) throw new Error("invalid_decision_correlation");
  if (requiredText(correlation.company_id, "correlation_company_id_required") !== expectedCompanyId) throw new Error("company_mismatch");
  if (requiredText(correlation.packet_id, "correlation_packet_id_required") !== packet.packet_id) throw new Error("correlation_packet_mismatch");
  if (requiredText(correlation.domain, "correlation_domain_required") !== packet.domain) throw new Error("correlation_domain_mismatch");
  if (correlation.projection_only !== true) throw new Error("correlation_must_be_projection_only");
  return correlation;
}

/**
 * Build one governed RecommendedAction projection from a source DecisionPacket recommendation.
 * This contract is intentionally incapable of authorizing or executing the recommendation.
 */
export function projectRecommendedAction(packet, action, ordinal, expectedCompanyId, context = {}, now = Date.now()) {
  const companyId = assertPacket(packet, expectedCompanyId);
  if (!Number.isInteger(ordinal) || ordinal < 0) throw new Error("invalid_recommended_action_ordinal");
  const correlation = normalizeCorrelation(context?.correlation, packet, companyId);
  const currentMs = Number(now);
  if (!Number.isFinite(currentMs)) throw new Error("invalid_now");
  const expiry = decisionPacketExpiryState(packet, currentMs);

  const actionType = deriveActionType(action);
  const summary = deriveSummary(action);
  const parameters = deriveParameters(action);
  const material = {
    company_id: companyId,
    packet_id: packet.packet_id,
    domain: packet.domain,
    ordinal,
    action_type: actionType,
    summary,
    parameters,
    source_provider: packet.source_provider,
    source_revision: packet.source_revision
  };
  const recommendedActionId = `dra_${stableCorrelationHash(material)}`;

  const baseProjection = Object.freeze({
    recommended_action_id: recommendedActionId,
    company_id: companyId,
    packet_id: packet.packet_id,
    domain: packet.domain,
    ordinal,
    action_type: actionType,
    summary,
    parameters,
    rationale: deriveRationale(action, packet),
    evidence_state: packet.evidence_state,
    evidence_refs: Object.freeze(clone(packet.evidence)),
    expected_effect: clone(packet.expected_effect),
    risk: clone(packet.risk),
    urgency: clone(packet.urgency),
    authority_required: packet.authority_required,
    source_provider: packet.source_provider,
    source_revision: clone(packet.source_revision),
    correlation_id: correlation?.correlation_id || null,
    generated_at: packet.generated_at,
    expires_at: expiry.expires_at,
    projection_only: true,
    proposal_only: true,
    execution_permitted: false,
    authority_granted: false
  });
  const adaptiveRisk = assessAdaptiveRisk(baseProjection, companyId, context.risk_context || {}, currentMs);
  const riskAwareProjection = Object.freeze({
    ...baseProjection,
    risk: Object.freeze({level: adaptiveRisk.level, score: adaptiveRisk.score, source_level: adaptiveRisk.source_risk_level}),
    adaptive_risk: adaptiveRisk
  });
  const trustGate = evaluateTrustAwareDecisionGate(riskAwareProjection, companyId, context.trust_context || {}, currentMs);
  const trustAwareProjection = Object.freeze({
    ...riskAwareProjection,
    trust_gate: trustGate,
    recommendation_permitted: trustGate.recommendation_permitted,
    gate_state: trustGate.gate_state
  });
  const authorityRequirement = determineAuthorityRequirement(trustAwareProjection, companyId, context.authority_context || {}, currentMs);
  const authorityAwareProjection = Object.freeze({
    ...trustAwareProjection,
    authority_required: authorityRequirement.authority_required,
    authority_requirement: authorityRequirement
  });
  const timePolicy = determineAdaptiveTimePolicy(authorityAwareProjection, companyId, context.time_context || {}, currentMs);
  return Object.freeze({
    ...authorityAwareProjection,
    time_policy: timePolicy
  });
}

export function projectRecommendedActions(packet, expectedCompanyId, context = {}, now = Date.now()) {
  assertPacket(packet, expectedCompanyId);
  return Object.freeze(packet.recommended_actions.map((action, ordinal) =>
    projectRecommendedAction(packet, action, ordinal, expectedCompanyId, context, now)
  ));
}

export function validateRecommendedAction(action, expectedCompanyId) {
  try {
    if (!isObject(action)) return {valid:false,error:"invalid_recommended_action"};
    const keys = Object.keys(action);
    const missing = RECOMMENDED_ACTION_FIELDS.filter(key => !own(action, key));
    if (missing.length) return {valid:false,error:"missing_fields",missing};
    const extra = keys.filter(key => !RECOMMENDED_ACTION_FIELDS.includes(key));
    if (extra.length) return {valid:false,error:"unexpected_fields",extra};
    if (requiredText(action.company_id, "company_id_required") !== requiredText(expectedCompanyId, "expected_company_id_required")) return {valid:false,error:"company_mismatch"};
    if (!DECISION_PACKET_DOMAINS.includes(action.domain)) return {valid:false,error:"invalid_decision_domain"};
    if (!DECISION_EVIDENCE_STATES.includes(action.evidence_state)) return {valid:false,error:"invalid_evidence_state"};
    if (!Number.isInteger(action.ordinal) || action.ordinal < 0) return {valid:false,error:"invalid_recommended_action_ordinal"};
    if (action.projection_only !== true || action.proposal_only !== true) return {valid:false,error:"recommended_action_must_be_proposal_projection"};
    if (action.execution_permitted !== false) return {valid:false,error:"recommended_action_cannot_grant_execution"};
    if (action.authority_granted !== false) return {valid:false,error:"recommended_action_cannot_grant_authority"};
    if (typeof action.authority_required !== "boolean") return {valid:false,error:"authority_required_boolean_required"};
    const adaptiveRiskValidation = validateAdaptiveRiskAssessment(action.adaptive_risk, expectedCompanyId);
    if (!adaptiveRiskValidation.valid) return {valid:false,error:"invalid_adaptive_risk",detail:adaptiveRiskValidation};
    if (action.adaptive_risk.recommended_action_id !== action.recommended_action_id) return {valid:false,error:"adaptive_risk_action_mismatch"};
    if (!isObject(action.risk) || action.risk.level !== action.adaptive_risk.level || action.risk.score !== action.adaptive_risk.score) return {valid:false,error:"adaptive_risk_projection_mismatch"};
    const trustValidation = validateTrustAwareDecisionGate(action.trust_gate, expectedCompanyId);
    if (!trustValidation.valid) return {valid:false,error:"invalid_trust_gate",detail:trustValidation};
    if (action.trust_gate.recommended_action_id !== action.recommended_action_id) return {valid:false,error:"trust_gate_action_mismatch"};
    if (action.trust_gate.packet_id !== action.packet_id) return {valid:false,error:"trust_gate_packet_mismatch"};
    if (action.trust_gate.recommendation_permitted !== action.recommendation_permitted || action.trust_gate.gate_state !== action.gate_state) return {valid:false,error:"trust_gate_projection_mismatch"};
    const authorityValidation = validateAuthorityRequirement(action.authority_requirement, expectedCompanyId);
    if (!authorityValidation.valid) return {valid:false,error:"invalid_authority_requirement",detail:authorityValidation};
    if (action.authority_requirement.recommended_action_id !== action.recommended_action_id) return {valid:false,error:"authority_requirement_action_mismatch"};
    if (action.authority_requirement.packet_id !== action.packet_id) return {valid:false,error:"authority_requirement_packet_mismatch"};
    if (action.authority_requirement.authority_required !== action.authority_required) return {valid:false,error:"authority_requirement_mismatch"};
    const timeValidation = validateAdaptiveTimePolicy(action.time_policy, expectedCompanyId);
    if (!timeValidation.valid) return {valid:false,error:"invalid_time_policy",detail:timeValidation};
    if (action.time_policy.recommended_action_id !== action.recommended_action_id) return {valid:false,error:"time_policy_action_mismatch"};
    if (action.time_policy.packet_id !== action.packet_id) return {valid:false,error:"time_policy_packet_mismatch"};
    if (action.time_policy.authority_required !== action.authority_required) return {valid:false,error:"time_policy_authority_mismatch"};
    requiredText(action.recommended_action_id, "recommended_action_id_required");
    requiredText(action.packet_id, "packet_id_required");
    requiredText(action.action_type, "recommended_action_type_required");
    requiredText(action.summary, "recommended_action_summary_required");
    requiredText(action.source_provider, "source_provider_required");
    if (action.source_revision == null) return {valid:false,error:"source_revision_required"};
    if (!Array.isArray(action.evidence_refs)) return {valid:false,error:"invalid_evidence_refs"};
    if (!isObject(action.parameters)) return {valid:false,error:"invalid_recommended_action_parameters"};
    if (!Number.isFinite(Date.parse(action.generated_at))) return {valid:false,error:"invalid_generated_at"};
    if (!Number.isFinite(Date.parse(action.expires_at))) return {valid:false,error:"invalid_expires_at"};
    return {valid:true};
  } catch (error) {
    return {valid:false,error:error instanceof Error ? error.message : String(error)};
  }
}

async function getTrustedProjectionContext() {
  const storage = await chrome.storage.local.get(["currentCompanyId", "decisionAuthorityPolicy", "decisionActorContext", "decisionAdaptiveRiskPolicy", "decisionAdaptiveRiskContext", "decisionAdaptiveTimePolicy", "decisionAdaptiveTimeContext", "decisionTrustGatePolicy", "decisionTrustGateContext"]);
  return {
    company_id: storage.currentCompanyId || null,
    company_policy: storage.decisionAuthorityPolicy || null,
    actor_context: storage.decisionActorContext || null,
    adaptive_risk_policy: storage.decisionAdaptiveRiskPolicy || null,
    adaptive_risk_context: storage.decisionAdaptiveRiskContext || null,
    adaptive_time_policy: storage.decisionAdaptiveTimePolicy || null,
    adaptive_time_context: storage.decisionAdaptiveTimeContext || null,
    trust_gate_policy: storage.decisionTrustGatePolicy || null,
    trust_gate_context: storage.decisionTrustGateContext || null
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_RECOMMENDED_ACTION_PROJECT") return undefined;
    (async () => {
      try {
        const trusted = await getTrustedProjectionContext();
        const expectedCompanyId = trusted.company_id;
        if (!expectedCompanyId) throw new Error("company_context_required");
        const actions = projectRecommendedActions(message.packet, expectedCompanyId, {
          correlation:message.correlation || null,
          risk_context:{...(isObject(trusted.adaptive_risk_context)?trusted.adaptive_risk_context:{}), company_policy:trusted.adaptive_risk_policy},
          trust_context:{...(isObject(trusted.trust_gate_context)?trusted.trust_gate_context:{}), company_policy:trusted.trust_gate_policy},
          authority_context:{company_policy:trusted.company_policy, actor_context:trusted.actor_context},
          time_context:{...(isObject(trusted.adaptive_time_context)?trusted.adaptive_time_context:{}), company_policy:trusted.adaptive_time_policy}
        }, message.now_ms ?? Date.now());
        sendResponse({success:true,data:actions});
      } catch (error) {
        sendResponse({success:false,error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
