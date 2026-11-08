import type { ConnectorCredentialReference } from "./credential-contract.js";

export type ChannelKind = "instagram_dm" | "webhook" | "email" | "sms" | "accounting" | "commerce";
export interface ChannelBinding { company_id: string; binding_id: string; kind: ChannelKind; endpoint_ref: string; credential: ConnectorCredentialReference; capabilities: readonly string[]; webhook_provenance?: string; active: boolean; }

export function validateChannelBinding(binding: ChannelBinding, requestedCapability?: string): void {
  if (!binding.company_id || !binding.binding_id || !binding.endpoint_ref) throw new Error("channel identity and endpoint are required");
  if (binding.credential.company_id !== binding.company_id || binding.credential.secret_material_exposed) throw new Error("credential is not company-bound or contains secret material");
  if (!binding.active || binding.capabilities.length === 0) throw new Error("inactive or capability-less channel binding");
  if (requestedCapability && !binding.capabilities.includes(requestedCapability)) throw new Error("channel capability is not granted");
}

export function resolveWebhookCompany(bindings: readonly ChannelBinding[], endpointRef: string, provenance: string): string {
  const matches = bindings.filter((binding) => binding.active && binding.endpoint_ref === endpointRef && binding.webhook_provenance === provenance);
  if (matches.length !== 1) throw new Error("webhook endpoint resolution is ambiguous or unverified");
  return matches[0].company_id;
}

