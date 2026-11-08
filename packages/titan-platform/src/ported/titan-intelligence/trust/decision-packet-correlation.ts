// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/trust/decision-packet-correlation.js
import { createDecisionPacketCorrelation, stableCorrelationHash } from "../decision/correlation-layer.js";

export const TRUST_DECISION_CORRELATION_VERSION = "1.0.0";
const evidenceId = (value, index) => {
  if (value && typeof value === "object") return String(value.evidence_id || value.ref || value.id || `trust-evidence-${stableCorrelationHash(value)}`);
  if (value != null && String(value).trim()) return String(value).trim();
  return `trust-evidence-${index}`;
};

/** TitanTrust owns evidence evaluation; correlation only retains evidence/source references. */
export function correlateTrustDecision(packet, evaluation, expectedCompanyId) {
  if (!evaluation || typeof evaluation !== "object") throw new Error("invalid_trust_evaluation");
  if (evaluation.company_id !== expectedCompanyId || packet.company_id !== expectedCompanyId) throw new Error("company_mismatch");
  const sourceRefs = Array.isArray(evaluation.supporting_refs) ? evaluation.supporting_refs : [];
  const refs = sourceRefs.map((item,index) => ({
    type:"evidence", id:evidenceId(item,index), company_id:expectedCompanyId,
    source_provider:packet.source_provider, source_revision:packet.source_revision
  }));
  return createDecisionPacketCorrelation(packet, refs, expectedCompanyId);
}
