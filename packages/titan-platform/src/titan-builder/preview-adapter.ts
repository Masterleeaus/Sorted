import { builderDataSourceOptions } from "./binding-policy.js";
import type { BuilderSurface } from "./field-mapping.js";

export type BuilderRuntimePreviewEnvelope=Readonly<{
 company_id:string;
 surface:BuilderSurface;
 source:string;
 records:readonly Readonly<Record<string,unknown>>[];
 received_at?:string;
}>;
export type BuilderPreviewAdapterResult=Readonly<{
 records:readonly Readonly<Record<string,unknown>>[];
 mode:"runtime"|"synthetic";
 source:string;
 read_only:true;
 authority_granted:false;
 rejected_fields:readonly string[];
}>;
const denied=/(api[_-]?key|secret|password|token|credential|private[_-]?key|client[_-]?secret|authorization|cookie)/i;
const scalar=(v:unknown)=>v==null||["string","number","boolean"].includes(typeof v);

export function adaptBuilderRuntimePreview(input:{company_id:string;surface:BuilderSurface;source:string;runtime?:BuilderRuntimePreviewEnvelope}):BuilderPreviewAdapterResult|null{
 const source=builderDataSourceOptions(input.surface).find(x=>x.id===input.source);
 const runtime=input.runtime;
 if(!source||!runtime)return null;
 if(!input.company_id.trim()||runtime.company_id!==input.company_id||runtime.surface!==input.surface||runtime.source!==input.source)return null;
 const allowed=new Set(source.fields); const rejected=new Set<string>(); const rows:Record<string,unknown>[]=[];
 for(const candidate of runtime.records.slice(0,6)){
  if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))continue;
  const row:Record<string,unknown>={};
  for(const [key,value] of Object.entries(candidate)){
   if(denied.test(key)||!allowed.has(key)){rejected.add(key);continue;}
   if(scalar(value))row[key]=value;
  }
  rows.push(row);
 }
 if(!rows.length)return null;
 return {records:rows,mode:"runtime",source:input.source,read_only:true,authority_granted:false,rejected_fields:[...rejected].sort()};
}
