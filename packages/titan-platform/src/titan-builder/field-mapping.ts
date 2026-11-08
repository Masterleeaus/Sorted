import { builderDataSourceOptions } from "./binding-policy.js";
export type BuilderSurface="zero"|"go"|"hub";
export type BuilderFieldMap=Readonly<Record<string,string>>;
const SLOT_RULES:Array<[RegExp,readonly string[]]>=[
 [/invoice|quote|price|finance/, ["id","title","status","amount","currency","date"]],
 [/job|work-order|schedule|booking|agenda|timeline/, ["id","title","status","time","customer","location"]],
 [/customer|profile|contact/, ["id","title","subtitle","contact","address"]],
 [/task|checklist/, ["id","title","status","required","detail"]],
 [/service|product|inventory/, ["id","title","status","price","detail"]],
 [/approval/, ["id","title","status","summary","requested_at"]],
 [/metric|stat|chart|summary/, ["label","value","status","period"]],
];
export function builderFieldTargets(componentType:string):readonly string[]{return SLOT_RULES.find(([r])=>r.test(componentType))?.[1]??["id","title","subtitle","status","value"];}
export function suggestBuilderFieldMap(componentType:string,sourceFields:readonly string[]):BuilderFieldMap{const fields=new Set(sourceFields);const out:Record<string,string>={};const aliases:Record<string,readonly string[]>={title:["title","label","name","reference","number","service","display_name"],subtitle:["subtitle","summary","service_summary","site_summary","customer_summary"],time:["time","scheduled_at","starts_at","due_at","requested_at","date"],date:["date","due_at","starts_at","scheduled_at","requested_at"],customer:["customer","customer_summary","display_name"],location:["location","location_summary","site_summary","address_summary"],contact:["contact","contact_summary"],address:["address","address_summary","location_summary"],detail:["detail","summary","evidence_requirement","access_notes"],value:["value","amount","paid","invoiced","scheduled","capacity"],label:["label","name","period","reference"]};for(const target of builderFieldTargets(componentType)){const candidates=[target,...(aliases[target]??[])];const source=candidates.find(x=>fields.has(x));if(source)out[target]=source;}return out;}
export function validateBuilderFieldMap(surface:BuilderSurface,sourceId:string,map:BuilderFieldMap){const source=builderDataSourceOptions(surface).find(x=>x.id===sourceId);if(!source)throw new Error(`Builder data source is not compatible with ${surface}: ${sourceId}`);const allowed=new Set(source.fields);for(const [target,field] of Object.entries(map)){if(!builderFieldTargets("generic").includes(target)&&!SLOT_RULES.some(([,slots])=>slots.includes(target)))throw new Error(`Unknown Builder target field: ${target}`);if(field&&!allowed.has(field))throw new Error(`Field ${field} is not declared by ${sourceId}`);}return {source:sourceId,field_map:{...map},read_only:source.read_only,authority_granted:false as const};}
