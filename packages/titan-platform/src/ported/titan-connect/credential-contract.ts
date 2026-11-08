/**
 * @deprecated Compatibility Titan Connect donor contract.
 * Canonical ownership is #403 Provider/Connector SDK, bound to #7 capability identities.
 * Do not add new production semantics under ported/**; migrate consumers to
 * the canonical provider/MCP namespace and retain only compatibility exports.
 */
export type ConnectorCredentialReference = Readonly<{
  company_id: string;
  credential_ref: string;
  provider: string;
  secret_material_exposed: false;
}>;

export function createConnectorCredentialReference(input: {
  company_id: string;
  credential_ref: string;
  provider: string;
}): ConnectorCredentialReference {
  const company_id=String(input.company_id??"").trim();
  const credential_ref=String(input.credential_ref??"").trim();
  const provider=String(input.provider??"").trim().toLowerCase();
  if(!company_id) throw new Error("company_id-required");
  if(!credential_ref) throw new Error("credential_ref-required");
  if(!provider) throw new Error("provider-required");
  if(/[\r\n]/.test(credential_ref)) throw new Error("invalid-credential-ref");
  return Object.freeze({company_id,credential_ref,provider,secret_material_exposed:false});
}

export const CONNECTOR_CREDENTIAL_POLICY=Object.freeze({
  schema:"titan.connect.credential-reference/v1",
  tenant_boundary:"company_id-logical",
  material_never_in_contract:true,
  secret_redaction_required:true,
  authority_neutral:true,
  execution_authority:false,
});
