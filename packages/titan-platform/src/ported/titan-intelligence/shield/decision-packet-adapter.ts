// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/shield/decision-packet-adapter.js
import { convergeShieldDecisionPacket, SHIELD_DECISION_CONVERGENCE } from "./decision-packet-convergence.js";

export const SHIELD_DECISION_ADAPTER_VERSION = "1.1.0";
export const SHIELD_DECISION_ADAPTER = Object.freeze({
  ...SHIELD_DECISION_CONVERGENCE,
  adapter_id: "titan.shield.decision-packet.v1"
});

/** Compatibility adapter: plain remediation previews and native finding+preview envelopes converge identically. */
export function adaptShieldPreviewToDecisionPacket(preview, expectedCompanyId, packetMeta = {}) {
  if (!preview || typeof preview !== "object") throw new Error("invalid_shield_preview");
  if (preview.finding && typeof preview.finding === "object") {
    return convergeShieldDecisionPacket(preview, expectedCompanyId, packetMeta);
  }
  const finding = {
    finding_id: preview.finding_id,
    company_id: preview.company_id,
    issue: preview.issue,
    severity: preview.severity,
    affected_resources: preview.affected_resources,
    evidence: preview.evidence,
    evidence_state: packetMeta.evidence_state,
    risk: preview.risk,
    finding_revision: packetMeta.finding_revision ?? packetMeta.source_revision,
    inspection_id: packetMeta.inspection_id,
    inspection_revision: packetMeta.inspection_revision,
    rule_id: packetMeta.rule_id,
    rule_revision: packetMeta.rule_revision,
    definition_id: packetMeta.definition_id,
    definition_revision: packetMeta.definition_revision,
    observed_at: packetMeta.observed_at,
    source_event_id: packetMeta.source_event_id
  };
  return convergeShieldDecisionPacket({finding, remediation_preview:preview}, expectedCompanyId, packetMeta);
}

export const adaptShieldFindingToDecisionPacket = convergeShieldDecisionPacket;
