export type CanonicalProductSurface="zero"|"go"|"hub"|"onboarding";
export type InterfaceContributionDescriptor=Readonly<{
 schema_version:"1.0"|"1.1"; extension_key:string; context?:Readonly<Record<string,unknown>>;
 domains:readonly Record<string,unknown>[]; objects:readonly Record<string,unknown>[]; facets:readonly Record<string,unknown>[];
 views:readonly Record<string,unknown>[]; actions:readonly Record<string,unknown>[]; relationships?:readonly Record<string,unknown>[];
 lifecycles?:readonly Record<string,unknown>[]; global_work?:readonly Record<string,unknown>[];
 providers?:Readonly<{attention?:readonly Record<string,unknown>[];decisions?:readonly Record<string,unknown>[];insights?:readonly Record<string,unknown>[]}>;
 legacy_data_surfaces?:readonly Record<string,unknown>[];
}>;
const EXT=/^[a-z0-9]+(?:-[a-z0-9]+)*$/; const KEY=/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const rec=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const strings=(v:unknown)=>Array.isArray(v)?v.map(String):[];
export const normalizeSurface=(v:unknown):CanonicalProductSurface=>{const s=String(v);if(["command","bos","owner","manager","business"].includes(s))return"zero";if(["field","worker"].includes(s))return"go";if(s==="customer")return"hub";if(["zero","go","hub","onboarding"].includes(s))return s as CanonicalProductSurface;throw new Error(`unsupported product surface: ${s}`)};
export function normalizeInterfaceContribution(raw:InterfaceContributionDescriptor):InterfaceContributionDescriptor{
 if(!EXT.test(raw.extension_key))throw new Error("invalid extension_key");
 const map=(xs:readonly Record<string,unknown>[]|undefined):Record<string,unknown>[] =>(xs??[]).map(x=>({...x,product_surfaces:strings(x.product_surfaces).map(normalizeSurface)}));
 const objects=map(raw.objects).map(x=>{const scope=rec(x.scope);if(scope.type==="tenant"&&scope.tenant_key!=="company_id")throw new Error(`object ${String(x.key)} tenant scope must use company_id`);if("tenant_id"in scope||"tenant_company_id"in scope)throw new Error("legacy tenant authority rejected");if(!KEY.test(String(x.key??"")))throw new Error("invalid object key");return{...x,scope}});
 return{...raw,domains:map(raw.domains),objects,facets:map(raw.facets),views:map(raw.views),actions:map(raw.actions),global_work:map(raw.global_work)};
}
export class DeterministicContributionRegistry{#items=new Map<string,InterfaceContributionDescriptor>();register(raw:InterfaceContributionDescriptor){const x=normalizeInterfaceContribution(raw);if(this.#items.has(x.extension_key))throw new Error(`duplicate interface contribution key: ${x.extension_key}`);this.#items.set(x.extension_key,x)}clear(){this.#items.clear()}all(){return[...this.#items.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v)}}
