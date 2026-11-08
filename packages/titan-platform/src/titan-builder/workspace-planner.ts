import type { BuilderDocument, BuilderNode } from "./editor.js";
import { planBuilderSemanticIntent, type BuilderSemanticIntent } from "./intent-planner.js";
import { prioritizeBuilderWorkspace, type BuilderSignalPriorityContext } from "./signal-priority.js";

type BuilderSurface="zero"|"go"|"hub";
export type BuilderWorkspaceSection=Readonly<{
  role:"primary"|"supporting"|"attention";
  intent:BuilderSemanticIntent;
  node:BuilderNode;
}>;
export type BuilderWorkspacePlan=Readonly<{
  purpose:string;
  surface:BuilderSurface;
  sections:readonly BuilderWorkspaceSection[];
  max_visible_cards:3;
  chat_first:true;
  authority_granted:false;
}>;

const INTENT_MATCHERS:ReadonlyArray<readonly [BuilderSemanticIntent,RegExp]>=Object.freeze([
  ["approvals",/approve|approval|decision|review|authori[sz]|needs? attention/i],
  ["finance",/finance|revenue|cash|money|payment|business health|health|performance/i],
  ["invoices",/invoice|billing|receivable|overdue/i],
  ["quotes",/quote|estimate|proposal|pricing/i],
  ["schedule",/schedule|booking|appointment|calendar|agenda|capacity|availability|today/i],
  ["tasks",/task|checklist|evidence|to.?do/i],
  ["customers",/customer|client|contact/i],
  ["sites",/site|property|premise|location|address/i],
  ["services",/service|catalog|offering/i],
  ["operations",/operation|dispatch|exception|business health|health|summary|dashboard|performance|today/i],
  ["jobs",/job|work.?order|assigned.?work|active.?work|today/i],
  ["conversation",/chat|conversation|message|assistant/i],
]);
const SURFACE_DEFAULTS:Record<BuilderSurface,readonly BuilderSemanticIntent[]>={
  zero:["operations","finance","approvals"],
  go:["jobs","tasks","sites"],
  hub:["schedule","jobs","invoices"],
};
const COMPLEMENTS:Partial<Record<BuilderSemanticIntent,readonly BuilderSemanticIntent[]>>={
  operations:["finance","approvals","jobs"], finance:["invoices","approvals","operations"], approvals:["operations","finance"],
  jobs:["schedule","tasks","sites"], schedule:["jobs","tasks"], tasks:["jobs","sites"], sites:["jobs","customers"],
  customers:["jobs","schedule"], invoices:["quotes","schedule"], quotes:["schedule","invoices"], services:["schedule","quotes"],
};
const intentSeed=(intent:BuilderSemanticIntent,index:number):BuilderNode=>({id:`planned-${intent}-${index+1}`,type:"card",props:{title:intent}});
const titleFor=(intent:BuilderSemanticIntent)=>({
  approvals:"Needs your attention",finance:"Money snapshot",invoices:"Invoices",quotes:"Quotes & estimates",schedule:"Schedule",tasks:"Next tasks",
  customers:"Customers",sites:"Site context",services:"Services",operations:"Business health",jobs:"Active work",conversation:"Conversation",generic:"Overview"
}[intent]);
function detectedIntents(purpose:string){return INTENT_MATCHERS.filter(([,rx])=>rx.test(purpose)).map(([intent])=>intent);}
function unique<T>(values:readonly T[]){return [...new Set(values)];}
function buildIntentOrder(surface:BuilderSurface,purpose:string){
  const detected=detectedIntents(purpose);
  const seed=detected[0] ?? SURFACE_DEFAULTS[surface][0];
  return unique([...(detected.length?detected:[seed]),...(COMPLEMENTS[seed]??[]),...SURFACE_DEFAULTS[surface]]).slice(0,3);
}
function roleFor(index:number,intent:BuilderSemanticIntent):BuilderWorkspaceSection["role"]{return index===0?"primary":intent==="approvals"?"attention":"supporting";}
function plannedNode(surface:BuilderSurface,purpose:string,intent:BuilderSemanticIntent,index:number):BuilderNode|null{
  const semanticPurpose=`${purpose} ${intent}`;
  const plan=planBuilderSemanticIntent(surface,semanticPurpose,intentSeed(intent,index));
  if(plan.intent==="generic")return null;
  const props:Record<string,unknown>={
    title:titleFor(intent),
    semantic_intent:{name:plan.intent,confidence:plan.confidence,reason:"workspace-plan",authority_granted:false},
    responsive:plan.responsive,
    workspace_role:roleFor(index,intent),
  };
  if(plan.data_source)props.data_binding={source:plan.data_source,mode:"read-only",field_map:plan.field_map,auto:true,reason:"workspace-plan",confidence:plan.confidence};
  return {id:`planned-${intent}-${index+1}`,type:plan.component,props,actions:plan.actions.map(action=>({action,data_source:plan.data_source})),children:[]};
}

/** Plans a compact, chat-first set of complementary presentation sections. */
export function planBuilderWorkspace(surface:BuilderSurface,purpose:string):BuilderWorkspacePlan {
  const sections=buildIntentOrder(surface,purpose).map((intent,index)=>{
    const node=plannedNode(surface,purpose,intent,index); return node?{role:roleFor(index,intent),intent,node}:null;
  }).filter((x):x is BuilderWorkspaceSection=>Boolean(x));
  return Object.freeze({purpose,surface,sections:Object.freeze(sections),max_visible_cards:3,chat_first:true,authority_granted:false});
}

/**
 * Interaction Engine may provide explicit semantic components. Those remain authoritative.
 * Workspace planning fills an empty conversational proposal only, preventing duplicate cards
 * and preserving explicit/user-authored Builder structure.
 */
export function applyBuilderWorkspacePlan(document:BuilderDocument,purpose:string,priority?:BuilderSignalPriorityContext):BuilderDocument {
  if((document.root.children??[]).length>0)return document;
  const semanticPlan=planBuilderWorkspace(document.surface,purpose);
  const plan=priority?prioritizeBuilderWorkspace(semanticPlan,priority):semanticPlan;
  return Object.freeze({...document,root:{...document.root,props:{...(document.root.props??{}),workspace_plan:{chat_first:true,max_visible_cards:3,authority_granted:false}},children:plan.sections.map(section=>section.node)}});
}
