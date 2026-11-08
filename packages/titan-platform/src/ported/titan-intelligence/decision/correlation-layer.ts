// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/decision/correlation-layer.js
export const DECISION_CORRELATION_VERSION = "1.0.0";
export const DECISION_CORRELATION_REF_TYPES = Object.freeze([
  "packet", "finding", "action", "evidence", "recovery_candidate", "source_revision"
]);

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const clone = value => value == null ? value : canonicalize(JSON.parse(JSON.stringify(value)));
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non_finite_number_not_allowed");
  return value;
}

export function canonicalCorrelationJson(value) {
  return JSON.stringify(canonicalize(value));
}

// Deterministic 64-bit FNV-1a. Used only for stable projection identity, never security/authority.
export function stableCorrelationHash(value) {
  const text = typeof value === "string" ? value : canonicalCorrelationJson(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeRef(ref, expectedCompanyId) {
  if (!isObject(ref)) throw new Error("invalid_correlation_ref");
  const companyId = requiredText(ref.company_id, "correlation_ref_company_id_required");
  if (companyId !== expectedCompanyId) throw new Error("company_mismatch");
  const type = requiredText(ref.type, "correlation_ref_type_required").toLowerCase();
  if (!DECISION_CORRELATION_REF_TYPES.includes(type)) throw new Error("invalid_correlation_ref_type");
  const id = requiredText(ref.id, "correlation_ref_id_required");
  const provider = requiredText(ref.source_provider, "correlation_ref_source_provider_required").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(provider)) throw new Error("invalid_source_provider");
  if (ref.source_revision == null) throw new Error("correlation_ref_source_revision_required");
  const sourceRevision = clone(ref.source_revision);
  return Object.freeze({
    type,
    id,
    company_id: companyId,
    source_provider: provider,
    source_revision: sourceRevision
  });
}

function refSortKey(ref) {
  return [ref.type, ref.id, ref.source_provider, canonicalCorrelationJson(ref.source_revision)].join("\u001f");
}

function dedupeAndSortRefs(refs, expectedCompanyId) {
  if (!Array.isArray(refs)) throw new Error("correlation_refs_array_required");
  const map = new Map();
  for (const raw of refs) {
    const ref = normalizeRef(raw, expectedCompanyId);
    map.set(refSortKey(ref), ref);
  }
  return Object.freeze([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref));
}

/**
 * Immutable read-model companion for DecisionPacket. It correlates authoritative source references;
 * it does not own, approve, execute, persist, mutate, supersede, resolve or recover source state.
 */
export function createDecisionPacketCorrelation(packet, refs, expectedCompanyId) {
  if (!isObject(packet)) throw new Error("invalid_decision_packet_request");
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  if (requiredText(packet.company_id, "company_id_required") !== companyId) throw new Error("company_mismatch");
  const packetId = requiredText(packet.packet_id, "packet_id_required");
  const domain = requiredText(packet.domain, "decision_domain_required").toLowerCase();
  if (!["money","trust","assurance","recovery"].includes(domain)) throw new Error("invalid_decision_domain");
  const provider = requiredText(packet.source_provider, "source_provider_required").toLowerCase();
  if (packet.source_revision == null) throw new Error("source_revision_required");

  const mandatory = [
    {type:"packet", id:packetId, company_id:companyId, source_provider:provider, source_revision:packet.source_revision},
    {type:"source_revision", id:stableCorrelationHash(packet.source_revision), company_id:companyId, source_provider:provider, source_revision:packet.source_revision}
  ];
  const normalizedRefs = dedupeAndSortRefs([...mandatory, ...(Array.isArray(refs) ? refs : [])], companyId);
  const anchors = normalizedRefs.filter(ref => ref.type !== "packet");
  if (!anchors.length) throw new Error("correlation_anchor_required");

  const identity = Object.freeze({
    company_id: companyId,
    domain,
    source_provider: provider,
    source_revision: clone(packet.source_revision),
    anchors: anchors.map(ref => ({type:ref.type,id:ref.id,source_provider:ref.source_provider,source_revision:clone(ref.source_revision)}))
  });
  const correlationId = `dpc_${stableCorrelationHash(identity)}`;

  return Object.freeze({
    correlation_id: correlationId,
    company_id: companyId,
    packet_id: packetId,
    domain,
    source_provider: provider,
    source_revision: clone(packet.source_revision),
    refs: normalizedRefs,
    projection_only: true,
    authority_owner: provider
  });
}

export function findCorrelationRefs(correlation, type) {
  if (!isObject(correlation) || !Array.isArray(correlation.refs)) throw new Error("invalid_decision_correlation");
  const normalizedType = requiredText(type, "correlation_ref_type_required").toLowerCase();
  if (!DECISION_CORRELATION_REF_TYPES.includes(normalizedType)) throw new Error("invalid_correlation_ref_type");
  return correlation.refs.filter(ref => ref.type === normalizedType).map(ref => clone(ref));
}
