// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/cross-domain-relationship-graph.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { DECISION_PACKET_DOMAINS, DECISION_PACKET_FIELDS } from "./decision-packet.js";
import { stableCorrelationHash, canonicalCorrelationJson } from "./correlation-layer.js";

export const CROSS_DOMAIN_RELATIONSHIP_GRAPH_VERSION = "1.0.0";
export const CROSS_DOMAIN_RELATION_TYPES = Object.freeze([
  "materially_related",
  "materially_affects"
]);
export const CROSS_DOMAIN_ANCHOR_TYPES = Object.freeze([
  "finding", "action", "evidence", "recovery_candidate"
]);

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
  return packet;
}

function normalizeCorrelation(correlation, packet, expectedCompanyId) {
  if (correlation == null) return null;
  if (!isObject(correlation)) throw new Error("invalid_decision_correlation");
  if (requiredText(correlation.company_id, "correlation_company_id_required") !== expectedCompanyId) throw new Error("company_mismatch");
  if (requiredText(correlation.packet_id, "correlation_packet_id_required") !== packet.packet_id) throw new Error("correlation_packet_mismatch");
  if (requiredText(correlation.domain, "correlation_domain_required") !== packet.domain) throw new Error("correlation_domain_mismatch");
  if (correlation.projection_only !== true) throw new Error("correlation_must_be_projection_only");
  if (!Array.isArray(correlation.refs)) throw new Error("correlation_refs_array_required");
  return correlation;
}

function anchorKey(ref) {
  if (!isObject(ref)) return null;
  const type = typeof ref.type === "string" ? ref.type.trim().toLowerCase() : "";
  const id = typeof ref.id === "string" ? ref.id.trim() : "";
  if (!CROSS_DOMAIN_ANCHOR_TYPES.includes(type) || !id) return null;
  return `${type}\u001f${id}`;
}

function anchorProjection(ref) {
  return Object.freeze({type:ref.type, id:ref.id});
}

function nodeFromItem(packet, correlation, companyId) {
  const anchors = [];
  const seen = new Set();
  for (const ref of (correlation?.refs || [])) {
    const key = anchorKey(ref);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    anchors.push(anchorProjection(ref));
  }
  anchors.sort((a,b) => `${a.type}\u001f${a.id}`.localeCompare(`${b.type}\u001f${b.id}`));
  return Object.freeze({
    node_id: `drn_${stableCorrelationHash({company_id:companyId, packet_id:packet.packet_id})}`,
    company_id: companyId,
    packet_id: packet.packet_id,
    domain: packet.domain,
    source_provider: packet.source_provider,
    source_revision: clone(packet.source_revision),
    correlation_id: correlation == null ? null : requiredText(correlation.correlation_id, "correlation_id_required"),
    anchors: Object.freeze(anchors),
    generated_at: packet.generated_at,
    expires_at: packet.expires_at,
    projection_only: true,
    authority_owner: packet.source_provider
  });
}

function edgeId(material) {
  return `dre_${stableCorrelationHash(material)}`;
}

function inferredEdges(nodes) {
  const byAnchor = new Map();
  for (const node of nodes) {
    for (const anchor of node.anchors) {
      const key = `${anchor.type}\u001f${anchor.id}`;
      const bucket = byAnchor.get(key) || [];
      bucket.push(node);
      byAnchor.set(key, bucket);
    }
  }
  const pairMap = new Map();
  for (const [key, rawNodes] of byAnchor.entries()) {
    const bucket = [...rawNodes].sort((a,b)=>a.packet_id.localeCompare(b.packet_id));
    const [anchorType, anchorId] = key.split("\u001f");
    for (let i=0;i<bucket.length;i++) {
      for (let j=i+1;j<bucket.length;j++) {
        const a=bucket[i], b=bucket[j];
        if (a.domain === b.domain) continue;
        const pairKey=[a.packet_id,b.packet_id].sort().join("\u001f");
        const pair=pairMap.get(pairKey) || {a:a.packet_id < b.packet_id ? a : b, b:a.packet_id < b.packet_id ? b : a, anchors:[]};
        pair.anchors.push({type:anchorType,id:anchorId});
        pairMap.set(pairKey,pair);
      }
    }
  }
  const edges=[];
  for (const pair of [...pairMap.values()].sort((x,y)=>`${x.a.packet_id}\u001f${x.b.packet_id}`.localeCompare(`${y.a.packet_id}\u001f${y.b.packet_id}`))) {
    const basis=[...new Map(pair.anchors.map(x=>[`${x.type}\u001f${x.id}`,x])).values()].sort((a,b)=>`${a.type}\u001f${a.id}`.localeCompare(`${b.type}\u001f${b.id}`));
    const material={company_id:pair.a.company_id, relation_type:"materially_related", packet_ids:[pair.a.packet_id,pair.b.packet_id], basis};
    edges.push(Object.freeze({
      edge_id: edgeId(material),
      company_id: pair.a.company_id,
      relation_type: "materially_related",
      direction: "undirected",
      from_packet_id: pair.a.packet_id,
      from_domain: pair.a.domain,
      to_packet_id: pair.b.packet_id,
      to_domain: pair.b.domain,
      materiality_basis: Object.freeze(basis),
      explicit: false,
      projection_only: true,
      authority_transferred: false
    }));
  }
  return edges;
}

function normalizeExplicitRelationship(raw, nodeByPacket, companyId) {
  if (!isObject(raw)) throw new Error("invalid_explicit_relationship");
  if (raw.company_id != null && requiredText(raw.company_id,"relationship_company_id_required") !== companyId) throw new Error("company_mismatch");
  const fromPacketId=requiredText(raw.from_packet_id,"relationship_from_packet_id_required");
  const toPacketId=requiredText(raw.to_packet_id,"relationship_to_packet_id_required");
  if (fromPacketId === toPacketId) throw new Error("relationship_self_link_not_allowed");
  const from=nodeByPacket.get(fromPacketId), to=nodeByPacket.get(toPacketId);
  if (!from || !to) throw new Error("relationship_packet_not_found");
  if (from.domain === to.domain) throw new Error("relationship_must_be_cross_domain");
  const relationType=raw.relation_type == null ? "materially_affects" : requiredText(raw.relation_type,"relationship_type_required").toLowerCase();
  if (relationType !== "materially_affects") throw new Error("invalid_explicit_relationship_type");
  const reason=requiredText(raw.reason,"relationship_reason_required");
  const refs=Array.isArray(raw.evidence_refs) ? [...new Set(raw.evidence_refs.map(x=>requiredText(x,"relationship_evidence_ref_required")))].sort() : [];
  if (!refs.length) throw new Error("explicit_relationship_evidence_required");
  const knownAnchorIds=new Set([...from.anchors,...to.anchors].map(x=>x.id));
  if (!refs.some(id=>knownAnchorIds.has(id))) throw new Error("explicit_relationship_evidence_not_grounded");
  const basis=Object.freeze(refs.map(id=>({type:"explicit_evidence",id})));
  const material={company_id:companyId, relation_type:relationType, from_packet_id:fromPacketId,to_packet_id:toPacketId,reason,evidence_refs:refs};
  return Object.freeze({
    edge_id: edgeId(material),
    company_id: companyId,
    relation_type: relationType,
    direction: "directed",
    from_packet_id: fromPacketId,
    from_domain: from.domain,
    to_packet_id: toPacketId,
    to_domain: to.domain,
    materiality_basis: basis,
    reason,
    explicit: true,
    projection_only: true,
    authority_transferred: false
  });
}

/**
 * Builds an immutable cross-domain relationship projection from canonical DecisionPackets.
 * It does not infer authority, causal truth, source lifecycle state, or execution permission.
 */
export function buildCrossDomainRelationshipGraph(items, expectedCompanyId, options = {}, now = Date.now()) {
  const companyId=requiredText(expectedCompanyId,"expected_company_id_required");
  if (!Array.isArray(items)) throw new Error("relationship_graph_items_array_required");
  const currentMs=Number(now);
  if (!Number.isFinite(currentMs)) throw new Error("invalid_now");
  const nodeByPacket=new Map();
  for (const raw of items) {
    const item=isObject(raw) && own(raw,"packet") ? raw : {packet:raw,correlation:null};
    const packet=assertPacket(item.packet,companyId);
    const correlation=normalizeCorrelation(item.correlation,packet,companyId);
    if (nodeByPacket.has(packet.packet_id)) throw new Error("duplicate_packet_id");
    nodeByPacket.set(packet.packet_id,nodeFromItem(packet,correlation,companyId));
  }
  const nodes=Object.freeze([...nodeByPacket.values()].sort((a,b)=>a.packet_id.localeCompare(b.packet_id)));
  const auto=options.infer_shared_anchors === false ? [] : inferredEdges(nodes);
  const explicitRaw=options.explicit_relationships == null ? [] : options.explicit_relationships;
  if (!Array.isArray(explicitRaw)) throw new Error("explicit_relationships_array_required");
  const explicit=explicitRaw.map(raw=>normalizeExplicitRelationship(raw,nodeByPacket,companyId));
  const unique=new Map();
  for (const edge of [...auto,...explicit]) unique.set(edge.edge_id,edge);
  const edges=Object.freeze([...unique.values()].sort((a,b)=>a.edge_id.localeCompare(b.edge_id)));
  const adjacency={};
  for (const node of nodes) adjacency[node.packet_id]=[];
  for (const edge of edges) {
    adjacency[edge.from_packet_id].push(edge.edge_id);
    adjacency[edge.to_packet_id].push(edge.edge_id);
  }
  for (const key of Object.keys(adjacency)) adjacency[key]=Object.freeze(adjacency[key].sort());
  return Object.freeze({
    graph_version: CROSS_DOMAIN_RELATIONSHIP_GRAPH_VERSION,
    company_id: companyId,
    generated_at: new Date(currentMs).toISOString(),
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
    adjacency: Object.freeze(adjacency),
    projection_only: true,
    read_only: true,
    domain_authority_merged: false,
    execution_authority_owned: false
  });
}

export function relatedDecisionPackets(graph, packetId) {
  if (!isObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("invalid_relationship_graph");
  const id=requiredText(packetId,"packet_id_required");
  if (!graph.nodes.some(node=>node.packet_id===id)) throw new Error("relationship_packet_not_found");
  const result=[];
  for (const edge of graph.edges) {
    if (edge.from_packet_id===id) result.push({packet_id:edge.to_packet_id,domain:edge.to_domain,edge_id:edge.edge_id,relation_type:edge.relation_type});
    else if (edge.to_packet_id===id) result.push({packet_id:edge.from_packet_id,domain:edge.from_domain,edge_id:edge.edge_id,relation_type:edge.relation_type});
  }
  return result.sort((a,b)=>`${a.domain}\u001f${a.packet_id}\u001f${a.edge_id}`.localeCompare(`${b.domain}\u001f${b.packet_id}\u001f${b.edge_id}`));
}

async function getTrustedCompanyId() {
  const storage=await chrome.storage.local.get(["currentCompanyId"]);
  return storage.currentCompanyId || null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_CROSS_DOMAIN_RELATIONSHIP_GRAPH_BUILD") return undefined;
    (async()=>{
      try {
        const companyId=await getTrustedCompanyId();
        if (!companyId) throw new Error("company_context_required");
        const graph=buildCrossDomainRelationshipGraph(message.items || [],companyId,message.options || {},message.now_ms ?? Date.now());
        sendResponse({success:true,data:graph});
      } catch (error) {
        sendResponse({success:false,error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
