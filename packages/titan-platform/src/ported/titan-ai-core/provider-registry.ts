export type AIProviderLocality = "device" | "customer-hosted" | "byo-cloud" | "titan-managed";
export type AIProviderRegistration = Readonly<{
  id: string;
  locality: AIProviderLocality;
  company_id?: string | null;
  enabled?: boolean;
}>;

const ID=/^[a-z0-9][a-z0-9._-]{0,127}$/;
const LOCALITY=new Set<AIProviderLocality>(["device","customer-hosted","byo-cloud","titan-managed"]);

export class AIProviderRegistry {
  readonly #providers=new Map<string,AIProviderRegistration>();

  register(input: AIProviderRegistration) {
    const id=String(input.id??"").trim().toLowerCase();
    if(!ID.test(id)) throw new Error("Invalid AI provider id.");
    if(!LOCALITY.has(input.locality)) throw new Error("Invalid AI provider locality.");
    const company=input.company_id==null?null:String(input.company_id).trim();
    if(input.company_id!=null&&!company) throw new Error("company_id-required");
    const key=`${company??"*"}|${id}`;
    if(this.#providers.has(key)) throw new Error("AI provider already registered for company scope.");
    const stored=Object.freeze({id,locality:input.locality,company_id:company,enabled:input.enabled!==false});
    this.#providers.set(key,stored);
    return stored;
  }

  resolve(id: string, company_id?: string | null) {
    const providerId=String(id??"").trim().toLowerCase();
    const company=company_id==null?null:String(company_id).trim();
    if(company_id!=null&&!company) throw new Error("company_id-required");
    return (company?this.#providers.get(`${company}|${providerId}`):undefined) ?? this.#providers.get(`*|${providerId}`) ?? null;
  }

  route(company_id?: string | null) {
    const company=company_id==null?null:String(company_id).trim();
    if(company_id!=null&&!company) throw new Error("company_id-required");
    const visible=[...this.#providers.values()].filter(p=>p.enabled&&(p.company_id==null||(company!=null&&p.company_id===company)));
    const order:Record<AIProviderLocality,number>={"device":0,"customer-hosted":1,"byo-cloud":2,"titan-managed":3};
    return Object.freeze(visible.sort((a,b)=>order[a.locality]-order[b.locality]||a.id.localeCompare(b.id)));
  }
}

export const AI_PROVIDER_ROUTING_POLICY=Object.freeze({
  tenant_boundary:"company_id" as const,
  locality_order:Object.freeze(["device","customer-hosted","byo-cloud","titan-managed"] as const),
  activation_confers_authority:false as const,
  execution_authority:false as const,
});
