export interface FederationOffer { relationship_id: string; sender_node_id: string; receiver_node_id: string; company_id: string; purpose: string; scope: readonly string[]; constitution_version: string; authority_ceiling: number; privacy_egress_approved: boolean; cost_budget_cents?: number; expires_at: string; revoked_at?: string; }
export type FederationDecision = { allowed: true; relationship_id: string } | { allowed: false; reason: string };
export function validateFederationOffer(offer: FederationOffer, now = new Date()): FederationDecision {
  if (!offer.relationship_id || !offer.sender_node_id || !offer.receiver_node_id || offer.sender_node_id === offer.receiver_node_id) return { allowed: false, reason: "sovereign node identities are required and must differ" };
  if (!offer.company_id || !offer.purpose || offer.scope.length === 0) return { allowed: false, reason: "company, purpose, and scope are required" };
  if (!offer.constitution_version || offer.authority_ceiling < 0) return { allowed: false, reason: "compatible Constitution and authority ceiling are required" };
  if (!offer.privacy_egress_approved) return { allowed: false, reason: "privacy/egress approval is required" };
  if (offer.revoked_at || Number.isNaN(Date.parse(offer.expires_at)) || now.getTime() >= Date.parse(offer.expires_at)) return { allowed: false, reason: "federation offer is revoked or expired" };
  return { allowed: true, relationship_id: offer.relationship_id };
}

