// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/rewind/decision-packet-correlation.js
import { createDecisionPacketCorrelation, stableCorrelationHash } from "../decision/correlation-layer.js";

export const REWIND_DECISION_CORRELATION_VERSION = "1.0.0";
const evidenceId = (value, index) => {
  if (value && typeof value === "object") return String(value.evidence_id || value.ref || value.id || `rewind-evidence-${stableCorrelationHash(value)}`);
  if (value != null && String(value).trim()) return String(value).trim();
  return `rewind-evidence-${index}`;
};

/** Rewind owns recovery candidates; correlation never approves or applies recovery. */
export function correlateRewindDecision(packet, preview, expectedCompanyId) {
  if (!preview || typeof preview !== "object") throw new Error("invalid_recovery_preview");
  if (preview.company_id !== expectedCompanyId || packet.company_id !== expectedCompanyId) throw new Error("company_mismatch");
  if (!preview.recovery_candidate_id) throw new Error("recovery_candidate_id_required");
  const refs = [{type:"recovery_candidate",id:String(preview.recovery_candidate_id),company_id:expectedCompanyId,source_provider:packet.source_provider,source_revision:packet.source_revision}];
  for (const [index, item] of (Array.isArray(preview.evidence_refs) ? preview.evidence_refs : []).entries()) {
    refs.push({type:"evidence",id:evidenceId(item,index),company_id:expectedCompanyId,source_provider:packet.source_provider,source_revision:packet.source_revision});
  }
  return createDecisionPacketCorrelation(packet, refs, expectedCompanyId);
}
