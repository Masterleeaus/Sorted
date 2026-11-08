// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/t0gm-decision-view.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { DECISION_PACKET_DOMAINS } from "./decision-packet.js";
import { stableCorrelationHash, canonicalCorrelationJson } from "./correlation-layer.js";

export const T0GM_DECISION_VIEW_VERSION = "1.2.0";
export const T0GM_PRINCIPAL_KIND = "titan_god_mode";
export const T0GM_ATTENTION_REASONS = Object.freeze([
  "critical_risk",
  "high_risk",
  "authority_required",
  "anomalous_evidence",
  "explicit_anomaly",
  "critical_urgency",
  "high_significance"
]);

const ANOMALOUS_EVIDENCE_STATES = Object.freeze(new Set([
  "contradictory", "missing", "untrusted", "expired", "stale"
]));
const HIGH_LEVELS = Object.freeze(new Set(["high", "critical", "immediate"]));
const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};
const normalizeText = value => typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";

function assertViewer(viewer, expectedPrincipalId) {
  if (!isObject(viewer)) throw new Error("t0gm_viewer_required");
  const kind = requiredText(viewer.principal_kind, "t0gm_principal_kind_required");
  if (kind !== T0GM_PRINCIPAL_KIND) throw new Error("t0gm_principal_required");
  const principalId = requiredText(viewer.principal_id, "t0gm_principal_id_required");
  const expected = requiredText(expectedPrincipalId, "expected_t0gm_principal_id_required");
  if (principalId !== expected) throw new Error("t0gm_principal_mismatch");
  if (viewer.company_role != null) throw new Error("t0gm_must_not_be_company_role");
  if (viewer.company_permissions != null) throw new Error("t0gm_must_not_inherit_company_permissions");
  return Object.freeze({principal_kind:T0GM_PRINCIPAL_KIND, principal_id:principalId});
}

function assertFeed(feed, expectedCompanyId) {
  if (!isObject(feed)) throw new Error("unified_decision_feed_required");
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  if (requiredText(feed.company_id, "feed_company_id_required") !== companyId) throw new Error("company_mismatch");
  if (feed.read_only !== true || feed.projection_only !== true) throw new Error("feed_must_be_read_only_projection");
  if (!Array.isArray(feed.entries)) throw new Error("feed_entries_required");
  return companyId;
}

function explicitAnomaly(packet) {
  const sig = packet.significance;
  if (!isObject(sig)) return false;
  if (sig.anomaly === true || sig.anomalous === true) return true;
  const markers = [sig.type, sig.kind, sig.classification, sig.reason, sig.reason_code, sig.signal];
  return markers.some(value => normalizeText(value).includes("anomal"));
}

function highSignificance(packet, sort) {
  if (sort && Number.isFinite(sort.significance_rank)) return sort.significance_rank >= 4;
  const sig = packet.significance;
  if (typeof sig === "string") return HIGH_LEVELS.has(normalizeText(sig));
  if (!isObject(sig)) return false;
  return [sig.level, sig.severity, sig.priority, sig.urgency, sig.risk].some(value => HIGH_LEVELS.has(normalizeText(value)));
}

function classify(entry) {
  const packet = entry.packet;
  const reasons = [];
  const risk = normalizeText(entry.sort?.risk_level || packet.risk?.level || packet.risk);
  const urgency = normalizeText(entry.sort?.urgency_level || packet.urgency?.level || packet.urgency);
  const evidenceState = normalizeText(packet.evidence_state);
  if (risk === "critical") reasons.push("critical_risk");
  else if (risk === "high" || risk === "immediate") reasons.push("high_risk");
  if (packet.authority_required === true) reasons.push("authority_required");
  if (ANOMALOUS_EVIDENCE_STATES.has(evidenceState)) reasons.push("anomalous_evidence");
  if (explicitAnomaly(packet)) reasons.push("explicit_anomaly");
  if (urgency === "critical" || urgency === "immediate") reasons.push("critical_urgency");
  if (highSignificance(packet, entry.sort)) reasons.push("high_significance");
  return Object.freeze(reasons);
}

function attentionRank(reasons, entry) {
  let rank = 0;
  if (reasons.includes("critical_risk")) rank += 100;
  if (reasons.includes("authority_required")) rank += 50;
  if (reasons.includes("critical_urgency")) rank += 40;
  if (reasons.includes("anomalous_evidence")) rank += 30;
  if (reasons.includes("explicit_anomaly")) rank += 25;
  if (reasons.includes("high_risk")) rank += 20;
  if (reasons.includes("high_significance")) rank += 10;
  rank += Number(entry.sort?.risk_rank || 0);
  rank += Number(entry.sort?.urgency_rank || 0);
  return rank;
}

function assertEntry(entry, companyId) {
  if (!isObject(entry) || !isObject(entry.packet)) throw new Error("invalid_feed_entry");
  if (requiredText(entry.company_id, "entry_company_id_required") !== companyId) throw new Error("company_mismatch");
  if (requiredText(entry.packet.company_id, "packet_company_id_required") !== companyId) throw new Error("company_mismatch");
  if (!DECISION_PACKET_DOMAINS.includes(entry.packet.domain)) throw new Error("invalid_decision_domain");
  if (entry.projection_only !== true) throw new Error("entry_must_be_projection_only");
  if (entry.correlation && entry.correlation.company_id !== companyId) throw new Error("company_mismatch");
}

/**
 * Build the user-only Titan God Mode attention projection.
 * This is a read-only oversight projection. It does not grant, change, inherit,
 * or bypass company permissions, domain lifecycle state, Governance decisions,
 * Autonomy authority, approvals or Command Bus execution.
 */
export function buildT0GMDecisionView(feed, expectedCompanyId, viewer, expectedT0GMPrincipalId, options = {}, now = Date.now()) {
  const companyId = assertFeed(feed, expectedCompanyId);
  const principal = assertViewer(viewer, expectedT0GMPrincipalId);
  const currentMs = Number(now);
  if (!Number.isFinite(currentMs)) throw new Error("invalid_now");
  const includeAll = options.include_all === true;
  const includeExpired = options.include_expired === true;
  const items = [];

  for (const entry of feed.entries) {
    assertEntry(entry, companyId);
    if (entry.expiry?.expired === true && !includeExpired) continue;
    const reasons = classify(entry);
    if (!includeAll && reasons.length === 0) continue;
    const rank = attentionRank(reasons, entry);
    const viewItemId = `t0gm_${stableCorrelationHash({
      company_id: companyId,
      principal_id: principal.principal_id,
      entry_id: entry.entry_id,
      packet_id: entry.packet.packet_id,
      reasons
    })}`;
    items.push(Object.freeze({
      view_item_id: viewItemId,
      company_id: companyId,
      packet_id: entry.packet.packet_id,
      domain: entry.packet.domain,
      attention_reasons: Object.freeze([...reasons]),
      attention_rank: rank,
      packet: clone(entry.packet),
      correlation: clone(entry.correlation),
      decision_explanation: clone(entry.decision_explanation),
      recommended_actions: clone(entry.recommended_actions || []),
      expiry: clone(entry.expiry),
      source_entry_id: entry.entry_id,
      projection_only: true,
      read_only: true
    }));
  }

  items.sort((a,b) => b.attention_rank - a.attention_rank ||
    String(b.packet.generated_at).localeCompare(String(a.packet.generated_at)) ||
    canonicalCorrelationJson(a.view_item_id).localeCompare(canonicalCorrelationJson(b.view_item_id)));

  return Object.freeze({
    view_version: T0GM_DECISION_VIEW_VERSION,
    viewer: principal,
    company_id: companyId,
    generated_at: new Date(currentMs).toISOString(),
    total: items.length,
    items: Object.freeze(items),
    company_role_authority_inherited: false,
    company_governance_bypassed: false,
    domain_authority_owned: false,
    read_only: true,
    projection_only: true
  });
}

async function getTrustedContext() {
  const storage = await chrome.storage.local.get(["currentCompanyId", "t0gmOwnerPrincipalId"]);
  return {
    company_id: storage.currentCompanyId || null,
    t0gm_principal_id: storage.t0gmOwnerPrincipalId || null
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_T0GM_DECISION_VIEW_BUILD") return undefined;
    (async () => {
      try {
        const trusted = await getTrustedContext();
        if (!trusted.company_id) throw new Error("company_context_required");
        if (!trusted.t0gm_principal_id) throw new Error("t0gm_owner_not_provisioned");
        const view = buildT0GMDecisionView(
          message.feed,
          trusted.company_id,
          message.viewer,
          trusted.t0gm_principal_id,
          message.options || {},
          message.now_ms ?? Date.now()
        );
        sendResponse({success:true, data:view});
      } catch (error) {
        sendResponse({success:false, error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
