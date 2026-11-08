import type { BuilderSemanticIntent } from "./intent-planner.js";
import type { BuilderWorkspacePlan, BuilderWorkspaceSection } from "./workspace-planner.js";

type BuilderSurface="zero"|"go"|"hub";
export type BuilderSignalSeverity="info"|"notice"|"warning"|"critical";
export type BuilderPresentationSignal=Readonly<{
  id:string;
  company_id:string;
  surface:BuilderSurface;
  intent:BuilderSemanticIntent;
  severity:BuilderSignalSeverity;
  observed_at:string;
  impact?:number;
  title?:string;
  source?:string;
}>;
export type BuilderSignalPriorityContext=Readonly<{
  company_id:string;
  now?:string;
  signals?:readonly BuilderPresentationSignal[];
}>;

const SEVERITY:Record<BuilderSignalSeverity,number>={info:0,notice:20,warning:55,critical:90};
const MAX_AGE_MS=7*24*60*60*1000;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
function freshness(observedAt:string,now:string){
  const age=Math.max(0,Date.parse(now)-Date.parse(observedAt));
  if(!Number.isFinite(age)||age>MAX_AGE_MS)return 0;
  return Math.round(30*(1-age/MAX_AGE_MS));
}
function validSignal(signal:BuilderPresentationSignal,context:BuilderSignalPriorityContext,surface:BuilderSurface){
  return Boolean(signal.id&&String(signal.company_id??"").trim()===String(context.company_id??"").trim()&&signal.surface===surface&&Number.isFinite(Date.parse(signal.observed_at)));
}
function score(signal:BuilderPresentationSignal,now:string){return SEVERITY[signal.severity]+freshness(signal.observed_at,now)+clamp(Number(signal.impact??0),0,30);}
function bestByIntent(signals:readonly BuilderPresentationSignal[],now:string){
  const best=new Map<BuilderSemanticIntent,{signal:BuilderPresentationSignal;score:number}>();
  for(const signal of signals){const value=score(signal,now);const current=best.get(signal.intent);if(!current||value>current.score||(value===current.score&&signal.id<current.signal.id))best.set(signal.intent,{signal,score:value});}
  return best;
}
function decorate(section:BuilderWorkspaceSection,entry:{signal:BuilderPresentationSignal;score:number}|undefined):BuilderWorkspaceSection{
  if(!entry)return section;
  const attention=entry.signal.severity==="critical"||entry.signal.severity==="warning";
  return {...section,role:attention?"attention":section.role,node:{...section.node,props:{...(section.node.props??{}),signal_priority:{id:entry.signal.id,severity:entry.signal.severity,score:entry.score,observed_at:entry.signal.observed_at,title:entry.signal.title,source:entry.signal.source,advisory_only:true,authority_granted:false}}}};
}
/** Presentation-only reprioritisation. Signals never add capabilities/actions or cross company/surface boundaries. */
export function prioritizeBuilderWorkspace(plan:BuilderWorkspacePlan,context:BuilderSignalPriorityContext):BuilderWorkspacePlan{
  const company_id=String(context.company_id??"").trim();
  if(!company_id)throw new Error("company_id-required");
  const now=context.now??new Date().toISOString();
  const signals=(context.signals??[]).filter(signal=>validSignal(signal,context,plan.surface));
  if(!signals.length)return plan;
  const best=bestByIntent(signals,now);
  const decorated=plan.sections.map(section=>decorate(section,best.get(section.intent)));
  const ranked=decorated.map((section,index)=>({section,index,priority:best.get(section.intent)?.score??0})).sort((a,b)=>b.priority-a.priority||a.index-b.index).slice(0,plan.max_visible_cards).map(({section})=>section);
  return Object.freeze({...plan,sections:Object.freeze(ranked)});
}

/** Applies the same advisory priority rules to explicit Interaction Engine components after semantic enrichment. */
export function applyBuilderSignalPriorityToDocument(document:import("./editor.js").BuilderDocument,context:BuilderSignalPriorityContext):import("./editor.js").BuilderDocument {
  const children=document.root.children??[]; if(!children.length)return document;
  const sections=children.map((node,index)=>{const raw=(node.props as any)?.semantic_intent?.name;const intent=(typeof raw==="string"?raw:"generic") as BuilderSemanticIntent;return {role:(index===0?"primary":"supporting") as BuilderWorkspaceSection["role"],intent,node};});
  const plan:BuilderWorkspacePlan={purpose:String(document.root.props?.purpose??document.title),surface:document.surface,sections,max_visible_cards:3,chat_first:true,authority_granted:false};
  const prioritized=prioritizeBuilderWorkspace(plan,context);
  return Object.freeze({...document,root:{...document.root,children:prioritized.sections.map(section=>section.node)}});
}
