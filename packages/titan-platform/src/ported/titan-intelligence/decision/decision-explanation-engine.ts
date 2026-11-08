// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/decision-explanation-engine.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import {
  DECISION_PACKET_DOMAINS,
  DECISION_PACKET_FIELDS,
  DECISION_EVIDENCE_STATES,
  decisionPacketExpiryState
} from "./decision-packet.js";
import { stableCorrelationHash, canonicalCorrelationJson } from "./correlation-layer.js";

export const DECISION_EXPLANATION_VERSION = "1.0.0";
export const DECISION_EXPLANATION_FIELDS = Object.freeze([
  "explanation_id", "company_id", "packet_id", "domain", "what_happened", "why_it_matters",
  "evidence_quality", "uncertainty", "expected_effect", "required_authority", "risk", "urgency",
  "provenance", "expiry", "projection_only", "read_only", "authority_granted"
]);

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const label = key => String(key).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const normalizeLevel = value => {
  if (isObject(value) && typeof value.level === "string") return value.level.trim().toLowerCase();
  return typeof value === "string" ? value.trim().toLowerCase() : "unknown";
};

function humanValue(value, depth = 0) {
  if (value == null) return "Unknown.";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.toLowerCase() === "unknown") return "Unknown.";
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }
  if (typeof value === "number" || typeof value === "boolean") return `${String(value)}.`;
  if (Array.isArray(value)) {
    if (!value.length) return "None supplied.";
    const parts = value.slice(0, 12).map(item => humanValue(item, depth + 1).replace(/[.]$/, ""));
    const suffix = value.length > 12 ? `; plus ${value.length - 12} more` : "";
    return `${parts.join("; ")}${suffix}.`;
  }
  if (isObject(value)) {
    if (depth > 4) return `${canonicalCorrelationJson(value)}.`;
    const parts = Object.keys(value).sort().slice(0, 16).map(key => {
      const rendered = humanValue(value[key], depth + 1).replace(/[.]$/, "");
      return `${label(key)}: ${rendered}`;
    });
    const suffix = Object.keys(value).length > 16 ? `; plus ${Object.keys(value).length - 16} more fields` : "";
    return parts.length ? `${parts.join("; ")}${suffix}.` : "Unknown.";
  }
  return "Unknown.";
}

function assertPacket(packet, expectedCompanyId) {
  if (!isObject(packet)) throw new Error("invalid_decision_packet_request");
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  if (requiredText(packet.company_id, "company_id_required") !== companyId) throw new Error("company_mismatch");
  const keys = Object.keys(packet);
  const missing = DECISION_PACKET_FIELDS.filter(key => !own(packet, key));
  if (missing.length) throw new Error("missing_packet_fields");
  const extra = keys.filter(key => !DECISION_PACKET_FIELDS.includes(key));
  if (extra.length) throw new Error("unexpected_packet_fields");
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

const EVIDENCE_LANGUAGE = Object.freeze({
  verified: Object.freeze({quality:"The supplied evidence is verified by the source domain.", uncertainty:"The evidence state is verified. Uncertainty may still exist outside the evidence represented in this packet.", reasons:[]}),
  partial: Object.freeze({quality:"The supplied evidence is only partially complete or supported.", uncertainty:"Material uncertainty remains because the evidence is partial.", reasons:["partial_evidence"]}),
  stale: Object.freeze({quality:"The supplied evidence is stale and may no longer reflect the current state.", uncertainty:"Uncertainty is elevated because the evidence may be out of date.", reasons:["stale_evidence"]}),
  contradictory: Object.freeze({quality:"The supplied evidence contains a material contradiction.", uncertainty:"Uncertainty is high because the evidence conflicts and should not be silently reconciled.", reasons:["contradictory_evidence"]}),
  missing: Object.freeze({quality:"Required supporting evidence is missing.", uncertainty:"The packet is materially uncertain because required evidence is missing.", reasons:["missing_evidence"]}),
  expired: Object.freeze({quality:"The evidence has expired for its intended decision context.", uncertainty:"The packet should be revalidated because its evidence has expired.", reasons:["expired_evidence"]}),
  untrusted: Object.freeze({quality:"The evidence source or integrity is not trusted for this decision.", uncertainty:"The packet is materially uncertain because the evidence is untrusted.", reasons:["untrusted_evidence"]}),
  unknown: Object.freeze({quality:"The evidence quality is unknown.", uncertainty:"The level of uncertainty cannot be established from the supplied evidence state.", reasons:["unknown_evidence_quality"]})
});

function authorityProjection(packet) {
  if (packet.authority_required) {
    return Object.freeze({
      required: true,
      summary: "Additional governed authority is required before any recommended action may proceed.",
      packet_grants_authority: false
    });
  }
  return Object.freeze({
    required: false,
    summary: "This packet does not declare additional authority as required, but downstream permissions, policy, risk, governance and execution controls still apply.",
    packet_grants_authority: false
  });
}

function riskProjection(packet) {
  const level = normalizeLevel(packet.risk);
  return Object.freeze({level, summary:`Risk is ${level || "unknown"}.`});
}

function urgencyProjection(packet) {
  const level = normalizeLevel(packet.urgency);
  return Object.freeze({level, summary:`Urgency is ${level || "unknown"}.`});
}

/**
 * Deterministic human-readable DecisionPacket explanation.
 * This is a read-only projection. It does not infer hidden reasoning, calculate confidence,
 * alter evidence state, grant authority, approve actions, execute recommendations or mutate source state.
 */
export function explainDecisionPacket(packet, expectedCompanyId, context = {}, now = Date.now()) {
  const companyId = assertPacket(packet, expectedCompanyId);
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid_now");
  const evidenceLanguage = EVIDENCE_LANGUAGE[packet.evidence_state];
  const expiry = decisionPacketExpiryState(packet, nowMs);
  const uncertaintyReasons = [...evidenceLanguage.reasons];
  if (expiry.expired && !uncertaintyReasons.includes("packet_expired")) uncertaintyReasons.push("packet_expired");
  if (context?.projection_state?.state === "superseded") uncertaintyReasons.push("projection_superseded");
  if (context?.projection_state?.state === "duplicate") uncertaintyReasons.push("duplicate_projection");
  if (context?.projection_state?.state === "stale") uncertaintyReasons.push("stale_projection");

  const explanationId = `dxe_${stableCorrelationHash({
    company_id: companyId,
    packet_id: packet.packet_id,
    source_provider: packet.source_provider,
    source_revision: packet.source_revision,
    evidence_state: packet.evidence_state,
    projection_state: context?.projection_state?.state || null
  })}`;

  return Object.freeze({
    explanation_id: explanationId,
    company_id: companyId,
    packet_id: packet.packet_id,
    domain: packet.domain,
    what_happened: Object.freeze({
      subject: humanValue(packet.subject),
      observation: humanValue(packet.observation),
      source_explanation: humanValue(packet.explanation)
    }),
    why_it_matters: humanValue(packet.significance),
    evidence_quality: Object.freeze({
      state: packet.evidence_state,
      summary: evidenceLanguage.quality,
      evidence_count: packet.evidence.length,
      evidence_refs: Object.freeze(clone(packet.evidence))
    }),
    uncertainty: Object.freeze({
      summary: expiry.expired ? `${evidenceLanguage.uncertainty} The DecisionPacket itself is expired.` : evidenceLanguage.uncertainty,
      reason_codes: Object.freeze(uncertaintyReasons),
      confidence_score_invented: false
    }),
    expected_effect: humanValue(packet.expected_effect),
    required_authority: authorityProjection(packet),
    risk: riskProjection(packet),
    urgency: urgencyProjection(packet),
    provenance: Object.freeze({
      source_provider: packet.source_provider,
      source_revision: clone(packet.source_revision),
      generated_at: packet.generated_at,
      correlation_id: context?.correlation?.correlation_id || null,
      lineage_key: context?.projection_state?.lineage_key || null
    }),
    expiry,
    projection_only: true,
    read_only: true,
    authority_granted: false
  });
}

async function getCurrentCompanyId() {
  const storage = await chrome.storage.local.get(["currentCompanyId"]);
  return storage.currentCompanyId || null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_DECISION_EXPLANATION_BUILD") return undefined;
    (async () => {
      try {
        const companyId = await getCurrentCompanyId();
        if (!companyId) throw new Error("company_context_required");
        const result = explainDecisionPacket(message.packet, companyId, message.context || {}, message.now_ms ?? Date.now());
        sendResponse({success:true, data:result});
      } catch (error) {
        sendResponse({success:false, error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
