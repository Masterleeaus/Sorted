import catalogJson from "./catalog.json" with { type: "json" };
type BuilderCatalogItem={collection:string;id:string;data:any};
const items=(catalogJson as any).items as BuilderCatalogItem[];
const getBuilderItem=(collection:string,id:string)=>items.find(x=>x.collection===collection&&x.id===id);

export type BuilderPropControl = Readonly<{ key:string; kind:"text"|"number"|"boolean"|"select"|"json"; label:string; options?:readonly string[] }>;
const booleanProps=new Set(["disabled","checked","required","multiple","open","loading","dismissible","sticky","showAvatar","remember"]);
const numberProps=/(count|value|progress|percent|amount|price|rating|size|limit|rows|columns|step|min|max|duration|readingTime)$/i;
const jsonProps=/(items|messages|suggestions|fields|paragraphs|actions|columns|groups|tasks|job|spec|options|series|data)$/i;
const selects:Record<string,readonly string[]>={tone:["neutral","info","success","warning","danger"],variant:["primary","secondary","ghost","outline","danger"],size:["sm","md","lg"],align:["start","center","end","between"],position:["top","bottom","left","right","center"],mode:["default","compact","expanded","login","register"]};
const label=(key:string)=>key.replace(/[_-]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
export function builderPropControls(type:string):BuilderPropControl[]{
 const item=getBuilderItem("components",type)??getBuilderItem("blocks",type); const props=Array.isArray((item?.data as any)?.props)?(item!.data as any).props as string[]:[];
 return props.map(key=>({key,label:label(key),...(selects[key]?{kind:"select" as const,options:selects[key]}:booleanProps.has(key)?{kind:"boolean" as const}:numberProps.test(key)?{kind:"number" as const}:jsonProps.test(key)?{kind:"json" as const}:{kind:"text" as const})}));
}
export function builderCatalogPolicy(type:string){
 const item:BuilderCatalogItem|undefined=getBuilderItem("components",type)??getBuilderItem("blocks",type); const d:any=item?.data??{};
 return {authority:String(d.authority??"presentation-only"),category:String(d.category??"General"),premium:Boolean(d.premium),allowed_actions:[...(d.allowed_actions??d.actions??[])] as string[],responsive:d.responsive!==false};
}
export function coerceBuilderProp(kind:BuilderPropControl["kind"],raw:string|boolean){if(kind==="boolean")return Boolean(raw);if(kind==="number")return raw===""?undefined:Number(raw);if(kind==="json"){try{return JSON.parse(String(raw))}catch{return raw}}return raw;}
