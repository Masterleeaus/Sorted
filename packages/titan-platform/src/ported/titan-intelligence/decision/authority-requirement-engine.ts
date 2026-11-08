// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/authority-requirement-engine.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { stableCorrelationHash, canonicalCorrelationJson } from "./correlation-layer.js";

export const AUTHORITY_REQUIREMENT_ENGINE_VERSION = "1.0.0";
export const AUTHORITY_REQUIREMENT_FIELDS = Object.freeze([
  "authority_requirement_id", "company_id", "packet_id", "recommended_action_id", "action_type",
  "source_provider", "source_revision", "risk_level", "authority_required", "requirement_level",
  "reason_codes", "policy_revision", "actor_kind", "inputs_digest", "evaluated_at",
  "projection_only", "authority_granted", "execution_permitted"
]);

const RISK_RANK = Object.freeze({unknown:0, none:1, low:2, medium:3, high:4, critical:5, immediate:5});
const REQUIREMENT_LEVELS = Object.freeze(["none", "review", "approval", "human_only"]);
const READ_PREFIXES = Object.freeze(["read", "view", "list", "search", "inspect", "observe", "explain", "summarize", "analyse", "analyze", "check", "compare", "preview"]);
const PREPARE_PREFIXES = Object.freeze(["recommend", "propose", "prepare", "draft", "request", "collect", "gather", "escalate", "notify"]);
const CONSEQUENT_PREFIXES = Object.freeze(["execute", "apply", "remediate", "recover", "restore", "pay", "refund", "send", "delete", "remove", "create", "update", "change", "modify", "revoke", "approve", "grant", "authorize", "authorise", "publish", "dispatch", "book", "invoice", "transfer", "close", "cancel"]);
const ALWAYS_GOVERNED_PROVIDERS = new Set(["titan_shield", "titan_rewind"]);

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};
const normalizeToken = value => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9._:]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
const uniq = values => [...new Set(values)];

function riskLevel(value) {
  const raw = isObject(value) ? value.level : value;
  const token = normalizeToken(raw);
  return own(RISK_RANK, token) ? token : "unknown";
}

function actionClass(actionType) {
  const token = normalizeToken(actionType);
  if (READ_PREFIXES.some(prefix => token === prefix || token.startsWith(`${prefix}_`))) return "informational";
  if (CONSEQUENT_PREFIXES.some(prefix => token === prefix || token.startsWith(`${prefix}_`))) return "consequential";
  if (PREPARE_PREFIXES.some(prefix => token === prefix || token.startsWith(`${prefix}_`))) return "proposal";
  return "unknown";
}

function normalizePolicy(policy, expectedCompanyId) {
  if (policy == null) return Object.freeze({
    company_id: expectedCompanyId,
    policy_revision: "default-v1",
    require_authority_risk_at_or_above: "high",
    authority_required_action_types: Object.freeze([]),
    human_only_action_types: Object.freeze([]),
    require_authority_for_ai: true,
    require_authority_for_unknown_actor: true,
    require_authority_for_consequential: true,
    provider_requirements: Object.freeze({})
  });
  if (!isObject(policy)) throw new Error("invalid_company_authority_policy");
  if (requiredText(policy.company_id, "policy_company_id_required") !== expectedCompanyId) throw new Error("company_mismatch");
  const threshold = normalizeToken(policy.require_authority_risk_at_or_above || "high");
  if (!own(RISK_RANK, threshold)) throw new Error("invalid_policy_risk_threshold");
  const stringArray = (value, code) => {
    if (value == null) return Object.freeze([]);
    if (!Array.isArray(value)) throw new Error(code);
    return Object.freeze(value.map(normalizeToken).filter(Boolean));
  };
  const providerRequirements = {};
  if (policy.provider_requirements != null) {
    if (!isObject(policy.provider_requirements)) throw new Error("invalid_provider_requirements");
    for (const [key, value] of Object.entries(policy.provider_requirements)) {
      if (typeof value !== "boolean") throw new Error("invalid_provider_requirement");
      providerRequirements[normalizeToken(key)] = value;
    }
  }
  return Object.freeze({
    company_id: expectedCompanyId,
    policy_revision: requiredText(policy.policy_revision || "unversioned", "policy_revision_required"),
    require_authority_risk_at_or_above: threshold,
    authority_required_action_types: stringArray(policy.authority_required_action_types, "invalid_authority_required_action_types"),
    human_only_action_types: stringArray(policy.human_only_action_types, "invalid_human_only_action_types"),
    require_authority_for_ai: policy.require_authority_for_ai !== false,
    require_authority_for_unknown_actor: policy.require_authority_for_unknown_actor !== false,
    require_authority_for_consequential: policy.require_authority_for_consequential !== false,
    provider_requirements: Object.freeze(providerRequirements)
  });
}

function normalizeActor(actor, expectedCompanyId) {
  if (actor == null) return Object.freeze({actor_kind:"unknown", actor_id:null, fresh_auth:false, separation_of_duties_clear:false});
  if (!isObject(actor)) throw new Error("invalid_actor_context");
  if (requiredText(actor.company_id, "actor_company_id_required") !== expectedCompanyId) throw new Error("company_mismatch");
  const kind = normalizeToken(actor.actor_kind || actor.actor_type || "unknown");
  if (!["human", "ai", "system", "service", "unknown"].includes(kind)) throw new Error("invalid_actor_kind");
  return Object.freeze({
    actor_kind: kind,
    actor_id: typeof actor.actor_id === "string" && actor.actor_id.trim() ? actor.actor_id.trim() : null,
    fresh_auth: actor.fresh_auth === true,
    separation_of_duties_clear: actor.separation_of_duties_clear === true
  });
}

function requirementLevel(reasons, policy, actionType) {
  if (policy.human_only_action_types.includes(actionType) || reasons.includes("trust_gate_requires_evidence_resolution")) return "human_only";
  if (reasons.some(code => code === "source_requires_authority" || code === "critical_or_immediate_risk" || code === "company_human_only_action")) return "approval";
  if (reasons.length) return "review";
  return "none";
}

/**
 * Read-only determination of whether a RecommendedAction requires authority.
 * This engine never grants authority and can only preserve or tighten an existing source requirement.
 */
export function determineAuthorityRequirement(recommendedAction, expectedCompanyId, context = {}, now = Date.now()) {
  if (!isObject(recommendedAction)) throw new Error("recommended_action_required");
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  if (requiredText(recommendedAction.company_id, "company_id_required") !== companyId) throw new Error("company_mismatch");
  if (recommendedAction.projection_only !== true || recommendedAction.proposal_only !== true) throw new Error("recommended_action_must_be_proposal_projection");
  if (recommendedAction.execution_permitted !== false || recommendedAction.authority_granted !== false) throw new Error("recommended_action_authority_boundary_invalid");
  const currentMs = Number(now);
  if (!Number.isFinite(currentMs)) throw new Error("invalid_now");

  const policy = normalizePolicy(context.company_policy, companyId);
  const actor = normalizeActor(context.actor_context, companyId);
  const actionType = normalizeToken(recommendedAction.action_type || "recommendation") || "recommendation";
  const provider = normalizeToken(recommendedAction.source_provider);
  const risk = riskLevel(recommendedAction.risk);
  const cls = actionClass(actionType);
  const reasons = [];

  // Source/domain requirement is a hard lower bound and can never be relaxed here.
  if (recommendedAction.authority_required === true) reasons.push("source_requires_authority");
  if (isObject(recommendedAction.trust_gate) && recommendedAction.trust_gate.recommendation_permitted === false) reasons.push("trust_gate_requires_evidence_resolution");
  if (risk === "critical" || risk === "immediate") reasons.push("critical_or_immediate_risk");
  else if (RISK_RANK[risk] >= RISK_RANK[policy.require_authority_risk_at_or_above]) reasons.push("company_risk_threshold");
  if (policy.human_only_action_types.includes(actionType)) reasons.push("company_human_only_action");
  if (policy.authority_required_action_types.includes(actionType)) reasons.push("company_action_policy");
  if (policy.require_authority_for_consequential && cls === "consequential") reasons.push("consequential_action");
  if (policy.require_authority_for_ai && actor.actor_kind === "ai") reasons.push("ai_actor_requires_governance");
  if (policy.require_authority_for_unknown_actor && actor.actor_kind === "unknown" && cls !== "informational") reasons.push("unknown_actor_requires_governance");
  if (ALWAYS_GOVERNED_PROVIDERS.has(provider)) reasons.push("provider_requires_governance");
  if (policy.provider_requirements[provider] === true) reasons.push("company_provider_policy");
  if (context.require_fresh_auth === true && actor.fresh_auth !== true) reasons.push("fresh_auth_required");
  if (context.require_separation_of_duties === true && actor.separation_of_duties_clear !== true) reasons.push("separation_of_duties_required");

  const reasonCodes = Object.freeze(uniq(reasons));
  const required = recommendedAction.authority_required === true || reasonCodes.length > 0;
  const level = requirementLevel(reasonCodes, policy, actionType);
  if (!REQUIREMENT_LEVELS.includes(level)) throw new Error("invalid_requirement_level");
  const material = {
    company_id: companyId,
    packet_id: recommendedAction.packet_id,
    recommended_action_id: recommendedAction.recommended_action_id,
    action_type: actionType,
    source_provider: provider,
    source_revision: recommendedAction.source_revision,
    risk_level: risk,
    source_authority_required: recommendedAction.authority_required === true,
    policy_revision: policy.policy_revision,
    actor_kind: actor.actor_kind,
    actor_id: actor.actor_id,
    fresh_auth: actor.fresh_auth,
    separation_of_duties_clear: actor.separation_of_duties_clear,
    reason_codes: reasonCodes
  };
  const inputsDigest = stableCorrelationHash(material);

  return Object.freeze({
    authority_requirement_id: `dar_${inputsDigest}`,
    company_id: companyId,
    packet_id: requiredText(recommendedAction.packet_id, "packet_id_required"),
    recommended_action_id: requiredText(recommendedAction.recommended_action_id, "recommended_action_id_required"),
    action_type: actionType,
    source_provider: provider,
    source_revision: JSON.parse(JSON.stringify(recommendedAction.source_revision)),
    risk_level: risk,
    authority_required: required,
    requirement_level: level,
    reason_codes: reasonCodes,
    policy_revision: policy.policy_revision,
    actor_kind: actor.actor_kind,
    inputs_digest: inputsDigest,
    evaluated_at: new Date(currentMs).toISOString(),
    projection_only: true,
    authority_granted: false,
    execution_permitted: false
  });
}

export function validateAuthorityRequirement(requirement, expectedCompanyId) {
  try {
    if (!isObject(requirement)) return {valid:false,error:"invalid_authority_requirement"};
    const missing = AUTHORITY_REQUIREMENT_FIELDS.filter(key => !own(requirement, key));
    if (missing.length) return {valid:false,error:"missing_fields",missing};
    const extra = Object.keys(requirement).filter(key => !AUTHORITY_REQUIREMENT_FIELDS.includes(key));
    if (extra.length) return {valid:false,error:"unexpected_fields",extra};
    if (requiredText(requirement.company_id, "company_id_required") !== requiredText(expectedCompanyId, "expected_company_id_required")) return {valid:false,error:"company_mismatch"};
    if (typeof requirement.authority_required !== "boolean") return {valid:false,error:"authority_required_boolean_required"};
    if (!REQUIREMENT_LEVELS.includes(requirement.requirement_level)) return {valid:false,error:"invalid_requirement_level"};
    if (!Array.isArray(requirement.reason_codes)) return {valid:false,error:"reason_codes_required"};
    if (requirement.projection_only !== true || requirement.authority_granted !== false || requirement.execution_permitted !== false) return {valid:false,error:"authority_requirement_boundary_invalid"};
    requiredText(requirement.authority_requirement_id, "authority_requirement_id_required");
    requiredText(requirement.recommended_action_id, "recommended_action_id_required");
    requiredText(requirement.packet_id, "packet_id_required");
    requiredText(requirement.action_type, "action_type_required");
    requiredText(requirement.source_provider, "source_provider_required");
    requiredText(requirement.policy_revision, "policy_revision_required");
    requiredText(requirement.inputs_digest, "inputs_digest_required");
    if (!Number.isFinite(Date.parse(requirement.evaluated_at))) return {valid:false,error:"invalid_evaluated_at"};
    return {valid:true};
  } catch (error) {
    return {valid:false,error:error instanceof Error ? error.message : String(error)};
  }
}

async function getTrustedAuthorityContext() {
  const storage = await chrome.storage.local.get(["currentCompanyId", "decisionAuthorityPolicy", "decisionActorContext"]);
  return {
    company_id: storage.currentCompanyId || null,
    company_policy: storage.decisionAuthorityPolicy || null,
    actor_context: storage.decisionActorContext || null
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_AUTHORITY_REQUIREMENT_DETERMINE") return undefined;
    (async () => {
      try {
        const trusted = await getTrustedAuthorityContext();
        if (!trusted.company_id) throw new Error("company_context_required");
        const result = determineAuthorityRequirement(message.recommended_action, trusted.company_id, {
          company_policy: trusted.company_policy,
          actor_context: trusted.actor_context,
          require_fresh_auth: message.require_fresh_auth === true,
          require_separation_of_duties: message.require_separation_of_duties === true
        }, message.now_ms ?? Date.now());
        sendResponse({success:true,data:result});
      } catch (error) {
        sendResponse({success:false,error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
