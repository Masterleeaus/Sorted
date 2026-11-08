// Canonical TypeScript AI Core provider registry.
// Provider identity/registration never grants execution authority.

export type AiProviderLocality = "device" | "customer-hosted" | "byo-cloud" | "titan-managed";

export type AiProviderRegistration = Readonly<{
  id: string;
  locality: AiProviderLocality;
  company_id?: string | null;
  capabilities?: readonly string[];
  enabled?: boolean;
}>;

const ID=/^[a-z0-9][a-z0-9._-]{0,127}$/;
const LOCALITY=new Set<AiProviderLocality>(["device","customer-hosted","byo-cloud","titan-managed"]);

export class AiProviderRegistry {
  readonly #providers=new Map<string,AiProviderRegistration>();

  register(input: AiProviderRegistration) {
    if(!ID.test(input.id)) throw new Error("Invalid AI provider id.");
    if(!LOCALITY.has(input.locality)) throw new Error("Invalid AI provider locality.");
    if(Object.prototype.hasOwnProperty.call(input as object,'tenant_id') || Object.prototype.hasOwnProperty.call(input as object,'tenant_company_id')) throw new Error("legacy-tenant-authority-rejected");
    const company=input.company_id==null?null:String(input.company_id).trim();
    if(input.company_id!=null&&!company) throw new Error("company_id-required");
    const key=`${company??"*"}|${input.id}`;
    const provider=Object.freeze({
      ...input,
      company_id:company,
      capabilities:Object.freeze([...new Set(input.capabilities??[])].sort()),
      enabled:input.enabled!==false,
      authority_neutral:true as const,
      execution_authority:false as const,
    });
    const existing=this.#providers.get(key);
    if(existing && (existing.locality!==provider.locality || existing.company_id!==provider.company_id)) {
      throw new Error("AI provider registration conflict.");
    }
    this.#providers.set(key,provider);
    return provider;
  }

  list(company_id?:string|null) {
    const company=company_id==null?null:String(company_id).trim();
    if(company_id!=null&&!company) throw new Error("company_id-required");
    return Object.freeze([...this.#providers.values()]
      .filter(provider=>provider.enabled!==false && (provider.company_id==null || (company!=null && provider.company_id===company)))
      .sort((a,b)=>AI_CORE_PROVIDER_LOCALITY_ORDER.indexOf(a.locality)-AI_CORE_PROVIDER_LOCALITY_ORDER.indexOf(b.locality) || a.id.localeCompare(b.id)));
  }

  resolve(id:string, company_id?:string|null) {
    const company=company_id==null?null:String(company_id).trim();
    if(company_id!=null&&!company) throw new Error("company_id-required");
    const scoped=company?this.#providers.get(`${company}|${id}`):undefined;
    const global=this.#providers.get(`*|${id}`);
    const provider=scoped??global??null;
    return provider?.enabled===false?null:provider;
  }
}

export const AI_CORE_PROVIDER_LOCALITY_ORDER=Object.freeze([
  "device","customer-hosted","byo-cloud","titan-managed",
] as const);

export function resolvePreferredAiProvider(registry: AiProviderRegistry, capability:string, company_id?:string|null) {
  const required=String(capability??"").trim();
  if(!required) throw new Error("ai-capability-required");
  return registry.list(company_id).find(provider=>(provider.capabilities??[]).includes(required))??null;
}
