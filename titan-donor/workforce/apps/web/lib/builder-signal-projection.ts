import { portableQuery } from "@/lib/db/portable";
import { projectTitanSignalsForBuilder, type BuilderSignalProjectionProvider, type TitanSignalProjectionEnvelope } from "@titan-zero/titan-platform/titan-builder";

type Row=Record<string,unknown>;
const jsonObject=(value:unknown):Record<string,unknown>=>{if(value&&typeof value==="object"&&!Array.isArray(value))return value as Record<string,unknown>;if(typeof value==="string"){try{const x=JSON.parse(value);return x&&typeof x==="object"&&!Array.isArray(x)?x:{};}catch{return {};}}return {};};
/** Server-only immutable Signal Engine read projection. */
export const serverBuilderSignalProvider:BuilderSignalProjectionProvider=async request=>{
  const limit=Math.min(50,Math.max(1,request.limit??24));
  const rows=await portableQuery<Row>(`SELECT event_id, event_type, company_id, scope, occurred_at, severity, source, category, payload, metadata
    FROM titan_signal_events WHERE company_id=$1 AND scope='tenant' ORDER BY occurred_at DESC LIMIT ${limit}`,[request.company_id]);
  return rows.map(row=>({event_id:String(row.event_id??""),event_type:String(row.event_type??""),company_id:String(row.company_id??""),scope:"tenant",occurred_at:new Date(String(row.occurred_at??"")).toISOString(),severity:String(row.severity??"info"),source:row.source==null?undefined:String(row.source),category:row.category==null?undefined:String(row.category),payload:jsonObject(row.payload),metadata:jsonObject(row.metadata)} satisfies TitanSignalProjectionEnvelope));
};
export function loadBuilderSignalPriority(company_id:string,surface:"zero"|"go"|"hub") {return projectTitanSignalsForBuilder({company_id,surface,limit:24},serverBuilderSignalProvider);}
