/**
 * @deprecated Compatibility Titan Connect donor contract.
 * Canonical ownership is #432 MCP, bound to #7 capability identities.
 * Do not add new production semantics under ported/**; migrate consumers to
 * the canonical provider/MCP namespace and retain only compatibility exports.
 */
export type TitanMcpHostFeatures = Readonly<{
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  notifications?: boolean;
  streaming?: boolean;
  oauth?: boolean;
  write_operations?: boolean;
  embedded_ui?: boolean;
}>;

export type TitanMcpHostNegotiation = Readonly<{
  protocol_version: "2025-03-26";
  host_id: string;
  company_id: string;
  requested: TitanMcpHostFeatures;
  supported: TitanMcpHostFeatures;
  negotiated: TitanMcpHostFeatures;
  authority_neutral: true;
  grants_authority: false;
}>;

const ID=/^[a-z0-9][a-z0-9._-]{0,127}$/;

function id(value: unknown, field: string): string {
  const v=String(value??"").trim().toLowerCase();
  if(!ID.test(v)) throw new Error(`invalid-${field}`);
  return v;
}

function company(value: unknown): string {
  const v=String(value??"").trim();
  if(!v) throw new Error("company_id-required");
  return v;
}

export function negotiateTitanMcpHost(input: {
  host_id: string;
  company_id: string;
  requested?: TitanMcpHostFeatures;
  supported?: TitanMcpHostFeatures;
}): TitanMcpHostNegotiation {
  const host_id=id(input.host_id,"host-id");
  const company_id=company(input.company_id);
  const requested=input.requested??{};
  const supported=input.supported??{};
  const keys=["tools","resources","prompts","notifications","streaming","oauth","write_operations","embedded_ui"] as const;
  const negotiated=Object.fromEntries(keys.map(key=>[key,requested[key]===true&&supported[key]===true])) as TitanMcpHostFeatures;
  return Object.freeze({
    protocol_version:"2025-03-26",
    host_id,
    company_id,
    requested:Object.freeze({...requested}),
    supported:Object.freeze({...supported}),
    negotiated:Object.freeze(negotiated),
    authority_neutral:true,
    grants_authority:false,
  });
}

export const TITAN_MCP_HOST_CONTRACT=Object.freeze({
  schema:"titan.mcp.host-negotiation/v1",
  protocol_version:"2025-03-26",
  tenant_boundary:"company_id-logical",
  host_identity_grants_authority:false,
  negotiation_grants_authority:false,
  execution_authority:false,
});
