import { InterfaceContributionDiscovery, type ExtensionContributionSource } from "./interface-discovery.js";
import { normalizeSurface, type CanonicalProductSurface, type InterfaceContributionDescriptor } from "./interface-registry.js";

export type SemanticCatalogItem=Readonly<{key:string;extension_key:string;kind:"domain"|"object"|"facet"|"view"|"action";descriptor:Readonly<Record<string,unknown>>}>;
export type InterfaceCatalogSnapshot=Readonly<{
 surface:CanonicalProductSurface;
 contributions:readonly string[];
 items:readonly SemanticCatalogItem[];
 collisions:Readonly<Record<string,readonly string[]>>;
 health:Readonly<Record<string,unknown>>;
}>;

const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const strings=(v:unknown):string[]=>Array.isArray(v)?v.map(String):[];
const sections=["domains","objects","facets","views","actions"] as const;

export function buildInterfaceCatalog(contributions:readonly InterfaceContributionDescriptor[],surface:string):InterfaceCatalogSnapshot{
 const canonical=normalizeSurface(surface), candidates=new Map<string,SemanticCatalogItem[]>(), health:Record<string,unknown>={};
 for(const c of [...contributions].sort((a,b)=>a.extension_key.localeCompare(b.extension_key))){
   for(const section of sections){
     for(const raw of c[section]){
       const d=record(raw), key=String(d.key??"");
       const visible=strings(d.product_surfaces).map(normalizeSurface);
       if(visible.length&&!visible.includes(canonical))continue;
       if(canonical==="hub"&&d.customer_safe!==true)continue;
       const id=`${section.slice(0,-1)}:${key}`;
       const item={key,extension_key:c.extension_key,kind:section.slice(0,-1) as SemanticCatalogItem["kind"],descriptor:Object.freeze({...d,product_surfaces:visible})};
       const list=candidates.get(id)??[];list.push(item);candidates.set(id,list);
     }
   }
 }
 const items:SemanticCatalogItem[]=[], collisions:Record<string,string[]>={};
 for(const[id,list]of[...candidates.entries()].sort(([a],[b])=>a.localeCompare(b))){
   if(list.length===1)items.push(list[0]);
   else collisions[id]=[...new Set(list.map(x=>x.extension_key))].sort();
 }
 return{surface:canonical,contributions:[...new Set(contributions.map(x=>x.extension_key))].sort(),items,collisions,health};
}

export type PresentationCatalogNode=Readonly<{type:"semantic";semantic_kind:SemanticCatalogItem["kind"];semantic_key:string;owner:string;props:Readonly<Record<string,unknown>>}>;
export type PresentationCatalogTree=Readonly<{schema:"titan.presentation-catalog.v1";company_id:string;surface:CanonicalProductSurface;authority:"presentation-only";nodes:readonly PresentationCatalogNode[]}>;
export function composeCatalogPresentation(companyId:string,catalog:InterfaceCatalogSnapshot):PresentationCatalogTree{
 if(!companyId.trim())throw new Error("company_id is required");
 return Object.freeze({schema:"titan.presentation-catalog.v1",company_id:companyId,surface:catalog.surface,authority:"presentation-only",nodes:catalog.items.map(i=>Object.freeze({type:"semantic",semantic_kind:i.kind,semantic_key:i.key,owner:i.extension_key,props:i.descriptor}))});
}

export class InterfaceRuntimePipeline{
 readonly discovery=new InterfaceContributionDiscovery();
 run(companyId:string,surface:string,sources:readonly ExtensionContributionSource[],force=false){
   const discovered=this.discovery.discover(sources,force);
   const catalog=buildInterfaceCatalog(discovered.contributions.map(x=>x.descriptor),surface);
   return Object.freeze({discovery:discovered,catalog,presentation:composeCatalogPresentation(companyId,catalog)});
 }
}
