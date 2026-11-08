// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/shield/decision-packet-convergence.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { createDecisionPacket } from "../decision/decision-packet.js";
import { buildRemediationPreview, TITAN_SHIELD_VERSION } from "./remediation-preview.js";

export const SHIELD_DECISION_CONVERGENCE_VERSION = "1.0.0";
export const SHIELD_DECISION_CONVERGENCE = Object.freeze({
  adapter_id: "titan.shield.decision-packet.convergence.v1",
  domain: "assurance",
  source_provider: "titan_shield",
  authority_owner: "titan_shield",
  finding_owner: "titan_shield",
  remediation_owner: "titan_shield",
  projection_only: true,
  automatic_remediation: false,
  execution_permitted: false,
  authority_granted: false
});

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const text = (value, fallback = null) => typeof value === "string" && value.trim() ? value.trim() : fallback;
const arr = value => Array.isArray(value) ? clone(value) : [];

function normalizeFinding(input, expectedCompanyId) {
  if (!isObject(input)) throw new Error("invalid_shield_finding");
  if (text(input.company_id) !== text(expectedCompanyId)) throw new Error("company_mismatch");
  const findingId = text(input.finding_id);
  if (!findingId) throw new Error("finding_id_required");
  return Object.freeze({
    finding_id: findingId,
    company_id: input.company_id,
    issue: text(input.issue, "unknown"),
    severity: text(input.severity, "unknown"),
    affected_resources: arr(input.affected_resources),
    evidence: arr(input.evidence),
    evidence_state: text(input.evidence_state, null),
    risk: clone(input.risk ?? "unknown"),
    finding_revision: clone(input.finding_revision ?? input.revision ?? null),
    inspection_id: text(input.inspection_id, null),
    inspection_revision: clone(input.inspection_revision ?? null),
    rule_id: text(input.rule_id, null),
    rule_revision: clone(input.rule_revision ?? null),
    definition_id: text(input.definition_id, null),
    definition_revision: clone(input.definition_revision ?? null),
    observed_at: text(input.observed_at, null),
    source_event_id: text(input.source_event_id, null)
  });
}

function normalizePreview(input, finding, expectedCompanyId) {
  if (input == null) {
    return buildRemediationPreview({
      finding_id: finding.finding_id,
      company_id: finding.company_id,
      issue: finding.issue,
      severity: finding.severity,
      affected_resources: finding.affected_resources,
      evidence: finding.evidence,
      proposed_remediation: [],
      expected_result: "unknown",
      risk: finding.risk,
      side_effects: []
    }, expectedCompanyId);
  }
  if (!isObject(input)) throw new Error("invalid_shield_preview_request");
  const merged = {...clone(input)};
  merged.company_id = merged.company_id || finding.company_id;
  merged.finding_id = merged.finding_id || finding.finding_id;
  if (merged.company_id !== finding.company_id) throw new Error("company_mismatch");
  if (merged.finding_id !== finding.finding_id) throw new Error("finding_preview_mismatch");
  if (!Object.prototype.hasOwnProperty.call(merged, "issue")) merged.issue = finding.issue;
  if (!Object.prototype.hasOwnProperty.call(merged, "severity")) merged.severity = finding.severity;
  if (!Object.prototype.hasOwnProperty.call(merged, "affected_resources")) merged.affected_resources = finding.affected_resources;
  if (!Object.prototype.hasOwnProperty.call(merged, "evidence")) merged.evidence = finding.evidence;
  if (!Object.prototype.hasOwnProperty.call(merged, "risk")) merged.risk = finding.risk;
  return buildRemediationPreview(merged, expectedCompanyId);
}

function sourceRevision(finding, previewInput, packetMeta) {
  const explicit = packetMeta.source_revision;
  const previewRevision = isObject(previewInput)
    ? clone(previewInput.remediation_preview_revision ?? previewInput.preview_revision ?? previewInput.revision ?? null)
    : null;
  const findingRevision = clone(finding.finding_revision ?? null);
  if (explicit == null && findingRevision == null && previewRevision == null) throw new Error("source_revision_required");
  return Object.freeze({
    shield_version: TITAN_SHIELD_VERSION,
    convergence_version: SHIELD_DECISION_CONVERGENCE_VERSION,
    finding_id: finding.finding_id,
    finding_revision: findingRevision,
    inspection_id: finding.inspection_id,
    inspection_revision: clone(finding.inspection_revision),
    rule_id: finding.rule_id,
    rule_revision: clone(finding.rule_revision),
    definition_id: finding.definition_id,
    definition_revision: clone(finding.definition_revision),
    remediation_preview_revision: previewRevision,
    source_event_id: finding.source_event_id,
    upstream_revision: clone(explicit ?? null)
  });
}

function evidenceWithProvenance(finding, preview) {
  const items = preview.evidence.length ? preview.evidence : finding.evidence;
  return items.map((item, index) => Object.freeze({
    evidence_ref: clone(item),
    finding_id: finding.finding_id,
    inspection_id: finding.inspection_id,
    rule_id: finding.rule_id,
    source_provider: SHIELD_DECISION_CONVERGENCE.source_provider,
    ordinal: index
  }));
}

function remediationActions(finding, preview, previewInput) {
  const previewRevision = isObject(previewInput)
    ? clone(previewInput.remediation_preview_revision ?? previewInput.preview_revision ?? previewInput.revision ?? null)
    : null;
  return preview.proposed_remediation.map((proposal, index) => Object.freeze({
    action_type: "shield_remediation_preview",
    proposal: clone(proposal),
    finding_id: finding.finding_id,
    remediation_index: index,
    remediation_preview_revision: previewRevision,
    source_provider: SHIELD_DECISION_CONVERGENCE.source_provider,
    proposal_only: true,
    approval_required: true,
    automatic_remediation: false,
    execution_permitted: false,
    authority_granted: false
  }));
}

/**
 * Convert a Shield finding + remediation preview into the canonical assurance DecisionPacket.
 * Shield remains owner of finding/remediation meaning. This function never remediates, approves,
 * schedules, enqueues, persists, dispatches, or grants execution authority.
 */
export function convergeShieldDecisionPacket(input, expectedCompanyId, packetMeta = {}) {
  if (!isObject(input)) throw new Error("invalid_shield_convergence_request");
  const findingInput = isObject(input.finding) ? input.finding : input;
  const previewInput = isObject(input.remediation_preview) ? input.remediation_preview : (isObject(input.preview) ? input.preview : null);
  const finding = normalizeFinding(findingInput, expectedCompanyId);
  const preview = normalizePreview(previewInput, finding, expectedCompanyId);
  const provenance = sourceRevision(finding, previewInput, packetMeta);
  const evidence = evidenceWithProvenance(finding, preview);
  const recommendedActions = remediationActions(finding, preview, previewInput);
  const evidenceState = text(packetMeta.evidence_state, finding.evidence_state || (evidence.length ? "unknown" : "missing"));
  const severity = String(preview.severity || "unknown").toLowerCase();
  const urgency = packetMeta.urgency ?? ({critical:"immediate",high:"high",medium:"medium",low:"low",info:"none",unknown:"unknown"}[severity] || "unknown");

  return createDecisionPacket({
    packet_id: packetMeta.packet_id,
    company_id: finding.company_id,
    domain: "assurance",
    subject: packetMeta.subject || `shield-finding:${finding.finding_id}`,
    observation: Object.freeze({
      finding_id: finding.finding_id,
      issue: preview.issue,
      observed_at: finding.observed_at,
      inspection_id: finding.inspection_id,
      rule_id: finding.rule_id
    }),
    significance: Object.freeze({
      finding_id: finding.finding_id,
      severity: preview.severity,
      affected_resources: clone(preview.affected_resources),
      side_effects: clone(preview.side_effects),
      remediation_preview_count: recommendedActions.length,
      shield_provenance: clone(provenance)
    }),
    evidence,
    evidence_state: evidenceState,
    explanation: Object.freeze({
      issue: preview.issue,
      finding_id: finding.finding_id,
      preview_only: true,
      automatic_remediation: false,
      approval_required: true
    }),
    recommended_actions: recommendedActions,
    expected_effect: Object.freeze({
      expected_result: preview.expected_result,
      side_effects: clone(preview.side_effects),
      remediation_not_applied: true
    }),
    risk: clone(preview.risk ?? finding.risk ?? "unknown"),
    urgency,
    authority_required: true,
    source_provider: SHIELD_DECISION_CONVERGENCE.source_provider,
    source_revision: provenance,
    generated_at: packetMeta.generated_at,
    expires_at: packetMeta.expires_at
  }, expectedCompanyId, packetMeta.now_ms);
}

async function getCurrentCompanyId() {
  const storage = await chrome.storage.local.get(["currentCompanyId"]);
  return storage.currentCompanyId || null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_SHIELD_DECISION_PACKET_CONVERGE") return undefined;
    (async () => {
      try {
        const expectedCompanyId = await getCurrentCompanyId();
        if (!expectedCompanyId) throw new Error("company_context_required");
        const packet = convergeShieldDecisionPacket(message.payload, expectedCompanyId, message.packet_meta || {});
        sendResponse({success:true, data:packet, packet, convergence:SHIELD_DECISION_CONVERGENCE});
      } catch (error) {
        sendResponse({success:false,error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
