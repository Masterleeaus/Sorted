// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/unified-decision-feed.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import {
  DECISION_PACKET_DOMAINS,
  DECISION_PACKET_FIELDS,
  decisionPacketExpiryState
} from "./decision-packet.js";
import { stableCorrelationHash, canonicalCorrelationJson } from "./correlation-layer.js";
import { reconcileDecisionPacketProjections, projectionStateMap } from "./packet-dedup-supersession.js";
import { explainDecisionPacket } from "./decision-explanation-engine.js";
import { projectRecommendedActions } from "./recommended-action.js";
import { buildCrossDomainRelationshipGraph } from "./cross-domain-relationship-graph.js";
import { buildRewindableDecisionHistory } from "./rewindable-decision-history.js";
import { FEED_SOURCE_ROLES, feedSourceOwnership } from "../../titan-runtime/feed/feed-source-ownership.js";
import { normalizeFeedSeverity, feedSeverityProfile } from "../../titan-runtime/feed/feed-severity.js";

export const UNIFIED_DECISION_FEED_VERSION = "1.6.1";
export const DECISION_FEED_SOURCE_OWNERSHIP = feedSourceOwnership(FEED_SOURCE_ROLES.DECISION_FEED);
export const DECISION_FEED_SORT_KEYS = Object.freeze([
  "risk", "urgency", "significance", "authority_required", "generated_at", "domain", "packet_id"
]);
export const DECISION_FEED_DIRECTIONS = Object.freeze(["asc", "desc"]);

const LEVEL_RANK = Object.freeze({
  unknown: 0,
  none: 1,
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  immediate: 5,
  critical: 5
});

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const requiredText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};

function canonicalLevel(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return own(LEVEL_RANK, normalized) ? normalized : "unknown";
}

function packetLevel(value) {
  if (isObject(value)) return canonicalLevel(value.level);
  return canonicalLevel(value);
}

function significanceLevel(value) {
  if (typeof value === "string") return canonicalLevel(value);
  if (!isObject(value)) return "unknown";
  for (const key of ["level", "severity", "priority", "urgency", "risk"]) {
    if (own(value, key)) {
      const level = canonicalLevel(value[key]);
      if (level !== "unknown") return level;
    }
  }
  return "unknown";
}

function assertPacketShape(packet, expectedCompanyId) {
  if (!isObject(packet)) throw new Error("invalid_decision_packet_request");
  const keys = Object.keys(packet);
  const missing = DECISION_PACKET_FIELDS.filter(key => !own(packet, key));
  if (missing.length) throw new Error("missing_decision_packet_fields");
  const extra = keys.filter(key => !DECISION_PACKET_FIELDS.includes(key));
  if (extra.length) throw new Error("unexpected_decision_packet_fields");
  const companyId = requiredText(packet.company_id, "company_id_required");
  if (companyId !== expectedCompanyId) throw new Error("company_mismatch");
  if (!DECISION_PACKET_DOMAINS.includes(packet.domain)) throw new Error("invalid_decision_domain");
  requiredText(packet.packet_id, "packet_id_required");
  requiredText(packet.source_provider, "source_provider_required");
  if (packet.source_revision == null) throw new Error("source_revision_required");
  return packet;
}

function normalizeCorrelation(correlation, packet, expectedCompanyId) {
  if (correlation == null) return null;
  if (!isObject(correlation)) throw new Error("invalid_decision_correlation");
  if (requiredText(correlation.company_id, "correlation_company_id_required") !== expectedCompanyId) throw new Error("company_mismatch");
  if (requiredText(correlation.packet_id, "correlation_packet_id_required") !== packet.packet_id) throw new Error("correlation_packet_mismatch");
  if (requiredText(correlation.domain, "correlation_domain_required") !== packet.domain) throw new Error("correlation_domain_mismatch");
  if (correlation.projection_only !== true) throw new Error("correlation_must_be_projection_only");
  return clone(correlation);
}

export function decisionFeedSortMetadata(packet) {
  if (!isObject(packet)) throw new Error("invalid_decision_packet_request");
  const riskLevel = packetLevel(packet.risk);
  const urgencyLevel = packetLevel(packet.urgency);
  const significance = significanceLevel(packet.significance);
  const riskSeverity = feedSeverityProfile(normalizeFeedSeverity(riskLevel));
  const urgencySeverity = feedSeverityProfile(normalizeFeedSeverity(urgencyLevel));
  const significanceSeverity = feedSeverityProfile(normalizeFeedSeverity(significance));
  return Object.freeze({
    risk_level: riskLevel,
    risk_severity: riskSeverity.severity,
    risk_rank: riskSeverity.rank,
    urgency_level: urgencyLevel,
    urgency_severity: urgencySeverity.severity,
    urgency_rank: urgencySeverity.rank,
    significance_level: significance,
    significance_severity: significanceSeverity.severity,
    significance_rank: significanceSeverity.rank,
    significance_key: canonicalCorrelationJson(packet.significance),
    authority_required: packet.authority_required === true,
    generated_at_ms: Date.parse(packet.generated_at),
    domain: packet.domain,
    packet_id: packet.packet_id
  });
}

function comparePrimitive(a, b) {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function comparatorFor(sortKey, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  return (a, b) => {
    let av;
    let bv;
    switch (sortKey) {
      case "risk": av = a.sort.risk_rank; bv = b.sort.risk_rank; break;
      case "urgency": av = a.sort.urgency_rank; bv = b.sort.urgency_rank; break;
      case "significance":
        av = a.sort.significance_rank;
        bv = b.sort.significance_rank;
        if (av === bv) {
          const lexical = comparePrimitive(a.sort.significance_key, b.sort.significance_key);
          if (lexical !== 0) return lexical * multiplier;
        }
        break;
      case "authority_required": av = a.sort.authority_required; bv = b.sort.authority_required; break;
      case "generated_at": av = a.sort.generated_at_ms; bv = b.sort.generated_at_ms; break;
      case "domain": av = a.sort.domain; bv = b.sort.domain; break;
      case "packet_id": av = a.sort.packet_id; bv = b.sort.packet_id; break;
      default: throw new Error("invalid_feed_sort_key");
    }
    const primary = comparePrimitive(av, bv);
    return primary * multiplier;
  };
}

function normalizeSort(sort) {
  if (sort == null) return Object.freeze([
    {key:"authority_required", direction:"desc"},
    {key:"risk", direction:"desc"},
    {key:"urgency", direction:"desc"},
    {key:"significance", direction:"desc"},
    {key:"generated_at", direction:"desc"}
  ]);
  const raw = Array.isArray(sort) ? sort : [sort];
  if (!raw.length) throw new Error("feed_sort_required");
  return Object.freeze(raw.map(rule => {
    if (!isObject(rule)) throw new Error("invalid_feed_sort_rule");
    const key = requiredText(rule.key, "feed_sort_key_required");
    const direction = requiredText(rule.direction || "desc", "feed_sort_direction_required").toLowerCase();
    if (!DECISION_FEED_SORT_KEYS.includes(key)) throw new Error("invalid_feed_sort_key");
    if (!DECISION_FEED_DIRECTIONS.includes(direction)) throw new Error("invalid_feed_sort_direction");
    return Object.freeze({key, direction});
  }));
}

function applySort(entries, rules) {
  return [...entries].sort((a, b) => {
    for (const rule of rules) {
      const result = comparatorFor(rule.key, rule.direction)(a, b);
      if (result !== 0) return result;
    }
    return a.entry_id.localeCompare(b.entry_id);
  });
}

/**
 * Build a deterministic read-only projection across all DecisionPacket domains.
 * The feed owns no packet/domain lifecycle state and exposes no mutation surface.
 */
export function buildUnifiedDecisionFeed(items, expectedCompanyId, options = {}, now = Date.now()) {
  const companyId = requiredText(expectedCompanyId, "expected_company_id_required");
  if (!Array.isArray(items)) throw new Error("decision_feed_items_array_required");
  const currentMs = Number(now);
  if (!Number.isFinite(currentMs)) throw new Error("invalid_now");
  const includeExpired = options.include_expired === true;
  const domains = options.domains == null ? DECISION_PACKET_DOMAINS : options.domains;
  if (!Array.isArray(domains) || domains.some(domain => !DECISION_PACKET_DOMAINS.includes(domain))) throw new Error("invalid_feed_domains");
  const domainSet = new Set(domains);
  const sort = normalizeSort(options.sort);

  // Reconcile projection history before building the view. This is read-only metadata;
  // source/domain lifecycle state is never changed by the feed.
  const scopedItems = [];
  for (const raw of items) {
    const item = isObject(raw) && own(raw, "packet") ? raw : {packet:raw};
    const packet = assertPacketShape(item.packet, companyId);
    if (!domainSet.has(packet.domain)) continue;
    const correlation = normalizeCorrelation(item.correlation, packet, companyId);
    scopedItems.push({packet, correlation});
  }
  const reconciliation = reconcileDecisionPacketProjections(scopedItems, companyId, currentMs);
  const stateByPacket = projectionStateMap(reconciliation);
  const includeObsolete = options.include_obsolete === true;

  const entries = [];
  for (const item of scopedItems) {
    const packet = item.packet;
    const projectionState = stateByPacket.get(packet.packet_id);
    if (!projectionState) throw new Error("projection_state_missing");
    if (!includeObsolete && projectionState.state !== "active") continue;
    const expiry = decisionPacketExpiryState(packet, currentMs);
    if (expiry.expired && !includeExpired) continue;
    const sortMetadata = decisionFeedSortMetadata(packet);
    if (!Number.isFinite(sortMetadata.generated_at_ms)) throw new Error("invalid_generated_at");
    const entryId = `dfe_${stableCorrelationHash({company_id:companyId,packet_id:packet.packet_id,source_provider:packet.source_provider,source_revision:packet.source_revision})}`;

    entries.push(Object.freeze({
      entry_id: entryId,
      company_id: companyId,
      packet: clone(packet),
      correlation: clone(item.correlation),
      projection_state: clone(projectionState),
      decision_explanation: explainDecisionPacket(packet, companyId, {correlation:item.correlation, projection_state:projectionState}, currentMs),
      recommended_actions: projectRecommendedActions(packet, companyId, {correlation:item.correlation, authority_context:options.authority_context || {}}, currentMs),
      sort: sortMetadata,
      expiry,
      projection_only: true
    }));
  }

  const ordered = Object.freeze(applySort(entries, sort));
  const relationshipGraph = buildCrossDomainRelationshipGraph(scopedItems, companyId, options.relationship_graph || {}, currentMs);
  const decisionHistory = buildRewindableDecisionHistory(scopedItems, companyId, options.decision_history || {}, currentMs);
  return Object.freeze({
    feed_version: UNIFIED_DECISION_FEED_VERSION,
    company_id: companyId,
    domains: Object.freeze([...domains]),
    sort,
    generated_at: new Date(currentMs).toISOString(),
    total: ordered.length,
    entries: ordered,
    projection_lineages: reconciliation.lineages,
    projection_history_total: reconciliation.total,
    obsolete_included: includeObsolete,
    relationship_graph: relationshipGraph,
    decision_history: decisionHistory,
    read_only: true,
    projection_only: true
  });
}

async function getTrustedFeedContext() {
  const storage = await chrome.storage.local.get(["currentCompanyId", "decisionAuthorityPolicy", "decisionActorContext"]);
  return {
    company_id: storage.currentCompanyId || null,
    company_policy: storage.decisionAuthorityPolicy || null,
    actor_context: storage.decisionActorContext || null
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_UNIFIED_DECISION_FEED_BUILD") return undefined;
    (async () => {
      try {
        const trusted = await getTrustedFeedContext();
        const expectedCompanyId = trusted.company_id;
        if (!expectedCompanyId) throw new Error("company_context_required");
        const options = {...(message.options || {}), authority_context:{company_policy:trusted.company_policy, actor_context:trusted.actor_context}};
        const feed = buildUnifiedDecisionFeed(message.items || [], expectedCompanyId, options, message.now_ms ?? Date.now());
        sendResponse({success:true, data:feed});
      } catch (error) {
        sendResponse({success:false,error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
