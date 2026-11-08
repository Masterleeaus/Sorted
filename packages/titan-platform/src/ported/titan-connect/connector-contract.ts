/**
 * @deprecated Compatibility Titan Connect donor contract.
 * Canonical ownership is #403 Provider/Connector SDK, bound to #7 capability identities.
 * Do not add new production semantics under ported/**; migrate consumers to
 * the canonical provider/MCP namespace and retain only compatibility exports.
 */
export type ConnectorCapability = Readonly<{
  id: string;
  operation: "read" | "write" | "execute";
  description?: string;
}>;

export type ConnectorPermission = Readonly<{
  capability_id: string;
  granted: boolean;
  scope?: string | null;
}>;

export type ConnectorHealth = Readonly<{
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  checked_at: number;
  detail?: string | null;
}>;

export type TitanConnectorDescriptor = Readonly<{
  id: string;
  company_id: string;
  provider: string;
  capabilities: readonly ConnectorCapability[];
  permissions: readonly ConnectorPermission[];
  health: ConnectorHealth;
  credential_ref?: string | null;
}>;

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function requireCompanyId(company_id: string): string {
  const value = String(company_id ?? "").trim();
  if (!value) throw new Error("company_id-required");
  return value;
}

function requireId(id: string, label: string): string {
  const value = String(id ?? "").trim().toLowerCase();
  if (!ID.test(value)) throw new Error(`invalid-${label}`);
  return value;
}

/**
 * Provider-neutral connector contract converged from Titan Connect/MCP masters.
 * It describes capability, permission and health; it is not an execution gateway.
 */
export function createTitanConnectorDescriptor(input: {
  id: string;
  company_id: string;
  provider: string;
  capabilities?: readonly ConnectorCapability[];
  permissions?: readonly ConnectorPermission[];
  health?: Partial<ConnectorHealth>;
  credential_ref?: string | null;
}): TitanConnectorDescriptor {
  const company_id = requireCompanyId(input.company_id);
  const id = requireId(input.id, "connector-id");
  const provider = requireId(input.provider, "provider-id");
  const checked_at = input.health?.checked_at ?? Date.now();
  if (!Number.isFinite(checked_at)) throw new Error("invalid-health-check");
  const capabilities = Object.freeze([...(input.capabilities ?? [])].map((capability) =>
    Object.freeze({
      id: requireId(capability.id, "capability-id"),
      operation: capability.operation,
      ...(capability.description == null ? {} : { description: String(capability.description) }),
    }),
  ));
  const permissions = Object.freeze([...(input.permissions ?? [])].map((permission) =>
    Object.freeze({
      capability_id: requireId(permission.capability_id, "permission-capability-id"),
      granted: permission.granted === true,
      ...(permission.scope == null ? {} : { scope: String(permission.scope) }),
    }),
  ));
  const health = Object.freeze({
    status: input.health?.status ?? "unknown",
    checked_at,
    ...(input.health?.detail == null ? {} : { detail: String(input.health.detail) }),
  });
  return Object.freeze({
    id,
    company_id,
    provider,
    capabilities,
    permissions,
    health,
    ...(input.credential_ref == null ? {} : { credential_ref: String(input.credential_ref) }),
  });
}

export const TITAN_CONNECTOR_CONTRACT = Object.freeze({
  schema: "titan.connect.typescript-contract/v1",
  tenant_boundary: "company_id-logical",
  capabilities_are_descriptive: true,
  permissions_are_descriptive: true,
  health_is_descriptive: true,
  registration_confers_authority: false,
  activation_confers_authority: false,
  execution_authority: false,
  credential_material_exposed: false,
});
