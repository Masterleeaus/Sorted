// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/packet-dedup-supersession.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { DECISION_PACKET_DOMAINS, DECISION_PACKET_FIELDS, decisionPacketExpiryState } from "./decision-packet.js";
import { canonicalCorrelationJson, stableCorrelationHash } from "./correlation-layer.js";

export const DECISION_PROJECTION_LINEAGE_VERSION = "1.0.0";
export const DECISION_PROJECTION_STATES = Object.freeze(["active", "duplicate", "stale", "superseded"]);

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};

function assertPacket(packet, expectedCompanyId) {
  if (!isObject(packet)) throw new Error("invalid_decision_packet_request");
  const keys = Object.keys(packet);
  if (DECISION_PACKET_FIELDS.some(key => !own(packet, key))) throw new Error("missing_decision_packet_fields");
  if (keys.some(key => !DECISION_PACKET_FIELDS.includes(key))) throw new Error("unexpected_decision_packet_fields");
  if (requiredText(packet.company_id, "company_id_required") !== expectedCompanyId) throw new Error("company_mismatch");
  if (!DECISION_PACKET_DOMAINS.includes(packet.domain)) throw new Error("invalid_decision_domain");
  requiredText(packet.packet_id, "packet_id_required");
  requiredText(packet.source_provider, "source_provider_required");
  if (packet.source_revision == null) throw new Error("source_revision_required");
  if (!Number.isFinite(Date.parse(packet.generated_at))) throw new Error("invalid_generated_at");
  return packet;
}

function normalizeCorrelation(correlation, packet, expectedCompanyId) {
  if (correlation == null) return null;
  if (!isObject(correlation) || !Array.isArray(correlation.refs)) throw new Error("invalid_decision_correlation");
  if (requiredText(correlation.company_id, "correlation_company_id_required") !== expectedCompanyId) throw new Error("company_mismatch");
  if (requiredText(correlation.packet_id, "correlation_packet_id_required") !== packet.packet_id) throw new Error("correlation_packet_mismatch");
  if (requiredText(correlation.domain, "correlation_domain_required") !== packet.domain) throw new Error("correlation_domain_mismatch");
  if (correlation.projection_only !== true) throw new Error("correlation_must_be_projection_only");
  return correlation;
}

function semanticPacket(packet) {
  // Intentionally exclude projection identity/time/provenance revision. These describe the
  // projection instance, not the material decision content being deduplicated.
  return {
    company_id: packet.company_id,
    domain: packet.domain,
    subject: packet.subject,
    observation: packet.observation,
    significance: packet.significance,
    evidence: packet.evidence,
    evidence_state: packet.evidence_state,
    explanation: packet.explanation,
    recommended_actions: packet.recommended_actions,
    expected_effect: packet.expected_effect,
    risk: packet.risk,
    urgency: packet.urgency,
    authority_required: packet.authority_required,
    source_provider: packet.source_provider
  };
}

export function decisionPacketMaterialFingerprint(packet, expectedCompanyId) {
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  assertPacket(packet, companyId);
  return `dpm_${stableCorrelationHash(semanticPacket(packet))}`;
}

function lineageAnchors(correlation) {
  if (!correlation) return [];
  const primaryTypes = new Set(["finding", "action", "recovery_candidate"]);
  const primary = correlation.refs.filter(ref => primaryTypes.has(ref.type));
  const selected = primary.length ? primary : correlation.refs.filter(ref => ref.type === "evidence");
  return selected.map(ref => ({type:ref.type, id:ref.id, source_provider:ref.source_provider}))
    .sort((a,b) => canonicalCorrelationJson(a).localeCompare(canonicalCorrelationJson(b)));
}

export function decisionPacketLineageKey(packet, correlation, expectedCompanyId) {
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  assertPacket(packet, companyId);
  const normalizedCorrelation = normalizeCorrelation(correlation, packet, companyId);
  const anchors = lineageAnchors(normalizedCorrelation);
  const identity = {
    company_id: companyId,
    domain: packet.domain,
    source_provider: packet.source_provider,
    anchors: anchors.length ? anchors : [{type:"subject", id:canonicalCorrelationJson(packet.subject), source_provider:packet.source_provider}]
  };
  return `dpl_${stableCorrelationHash(identity)}`;
}

function sortNewestFirst(a, b) {
  return b.generated_at_ms - a.generated_at_ms ||
    canonicalCorrelationJson(b.packet.source_revision).localeCompare(canonicalCorrelationJson(a.packet.source_revision)) ||
    a.packet.packet_id.localeCompare(b.packet.packet_id);
}

/**
 * Reconcile DecisionPacket projection history without changing any source/domain state.
 * Output is an immutable read model only. It never persists, approves, resolves, executes,
 * remediates, recovers, or mutates a packet/source record.
 */
export function reconcileDecisionPacketProjections(items, expectedCompanyId, now = Date.now()) {
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  if (!Array.isArray(items)) throw new Error("decision_projection_items_array_required");
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid_now");

  const records = [];
  const packetIds = new Set();
  for (const raw of items) {
    const item = isObject(raw) && own(raw, "packet") ? raw : {packet: raw};
    const packet = assertPacket(item.packet, companyId);
    if (packetIds.has(packet.packet_id)) throw new Error("duplicate_packet_id");
    packetIds.add(packet.packet_id);
    const correlation = normalizeCorrelation(item.correlation, packet, companyId);
    records.push({
      packet,
      correlation,
      material_fingerprint: decisionPacketMaterialFingerprint(packet, companyId),
      lineage_key: decisionPacketLineageKey(packet, correlation, companyId),
      generated_at_ms: Date.parse(packet.generated_at),
      expiry: decisionPacketExpiryState(packet, nowMs)
    });
  }

  const byLineage = new Map();
  for (const record of records) {
    if (!byLineage.has(record.lineage_key)) byLineage.set(record.lineage_key, []);
    byLineage.get(record.lineage_key).push(record);
  }

  const states = new Map();
  const lineages = [];
  for (const [lineageKey, membersRaw] of [...byLineage.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    const members = [...membersRaw].sort(sortNewestFirst);
    const representatives = [];
    const seenFingerprints = new Map();

    for (const member of members) {
      if (!seenFingerprints.has(member.material_fingerprint)) {
        seenFingerprints.set(member.material_fingerprint, member);
        representatives.push(member);
      } else {
        const canonical = seenFingerprints.get(member.material_fingerprint);
        states.set(member.packet.packet_id, {
          state: "duplicate",
          duplicate_of: canonical.packet.packet_id,
          superseded_by: null,
          stale_reason: member.expiry.expired ? "expired_duplicate_projection" : "materially_identical_projection",
          active: false
        });
      }
    }

    representatives.sort(sortNewestFirst);
    const activeRepresentative = representatives[0] || null;
    if (activeRepresentative) {
      states.set(activeRepresentative.packet.packet_id, activeRepresentative.expiry.expired ? {
        state: "stale",
        duplicate_of: null,
        superseded_by: null,
        stale_reason: "projection_expired",
        active: false
      } : {
        state: "active",
        duplicate_of: null,
        superseded_by: null,
        stale_reason: null,
        active: true
      });

      for (let i = 1; i < representatives.length; i += 1) {
        const older = representatives[i];
        const newer = representatives[i - 1];
        states.set(older.packet.packet_id, {
          state: "superseded",
          duplicate_of: null,
          superseded_by: newer.packet.packet_id,
          stale_reason: older.expiry.expired ? "expired_and_superseded" : "newer_material_projection",
          active: false
        });
      }
    }

    lineages.push(Object.freeze({
      lineage_key: lineageKey,
      company_id: companyId,
      active_packet_id: activeRepresentative && !activeRepresentative.expiry.expired ? activeRepresentative.packet.packet_id : null,
      latest_packet_id: activeRepresentative?.packet.packet_id || null,
      packet_ids: Object.freeze(members.map(member => member.packet.packet_id)),
      material_versions: representatives.length,
      projection_count: members.length,
      projection_only: true
    }));
  }

  const projections = Object.freeze(records.map(record => {
    const state = states.get(record.packet.packet_id);
    return Object.freeze({
      packet_id: record.packet.packet_id,
      company_id: companyId,
      domain: record.packet.domain,
      source_provider: record.packet.source_provider,
      source_revision: clone(record.packet.source_revision),
      material_fingerprint: record.material_fingerprint,
      lineage_key: record.lineage_key,
      state: state.state,
      active: state.active,
      duplicate_of: state.duplicate_of,
      superseded_by: state.superseded_by,
      stale_reason: state.stale_reason,
      generated_at: record.packet.generated_at,
      expires_at: record.packet.expires_at,
      projection_only: true,
      source_state_mutated: false,
      domain_authority_owned: false
    });
  }).sort((a,b) => a.lineage_key.localeCompare(b.lineage_key) || String(a.generated_at).localeCompare(String(b.generated_at)) || a.packet_id.localeCompare(b.packet_id)));

  return Object.freeze({
    lineage_version: DECISION_PROJECTION_LINEAGE_VERSION,
    company_id: companyId,
    generated_at: new Date(nowMs).toISOString(),
    total: projections.length,
    projections,
    lineages: Object.freeze(lineages),
    read_only: true,
    projection_only: true,
    source_state_mutated: false,
    domain_authority_owned: false
  });
}

export function projectionStateMap(reconciliation) {
  if (!isObject(reconciliation) || !Array.isArray(reconciliation.projections)) throw new Error("invalid_projection_reconciliation");
  return new Map(reconciliation.projections.map(item => [item.packet_id, item]));
}

async function getCurrentCompanyId() {
  const storage = await chrome.storage.local.get(["currentCompanyId"]);
  return storage.currentCompanyId || null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_DECISION_PACKET_RECONCILE_PROJECTIONS") return undefined;
    (async () => {
      try {
        const companyId = await getCurrentCompanyId();
        if (!companyId) throw new Error("company_context_required");
        const result = reconcileDecisionPacketProjections(message.items || [], companyId, message.now_ms ?? Date.now());
        sendResponse({success:true, data:result});
      } catch (error) {
        sendResponse({success:false, error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
