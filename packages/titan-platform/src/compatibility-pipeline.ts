export type CompatibilityManifest = {
  schema: "titan.compatibility-manifest.v1";
  core_version: string; registry_version: string; contract_version: string;
  generated_at: string; source_revision: string;
};
export type ProjectionCell = { foundation_product: string; vertical_profile: string; entitlement_profile: string; platform_adapter: string; contract_version: string };
export type CompatibilityNegotiation = { compatible: boolean; mode: "native" | "adapter" | "degraded" | "rejected"; reason: string; last_known_good_revision: string | null };

const required=(value:unknown,name:string)=>{const v=String(value??"").trim();if(!v)throw new Error(`${name}-required`);return v;};
export function createCompatibilityManifest(input: Omit<CompatibilityManifest,"schema"|"generated_at"> & { generated_at?: string }): CompatibilityManifest {
  const generated_at=input.generated_at??new Date().toISOString();
  if(!Number.isFinite(Date.parse(generated_at)))throw new Error("generated_at-invalid");
  return Object.freeze({schema:"titan.compatibility-manifest.v1",core_version:required(input.core_version,"core_version"),registry_version:required(input.registry_version,"registry_version"),contract_version:required(input.contract_version,"contract_version"),source_revision:required(input.source_revision,"source_revision"),generated_at});
}
export function affectedProjectionCells(changed:{foundation_products?:string[]; vertical_profiles?:string[]; entitlement_profiles?:string[]; platform_adapters?:string[]; contract_versions?:string[]}, matrix:ProjectionCell[]): ProjectionCell[] {
  const matches=(values?:string[],value?:string)=>!values?.length||values.includes(value??"");
  const dimensions: Array<[string[]|undefined,string]> = [[changed.foundation_products,"foundation_product"],[changed.vertical_profiles,"vertical_profile"],[changed.entitlement_profiles,"entitlement_profile"],[changed.platform_adapters,"platform_adapter"],[changed.contract_versions,"contract_version"]];
  return matrix.filter(cell=>dimensions.every(([values,key])=>!values?.length || values.includes(String(cell[key as keyof ProjectionCell]))));
}
export function negotiateCompatibility(input:{required_contract_version:string; supported_contract_versions:string[]; adapter_available?:boolean; degraded_allowed?:boolean; last_known_good_revision?:string|null}):CompatibilityNegotiation {
  const required_contract_version=required(input.required_contract_version,"required_contract_version");
  if(input.supported_contract_versions.includes(required_contract_version))return Object.freeze({compatible:true,mode:"native",reason:"contract-supported",last_known_good_revision:input.last_known_good_revision??null});
  if(input.adapter_available===true)return Object.freeze({compatible:true,mode:"adapter",reason:"explicit-adapter-available",last_known_good_revision:input.last_known_good_revision??null});
  if(input.degraded_allowed===true&&input.last_known_good_revision)return Object.freeze({compatible:true,mode:"degraded",reason:"last-known-compatible-projection",last_known_good_revision:input.last_known_good_revision});
  return Object.freeze({compatible:false,mode:"rejected",reason:"incompatible-contract",last_known_good_revision:input.last_known_good_revision??null});
}
export function assertRollbackRecovery(input:{published_revision:string; previous_known_good_revision:string|null; generated_revision:string; generation_succeeded:boolean}):{publishable:boolean; recovery_revision:string|null; reason:string} {
  required(input.published_revision,"published_revision"); required(input.generated_revision,"generated_revision");
  if(input.generation_succeeded)return Object.freeze({publishable:true,recovery_revision:null,reason:"generated-output-verified"});
  if(input.previous_known_good_revision)return Object.freeze({publishable:false,recovery_revision:input.previous_known_good_revision,reason:"retain-last-known-good"});
  return Object.freeze({publishable:false,recovery_revision:null,reason:"no-recoverable-projection"});
}
