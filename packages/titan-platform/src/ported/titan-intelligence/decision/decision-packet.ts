// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/decision/decision-packet.js
export const DECISION_PACKET_VERSION = "1.1.0";

export const DECISION_PACKET_DOMAINS = Object.freeze(["money", "trust", "assurance", "recovery"]);
export const DECISION_EVIDENCE_STATES = Object.freeze([
  "verified", "partial", "stale", "contradictory", "missing", "expired", "untrusted", "unknown"
]);
export const DECISION_RISK_LEVELS = Object.freeze(["critical", "high", "medium", "low", "none", "unknown"]);
export const DECISION_URGENCY_LEVELS = Object.freeze(["immediate", "high", "medium", "low", "none", "unknown"]);
export const DECISION_PACKET_FIELDS = Object.freeze([
  "packet_id", "company_id", "domain", "subject", "observation", "significance", "evidence",
  "evidence_state", "explanation", "recommended_actions", "expected_effect", "risk", "urgency",
  "authority_required", "source_provider", "source_revision", "generated_at", "expires_at"
]);

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non_finite_number_not_allowed");
  return value;
}

const clone = value => value == null ? value : canonicalize(JSON.parse(JSON.stringify(value)));
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};
const optionalText = (value, fallback = "unknown") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const arr = (value, code) => {
  if (!Array.isArray(value)) throw new Error(code);
  return clone(value);
};

function strictIso(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  const iso = new Date(parsed).toISOString();
  // Require a real timestamp, but normalize equivalent valid ISO/RFC forms deterministically.
  return iso;
}

function requireCompany(input, expectedCompanyId) {
  const expected = requiredText(expectedCompanyId, "expected_company_id_required");
  if (!isObject(input)) throw new Error("invalid_decision_packet_request");
  const actual = requiredText(input.company_id, "company_id_required");
  if (actual !== expected) throw new Error("company_mismatch");
  return actual;
}

function canonicalEnum(value, allowed, code) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!allowed.includes(normalized)) throw new Error(code);
  return normalized;
}

function normalizeRisk(value) {
  if (isObject(value)) {
    if (!own(value, "level")) throw new Error("risk_level_required");
    return Object.freeze({...clone(value), level:canonicalEnum(value.level, DECISION_RISK_LEVELS, "invalid_risk")});
  }
  return canonicalEnum(value, DECISION_RISK_LEVELS, "invalid_risk");
}

function normalizeUrgency(value) {
  if (isObject(value)) {
    if (!own(value, "level")) throw new Error("urgency_level_required");
    return Object.freeze({...clone(value), level:canonicalEnum(value.level, DECISION_URGENCY_LEVELS, "invalid_urgency")});
  }
  return canonicalEnum(value, DECISION_URGENCY_LEVELS, "invalid_urgency");
}

function validateProvenance(input) {
  const provider = requiredText(input.source_provider, "source_provider_required").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(provider)) throw new Error("invalid_source_provider");
  if (input.source_revision == null) throw new Error("source_revision_required");
  const revision = typeof input.source_revision === "string"
    ? requiredText(input.source_revision, "source_revision_required")
    : clone(input.source_revision);
  if (isObject(revision) && Object.keys(revision).length === 0) throw new Error("source_revision_required");
  return {provider, revision};
}

/**
 * Canonical projection builder. DecisionPacket carries recommendations and provenance only.
 * It does not authorize, approve, execute, persist, mutate, or become authority for any domain.
 * Hardened v1.1 rejects malformed enums/provenance/time windows and canonicalizes nested data.
 */
export function createDecisionPacket(input, expectedCompanyId, now = Date.now()) {
  requireCompany(input, expectedCompanyId);
  const packetId = requiredText(input.packet_id, "packet_id_required");
  const domain = canonicalEnum(input.domain, DECISION_PACKET_DOMAINS, "invalid_decision_domain");
  const provenance = validateProvenance(input);

  if (!own(input, "evidence")) throw new Error("evidence_required");
  if (!own(input, "recommended_actions")) throw new Error("recommended_actions_required");
  if (typeof input.authority_required !== "boolean") throw new Error("authority_required_boolean_required");

  const generatedAt = strictIso(input.generated_at, "generated_at_required");
  const expiresAt = strictIso(input.expires_at, "expires_at_required");
  const generatedMs = Date.parse(generatedAt);
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid_now");
  if (expiresMs <= generatedMs) throw new Error("packet_expiry_must_follow_generation");
  if (expiresMs <= nowMs) throw new Error("packet_expired");

  const packet = {
    packet_id: packetId,
    company_id: input.company_id.trim(),
    domain,
    subject: optionalText(input.subject),
    observation: clone(input.observation ?? "unknown"),
    significance: clone(input.significance ?? "unknown"),
    evidence: arr(input.evidence, "invalid_evidence_array"),
    evidence_state: canonicalEnum(input.evidence_state, DECISION_EVIDENCE_STATES, "invalid_evidence_state"),
    explanation: clone(input.explanation ?? "unknown"),
    recommended_actions: arr(input.recommended_actions, "invalid_recommended_actions_array"),
    expected_effect: clone(input.expected_effect ?? "unknown"),
    risk: normalizeRisk(input.risk),
    urgency: normalizeUrgency(input.urgency),
    authority_required: input.authority_required,
    source_provider: provenance.provider,
    source_revision: provenance.revision,
    generated_at: generatedAt,
    expires_at: expiresAt
  };

  return Object.freeze(packet);
}

export function validateDecisionPacket(packet, expectedCompanyId, now = Date.now()) {
  try {
    if (!isObject(packet)) return {valid:false,error:"invalid_decision_packet_request"};
    const keys = Object.keys(packet);
    const missing = DECISION_PACKET_FIELDS.filter(key => !own(packet, key));
    if (missing.length) return {valid:false,error:"missing_fields",missing};
    const extra = keys.filter(key => !DECISION_PACKET_FIELDS.includes(key));
    if (extra.length) return {valid:false,error:"unexpected_fields",extra};
    const normalized = createDecisionPacket(packet, expectedCompanyId, now);
    return {valid:true, normalized};
  } catch (error) {
    return {valid:false,error:error instanceof Error ? error.message : String(error)};
  }
}

export function decisionPacketExpiryState(packet, now = Date.now()) {
  if (!isObject(packet)) throw new Error("invalid_decision_packet_request");
  const expires = Date.parse(strictIso(packet.expires_at, "expires_at_required"));
  const current = Number(now);
  if (!Number.isFinite(current)) throw new Error("invalid_now");
  return Object.freeze({expired: expires <= current, expires_at:new Date(expires).toISOString(), remaining_ms:Math.max(0, expires-current)});
}

// Compatibility projectors. Runtime ownership remains in source-owned adapters/adapter-registry.js.
export function projectMoneyAction(action, expectedCompanyId, packetMeta = {}) {
  return import("../financial-engine/decision-packet-adapter.js").then(m => m.adaptMoneyActionToDecisionPacket(action, expectedCompanyId, packetMeta));
}
export function projectTrustEvaluation(evaluation, expectedCompanyId, packetMeta = {}) {
  return import("../trust/decision-packet-adapter.js").then(m => m.adaptTrustEvaluationToDecisionPacket(evaluation, expectedCompanyId, packetMeta));
}
export function projectShieldPreview(preview, expectedCompanyId, packetMeta = {}) {
  return import("../shield/decision-packet-adapter.js").then(m => m.adaptShieldPreviewToDecisionPacket(preview, expectedCompanyId, packetMeta));
}
export function projectRewindPreview(preview, expectedCompanyId, packetMeta = {}) {
  return import("../rewind/decision-packet-adapter.js").then(m => m.adaptRewindPreviewToDecisionPacket(preview, expectedCompanyId, packetMeta));
}
