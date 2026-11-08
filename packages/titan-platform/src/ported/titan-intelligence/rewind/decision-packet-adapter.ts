// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/rewind/decision-packet-adapter.js
import { createDecisionPacket } from "../decision/decision-packet.js";

export const REWIND_DECISION_ADAPTER_VERSION = "1.0.0";
export const REWIND_DECISION_ADAPTER = Object.freeze({
  adapter_id: "titan.rewind.decision-packet.v1",
  domain: "recovery",
  source_provider: "titan_rewind",
  authority_owner: "titan_rewind",
  projection_only: true
});

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/** Rewind owns recovery analysis/proposals. Recovery approval stays outside this adapter. */
export function adaptRewindPreviewToDecisionPacket(preview, expectedCompanyId, packetMeta = {}) {
  if (!preview || typeof preview !== "object") throw new Error("invalid_recovery_preview");
  if (preview.company_id !== expectedCompanyId) throw new Error("company_mismatch");
  if (!preview.recovery_candidate_id) throw new Error("recovery_candidate_id_required");
  const sourceRevision = packetMeta.source_revision || preview.preview_revision;
  if (sourceRevision == null || String(sourceRevision).trim() === "") throw new Error("source_revision_required");

  return createDecisionPacket({
    packet_id: packetMeta.packet_id,
    company_id: preview.company_id,
    domain: REWIND_DECISION_ADAPTER.domain,
    subject: packetMeta.subject || preview.recovery_candidate_id,
    observation: clone(preview.what_changed ?? "unknown"),
    significance: clone(packetMeta.significance ?? {records_affected:preview.records_affected || [], downstream_effects:preview.downstream_effects || []}),
    evidence: Array.isArray(packetMeta.evidence) ? clone(packetMeta.evidence) : (preview.evidence_refs || []).map(ref => ({ref})),
    evidence_state: packetMeta.evidence_state || (preview.supported === true ? "verified" : "unknown"),
    explanation: clone(packetMeta.explanation ?? (preview.supported === true ? preview.what_changed : "unknown")),
    recommended_actions: Array.isArray(packetMeta.recommended_actions) ? clone(packetMeta.recommended_actions) : [{type:"request_recovery_approval", recoverable_revision:preview.recoverable_revision, excluded_changes:clone(preview.excluded_changes || [])}],
    expected_effect: clone(packetMeta.expected_effect ?? {recoverable_revision:preview.recoverable_revision}),
    risk: clone(preview.risk ?? "unknown"),
    urgency: clone(packetMeta.urgency ?? "unknown"),
    authority_required: true,
    source_provider: REWIND_DECISION_ADAPTER.source_provider,
    source_revision: clone(sourceRevision),
    generated_at: packetMeta.generated_at,
    expires_at: packetMeta.expires_at || new Date(Number(preview.preview_expires_at)).toISOString()
  }, expectedCompanyId, packetMeta.now_ms);
}
