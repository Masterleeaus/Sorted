import type { BuilderDocument, BuilderNode } from "./editor.js";
import { builderDataSourceOptions, type BuilderDataSourceOption } from "./binding-policy.js";
import { suggestBuilderFieldMap } from "./field-mapping.js";

type BuilderSurface="zero"|"go"|"hub";
export type BuilderAutoBinding=Readonly<{source:string;field_map:Readonly<Record<string,string>>;reason:string;confidence:"high"|"medium"}>;

const TOKENS:ReadonlyArray<readonly [RegExp,readonly string[]]>=Object.freeze([
  [/approval|decision|review|authori[sz]/i,["crm-owner-approvals"]],
  [/finance|revenue|cash|money|receivable|overdue|paid/i,["crm-owner-finance-summary"]],
  [/invoice|billing|payment/i,["crm-customer-invoices","invoices-customer","crm-owner-finance-summary"]],
  [/quote|estimate|proposal|price/i,["crm-customer-quotes"]],
  [/capacity|availability|roster/i,["crm-owner-schedule-capacity","schedule-capacity"]],
  [/schedule|booking|appointment|calendar|agenda/i,["crm-customer-bookings","crm-owner-schedule-capacity","schedule-capacity"]],
  [/task|checklist|evidence/i,["crm-field-tasks","tasks-assigned"]],
  [/customer|client|contact/i,["crm-field-minimum-customer-context"]],
  [/site|property|premise|location|address/i,["crm-field-minimum-site-context","crm-business-locations"]],
  [/service|catalog|offering/i,["crm-business-services"]],
  [/hours|opening|closing/i,["crm-business-hours"]],
  [/operation|dispatch|exception|health|summary|metric|stat|dashboard/i,["crm-owner-operations-summary","operations-summary"]],
  [/job|work.?order|assigned.?work|active.?work/i,["crm-field-assigned-work","jobs-assigned","crm-customer-work-orders","jobs-customer"]],
]);
const SURFACE_DEFAULTS:Record<BuilderSurface,readonly string[]>={
  zero:["crm-owner-operations-summary","crm-owner-approvals","crm-owner-schedule-capacity","crm-owner-finance-summary"],
  go:["crm-field-assigned-work","crm-field-tasks","crm-field-minimum-site-context","crm-field-minimum-customer-context"],
  hub:["crm-customer-bookings","crm-customer-work-orders","crm-customer-invoices","crm-customer-quotes"],
};
const text=(node:BuilderNode,purpose?:string)=>`${node.type} ${String(node.props?.title??"")} ${String(node.props?.label??"")} ${String(node.props?.description??node.props?.body??"")} ${purpose??""}`;

/** Infer a presentation-only read source from component semantics. Never creates authority or a write binding. */
export function inferBuilderDataBinding(surface:BuilderSurface,node:BuilderNode,purpose?:string):BuilderAutoBinding|null{
  const available=builderDataSourceOptions(surface); if(!available.length)return null;
  const byId=new Map(available.map(x=>[x.id,x] as const));
  const semantic=text(node,purpose);
  for(const [pattern,candidates] of TOKENS){if(!pattern.test(semantic))continue;for(const id of candidates){const source=byId.get(id);if(source)return binding(node,source,`semantic:${pattern.source}`,"high");}}
  if(/list|timeline|agenda|schedule|job|invoice|approval|metric|stat|chart|summary|grid|kanban/i.test(node.type)){
    for(const id of SURFACE_DEFAULTS[surface]){const source=byId.get(id);if(source)return binding(node,source,`surface-default:${surface}`,"medium");}
  }
  return null;
}
function binding(node:BuilderNode,source:BuilderDataSourceOption,reason:string,confidence:"high"|"medium"):BuilderAutoBinding{
  return Object.freeze({source:source.id,field_map:Object.freeze(suggestBuilderFieldMap(node.type,source.fields)),reason,confidence});
}

/** Apply inferred bindings only where the Interaction/Builder proposal did not already specify one. */
export function applyAutomaticBuilderBindings(document:BuilderDocument,purpose?:string):BuilderDocument{
  const visit=(node:BuilderNode):BuilderNode=>{
    const children=(node.children??[]).map(visit);
    if(node.id==="root" || (node.props as any)?.data_binding?.source)return {...node,children};
    const inferred=inferBuilderDataBinding(document.surface,node,purpose);
    if(!inferred)return {...node,children};
    return {...node,props:{...(node.props??{}),data_binding:{source:inferred.source,mode:"read-only",field_map:inferred.field_map,auto:true,reason:inferred.reason,confidence:inferred.confidence}},children};
  };
  return Object.freeze({...document,root:visit(document.root)});
}
