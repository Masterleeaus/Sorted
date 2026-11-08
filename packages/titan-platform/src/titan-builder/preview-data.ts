import { builderDataSourceOptions } from "./binding-policy.js";
import { adaptBuilderRuntimePreview, type BuilderRuntimePreviewEnvelope } from "./preview-adapter.js";
import { builderFieldTargets, type BuilderFieldMap, type BuilderSurface } from "./field-mapping.js";

type PreviewRecord=Readonly<Record<string,unknown>>;
const sample=(field:string,index:number):unknown=>{
 const f=field.toLowerCase();
 if(/(^id$|_id$)/.test(f))return `preview-${index+1}`;
 if(/status/.test(f))return ["Scheduled","In progress","Complete"][index%3];
 if(/scheduled|starts|due|requested|date|time/.test(f))return ["9:00 AM","11:30 AM","2:15 PM"][index%3];
 if(/amount|price|paid|invoiced|value|capacity/.test(f))return [185,320,96][index%3];
 if(/currency/.test(f))return "AUD";
 if(/customer|display_name|contact/.test(f))return ["Alex Morgan","Sam Lee","Taylor Chen"][index%3];
 if(/site|location|address/.test(f))return ["Northcote","Thornbury","Fitzroy"][index%3];
 if(/reference|number/.test(f))return `JOB-${String(index+41).padStart(4,"0")}`;
 if(/service|title|name|label/.test(f))return ["Regular clean","End-of-lease clean","Window clean"][index%3];
 if(/summary|detail|notes/.test(f))return ["Access confirmed","Customer requested front entry","Supplies on site"][index%3];
 if(/required/.test(f))return index%2===0;
 return `${field.replaceAll("_"," ")} ${index+1}`;
};
export function createBuilderPreviewRecords(surface:BuilderSurface,sourceId:string,count=3):readonly PreviewRecord[]{
 const source=builderDataSourceOptions(surface).find(x=>x.id===sourceId);
 if(!source)throw new Error(`Builder preview source is not compatible with ${surface}: ${sourceId}`);
 const safeCount=Math.max(1,Math.min(6,Math.floor(count)));
 return Array.from({length:safeCount},(_,i)=>Object.fromEntries(source.fields.map(field=>[field,sample(field,i)])));
}
export function mapBuilderPreviewRecord(componentType:string,record:PreviewRecord,map:BuilderFieldMap):PreviewRecord{
 const allowed=new Set(builderFieldTargets(componentType)); const out:Record<string,unknown>={};
 for(const [target,source] of Object.entries(map)){if(allowed.has(target)&&source in record)out[target]=record[source];}
 return out;
}
export function previewBuilderNodeProps(surface:BuilderSurface,componentType:string,props:Readonly<Record<string,unknown>>,context?:{company_id?:string;runtime?:BuilderRuntimePreviewEnvelope}):Readonly<Record<string,unknown>>{
 const binding=(props as any)?.data_binding; if(!binding?.source)return props; const source=String(binding.source);
 const runtime=context?.company_id?adaptBuilderRuntimePreview({company_id:context.company_id,surface,source,runtime:context.runtime}):null;
 const records=runtime?.records??createBuilderPreviewRecords(surface,source,3);
 const mapped=records.map(r=>mapBuilderPreviewRecord(componentType,r,binding.field_map??{}));
 const listLike=/list|timeline|agenda|kanban|schedule|job|inventory|service-grid|invoice-list/.test(componentType);
 const chartLike=/^chart-|stats-grid|metric/.test(componentType); const primary=mapped[0]??{};
 return {...props,...primary,...(listLike?{items:mapped}:{}),...(chartLike?{data:mapped}:{}),preview_data:{source,records:mapped,mode:runtime?.mode??"synthetic",synthetic:!runtime,read_only:true,authority_granted:false,rejected_fields:runtime?.rejected_fields??[]}};
}
