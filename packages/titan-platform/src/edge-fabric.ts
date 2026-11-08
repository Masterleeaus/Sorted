export type EdgeNode = {
  company_id: string; node_id: string; locality: "cloud" | "edge" | "device";
  capabilities: readonly string[]; healthy: boolean; revoked?: boolean; load: number;
  last_seen: string;
};

export type EdgeLease = {
  schema: "titan.edge.lease.v1"; company_id: string; work_id: string; node_id: string;
  lease_id: string; issued_at: string; expires_at: string; authority_revision: string;
};

export type EdgeReconnectResult = {
  accepted: boolean; reason: "accepted" | "company-mismatch" | "node-revoked" | "lease-expired" | "authority-revalidation-required";
  replay_allowed: false; authority_revalidation_required: boolean;
};

const required = (value: unknown, name: string): string => {
  const v = String(value ?? "").trim();
  if (!v) throw new Error(`${name}-required`);
  return v;
};

export function enrollEdgeNode(node: EdgeNode): EdgeNode {
  const company_id = required(node.company_id, "company_id");
  const node_id = required(node.node_id, "node_id");
  if (!Array.isArray(node.capabilities) || node.capabilities.length === 0) throw new Error("node-capabilities-required");
  if (!Number.isFinite(node.load) || node.load < 0 || node.load > 1) throw new Error("node-load-invalid");
  if (!Number.isFinite(Date.parse(node.last_seen))) throw new Error("node-last-seen-invalid");
  return Object.freeze({ ...node, company_id, node_id, capabilities: Object.freeze([...new Set(node.capabilities.map((v) => required(v, "capability")))]) });
}

export function selectEdgeNode(nodes: EdgeNode[], request: { company_id: string; capability: string; locality?: EdgeNode["locality"] }): EdgeNode {
  const company_id = required(request.company_id, "company_id");
  const capability = required(request.capability, "capability");
  const eligible = nodes.filter((node) => node.company_id === company_id && node.healthy && !node.revoked && node.capabilities.includes(capability));
  if (!eligible.length) throw new Error("no-authorized-edge-node");
  const localityRank = (node: EdgeNode) => request.locality === node.locality ? 0 : node.locality === "edge" ? 1 : 2;
  return [...eligible].sort((a, b) => localityRank(a) - localityRank(b) || a.load - b.load || a.node_id.localeCompare(b.node_id))[0];
}

export function issueEdgeLease(node: EdgeNode, input: { work_id: string; lease_id: string; authority_revision: string; now: string; ttl_ms: number }): EdgeLease {
  if (node.revoked || !node.healthy) throw new Error("node-unavailable");
  const company_id = required(node.company_id, "company_id");
  const work_id = required(input.work_id, "work_id");
  const lease_id = required(input.lease_id, "lease_id");
  const authority_revision = required(input.authority_revision, "authority_revision");
  const issued = Date.parse(input.now);
  if (!Number.isFinite(issued) || !Number.isFinite(input.ttl_ms) || input.ttl_ms <= 0) throw new Error("lease-window-invalid");
  return Object.freeze({ schema: "titan.edge.lease.v1", company_id, work_id, node_id: node.node_id, lease_id, authority_revision, issued_at: new Date(issued).toISOString(), expires_at: new Date(issued + input.ttl_ms).toISOString() });
}

export function revalidateEdgeReconnect(lease: EdgeLease, input: { company_id: string; node: EdgeNode; now: string; authority_revision: string }): EdgeReconnectResult {
  if (lease.company_id !== input.company_id || input.node.company_id !== input.company_id) return { accepted: false, reason: "company-mismatch", replay_allowed: false, authority_revalidation_required: true };
  if (input.node.revoked || !input.node.healthy) return { accepted: false, reason: "node-revoked", replay_allowed: false, authority_revalidation_required: true };
  if (!Number.isFinite(Date.parse(input.now)) || Date.parse(input.now) >= Date.parse(lease.expires_at)) return { accepted: false, reason: "lease-expired", replay_allowed: false, authority_revalidation_required: true };
  if (lease.authority_revision !== input.authority_revision) return { accepted: false, reason: "authority-revalidation-required", replay_allowed: false, authority_revalidation_required: true };
  return { accepted: true, reason: "accepted", replay_allowed: false, authority_revalidation_required: true };
}
