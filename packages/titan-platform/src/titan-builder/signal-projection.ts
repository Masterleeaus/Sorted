import type { BuilderSemanticIntent } from "./intent-planner.js";
import type { BuilderPresentationSignal, BuilderSignalPriorityContext, BuilderSignalSeverity } from "./signal-priority.js";

type BuilderSurface="zero"|"go"|"hub";
export type TitanSignalProjectionEnvelope=Readonly<{
  event_id:string; event_type:string; company_id:string; scope:"tenant"; occurred_at:string;
  severity:string; source?:string; category?:string; payload?:Readonly<Record<string,unknown>>; metadata?:Readonly<Record<string,unknown>>;
}>;
export type BuilderSignalProjectionRequest=Readonly<{company_id:string;surface:BuilderSurface;limit?:number}>;
export type BuilderSignalProjectionProvider=(request:BuilderSignalProjectionRequest)=>Promise<readonly TitanSignalProjectionEnvelope[]>;

const INTENTS:ReadonlyArray<readonly [BuilderSemanticIntent,RegExp]>=Object.freeze([
  ["approvals",/approv|decision|review|authori[sz]/i],["invoices",/invoice|receivable|overdue|billing/i],
  ["finance",/finance|revenue|cash|payment|money/i],["schedule",/schedule|booking|capacity|availability|calendar/i],
  ["tasks",/task|checklist|evidence/i],["customers",/customer|client|contact/i],["sites",/site|property|premise|location/i],
  ["services",/service|catalog|offering/i],["jobs",/job|work.?order|dispatch|visit|field/i],
  ["operations",/operation|exception|anomal|incident|health|performance|failure|error/i],["quotes",/quote|estimate|proposal/i],
]);
const SURFACE_INTENTS:Record<BuilderSurface,ReadonlySet<BuilderSemanticIntent>>={
  zero:new Set(["approvals","finance","invoices","quotes","schedule","customers","sites","services","operations","jobs","tasks"]),
  go:new Set(["schedule","tasks","customers","sites","services","operations","jobs"]),
  hub:new Set(["finance","invoices","quotes","schedule","customers","sites","services","jobs"]),
};
const severity=(value:string):BuilderSignalSeverity=>{
  switch(value.toLowerCase()){case "fatal":case "critical":return "critical";case "error":case "warn":return "warning";case "info":return "notice";default:return "info";}
};
const scalar=(value:unknown)=>typeof value==="string"||typeof value==="number"||typeof value==="boolean"?value:undefined;
const textOf=(envelope:TitanSignalProjectionEnvelope)=>{
  const payload=envelope.payload??{},metadata=envelope.metadata??{};
  return [envelope.event_type,envelope.category,envelope.source,scalar(payload.intent),scalar(payload.domain),scalar(payload.capability),scalar(payload.kind),scalar(payload.title),scalar(payload.message),scalar(metadata.intent),scalar(metadata.domain)].filter(Boolean).join(" ");
};
function intentOf(envelope:TitanSignalProjectionEnvelope):BuilderSemanticIntent|null {const text=textOf(envelope);return INTENTS.find(([,rx])=>rx.test(text))?.[0]??null;}
const boundedImpact=(envelope:TitanSignalProjectionEnvelope)=>{
  const raw=scalar(envelope.payload?.impact)??scalar(envelope.metadata?.impact)??0; const n=Number(raw); return Number.isFinite(n)?Math.min(30,Math.max(0,n)):0;
};
const titleOf=(envelope:TitanSignalProjectionEnvelope)=>{
  const raw=scalar(envelope.payload?.title)??scalar(envelope.payload?.message)??envelope.event_type; return String(raw).slice(0,160);
};
/** Converts immutable tenant Signal Engine envelopes into presentation-only Builder priority DTOs. */
export function adaptTitanSignalForBuilder(envelope:TitanSignalProjectionEnvelope,request:BuilderSignalProjectionRequest):BuilderPresentationSignal|null {
  if(!request.company_id.trim()||envelope.scope!=="tenant"||String(envelope.company_id)!==request.company_id)return null;
  if(!envelope.event_id||!envelope.event_type||!Number.isFinite(Date.parse(envelope.occurred_at)))return null;
  const intent=intentOf(envelope); if(!intent||!SURFACE_INTENTS[request.surface].has(intent))return null;
  return Object.freeze({id:envelope.event_id,company_id:request.company_id,surface:request.surface,intent,severity:severity(envelope.severity),observed_at:envelope.occurred_at,impact:boundedImpact(envelope),title:titleOf(envelope),source:envelope.source??"titan-signal-engine"});
}
export async function projectTitanSignalsForBuilder(request:BuilderSignalProjectionRequest,provider:BuilderSignalProjectionProvider):Promise<BuilderSignalPriorityContext>{
  if(!request.company_id.trim())throw new Error("builder_signal_company_required");
  const limit=Math.min(50,Math.max(1,request.limit??24));
  const envelopes=await provider({...request,limit});
  const signals=envelopes.slice(0,limit).map(e=>adaptTitanSignalForBuilder(e,request)).filter((x):x is BuilderPresentationSignal=>Boolean(x));
  return Object.freeze({company_id:request.company_id,signals:Object.freeze(signals)});
}
