// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/trust/decision-packet-adapter.js
import { createDecisionPacket } from "../decision/decision-packet.js";

export const TRUST_DECISION_ADAPTER_VERSION = "1.0.0";
export const TRUST_DECISION_ADAPTER = Object.freeze({
  adapter_id: "titan.trust.decision-packet.v1",
  domain: "trust",
  source_provider: "titan_trust",
  authority_owner: "titan_trust",
  projection_only: true
});

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/** TitanTrust owns evidence evaluation. This adapter cannot alter its state or reasons. */
export function adaptTrustEvaluationToDecisionPacket(evaluation, expectedCompanyId, packetMeta = {}) {
  if (!evaluation || typeof evaluation !== "object") throw new Error("invalid_trust_evaluation");
  if (evaluation.company_id !== expectedCompanyId) throw new Error("company_mismatch");
  if (evaluation.source_revision == null || String(evaluation.source_revision).trim() === "") throw new Error("source_revision_required");

  const refs = Array.isArray(evaluation.supporting_refs) ? evaluation.supporting_refs.map(ref => ({ref})) : [];
  return createDecisionPacket({
    packet_id: packetMeta.packet_id,
    company_id: evaluation.company_id,
    domain: TRUST_DECISION_ADAPTER.domain,
    subject: packetMeta.subject || "evidence_quality",
    observation: clone(packetMeta.observation ?? {state:evaluation.state, reason_codes:evaluation.reason_codes || []}),
    significance: clone(packetMeta.significance ?? "Evidence quality determines whether downstream action is supportable."),
    evidence: Array.isArray(packetMeta.evidence) ? clone(packetMeta.evidence) : refs,
    evidence_state: evaluation.state,
    explanation: clone(packetMeta.explanation ?? {reason_codes:evaluation.reason_codes || [], missing_requirements:evaluation.missing_requirements || []}),
    recommended_actions: Array.isArray(packetMeta.recommended_actions) ? clone(packetMeta.recommended_actions) : [],
    expected_effect: clone(packetMeta.expected_effect ?? "unknown"),
    risk: clone(packetMeta.risk ?? "unknown"),
    urgency: clone(packetMeta.urgency ?? "unknown"),
    authority_required: packetMeta.authority_required === true,
    source_provider: TRUST_DECISION_ADAPTER.source_provider,
    source_revision: clone(evaluation.source_revision),
    generated_at: packetMeta.generated_at || evaluation.evaluated_at,
    expires_at: packetMeta.expires_at
  }, expectedCompanyId, packetMeta.now_ms);
}
