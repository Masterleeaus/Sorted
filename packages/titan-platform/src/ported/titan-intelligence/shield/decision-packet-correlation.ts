// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/shield/decision-packet-correlation.js
import { createDecisionPacketCorrelation, stableCorrelationHash } from "../decision/correlation-layer.js";

export const SHIELD_DECISION_CORRELATION_VERSION = "1.1.0";
const evidenceId = (value, index) => {
  const item = value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value,"evidence_ref") ? value.evidence_ref : value;
  if (item && typeof item === "object") return String(item.evidence_id || item.ref || item.id || `shield-evidence-${stableCorrelationHash(item)}`);
  if (item != null && String(item).trim()) return String(item).trim();
  return `shield-evidence-${index}`;
};

/** Shield owns findings/remediation previews; this exposes reference-only finding/evidence lineage. */
export function correlateShieldDecision(packet, payload, expectedCompanyId) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_shield_preview");
  const finding = payload.finding && typeof payload.finding === "object" ? payload.finding : payload;
  const preview = payload.remediation_preview && typeof payload.remediation_preview === "object"
    ? payload.remediation_preview
    : (payload.preview && typeof payload.preview === "object" ? payload.preview : payload);
  if (finding.company_id !== expectedCompanyId || packet.company_id !== expectedCompanyId) throw new Error("company_mismatch");
  if (!finding.finding_id) throw new Error("finding_id_required");
  const refs = [{type:"finding",id:String(finding.finding_id),company_id:expectedCompanyId,source_provider:packet.source_provider,source_revision:packet.source_revision}];
  const evidence = Array.isArray(preview.evidence) && preview.evidence.length ? preview.evidence : (Array.isArray(finding.evidence) ? finding.evidence : packet.evidence);
  for (const [index, item] of evidence.entries()) {
    refs.push({type:"evidence",id:evidenceId(item,index),company_id:expectedCompanyId,source_provider:packet.source_provider,source_revision:packet.source_revision});
  }
  return createDecisionPacketCorrelation(packet, refs, expectedCompanyId);
}
