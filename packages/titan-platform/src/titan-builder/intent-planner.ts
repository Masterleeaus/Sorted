import type { BuilderDocument, BuilderNode } from "./editor.js";
import { builderActionOptions, builderDataSourceOptions } from "./binding-policy.js";
import { suggestBuilderFieldMap } from "./field-mapping.js";

type BuilderSurface="zero"|"go"|"hub";
export type BuilderSemanticIntent="approvals"|"finance"|"invoices"|"quotes"|"schedule"|"tasks"|"customers"|"sites"|"services"|"operations"|"jobs"|"conversation"|"generic";
export type BuilderIntentPlan=Readonly<{
  intent:BuilderSemanticIntent; component:string; data_source?:string; field_map:Readonly<Record<string,string>>;
  actions:readonly string[]; responsive:Readonly<{mobile:string;tablet:string;desktop:string}>;
  confidence:"high"|"medium"; reason:string; authority_granted:false;
}>;

const RULES:ReadonlyArray<Readonly<{intent:BuilderSemanticIntent;match:RegExp;components:readonly string[];sources:readonly string[];actions?:readonly string[]}>>=Object.freeze([
 {intent:"approvals",match:/approve|approval|decision|review|authori[sz]/i,components:["approval-card","data-list"],sources:["crm-owner-approvals"]},
 {intent:"invoices",match:/invoice|billing|receivable|overdue/i,components:["invoice-header","data-list","stat-card"],sources:["crm-customer-invoices","invoices-customer","crm-owner-finance-summary"]},
 {intent:"quotes",match:/quote|estimate|proposal|pricing/i,components:["price-summary","data-list"],sources:["crm-customer-quotes"],actions:["titanmoney.quotes.create"]},
 {intent:"finance",match:/finance|revenue|cash|money|payment/i,components:["stat-card","metric","chart-line"],sources:["crm-owner-finance-summary"],actions:["zeropay.payment-intent.create"]},
 {intent:"schedule",match:/schedule|booking|appointment|calendar|agenda|capacity|availability/i,components:["calendar-agenda","timeline","data-list"],sources:["crm-customer-bookings","crm-owner-schedule-capacity","schedule-capacity"]},
 {intent:"tasks",match:/task|checklist|evidence/i,components:["mobile-list","data-list"],sources:["crm-field-tasks","tasks-assigned"],actions:["crm.work_order.task.complete"]},
 {intent:"customers",match:/customer|client|contact/i,components:["entity-card","data-list"],sources:["crm-field-minimum-customer-context"]},
 {intent:"sites",match:/site|property|premise|location|address/i,components:["entity-card","key-value-list"],sources:["crm-field-minimum-site-context","crm-business-locations"]},
 {intent:"services",match:/service|catalog|offering/i,components:["product-card","data-list"],sources:["crm-business-services"]},
 {intent:"operations",match:/operation|dispatch|exception|business health|summary|dashboard|performance/i,components:["summary-banner","stat-card","metric"],sources:["crm-owner-operations-summary","operations-summary"]},
 {intent:"jobs",match:/job|work.?order|assigned.?work|active.?work/i,components:["mobile-list","timeline","data-list"],sources:["crm-field-assigned-work","jobs-assigned","crm-customer-work-orders","jobs-customer"],actions:["crm.work_order.assign"]},
 {intent:"conversation",match:/chat|conversation|message|assistant/i,components:["chat-thread","briefing"],sources:[],actions:["communications.message.send"]},
]);
const GENERIC=new Set(["card","data-list","mobile-list","grid","stack","text"]);
const layout=(component:string)=>/chart|metric|stat/.test(component)?{mobile:"stack",tablet:"two-column",desktop:"dashboard-grid"}:/calendar|timeline|list/.test(component)?{mobile:"single-column",tablet:"single-column",desktop:"wide-list"}:{mobile:"single-column",tablet:"two-column",desktop:"content-grid"};
const semanticText=(node:BuilderNode,purpose:string)=>`${purpose} ${node.type} ${String(node.props?.title??"")} ${String(node.props?.label??"")} ${String(node.props?.description??node.props?.body??"")}`;

export function planBuilderSemanticIntent(surface:BuilderSurface,purpose:string,node:BuilderNode):BuilderIntentPlan {
  const text=semanticText(node,purpose); const rule=RULES.find(r=>r.match.test(text));
  const sources=new Set(builderDataSourceOptions(surface).map(x=>x.id)); const actions=new Set(builderActionOptions(surface).map(x=>x.id));
  const component=rule?.components[0] ?? node.type;
  const source=rule?.sources.find(x=>sources.has(x));
  const allowedActions=(rule?.actions??[]).filter(x=>actions.has(x));
  const field_map=source?suggestBuilderFieldMap(component,builderDataSourceOptions(surface).find(x=>x.id===source)?.fields??[]):{};
  return Object.freeze({intent:rule?.intent??"generic",component,data_source:source,field_map:Object.freeze(field_map),actions:Object.freeze(allowedActions),responsive:Object.freeze(layout(component)),confidence:rule?"high":"medium",reason:rule?`interaction-purpose:${rule.intent}`:"interaction-purpose:generic",authority_granted:false});
}

/** Enrich Interaction Engine presentation nodes without overriding explicit Builder choices. */
export function applyBuilderSemanticIntentPlan(document:BuilderDocument,purpose:string):BuilderDocument {
 const visit=(node:BuilderNode):BuilderNode=>{
   const children=(node.children??[]).map(visit); if(node.id==="root")return {...node,children};
   const plan=planBuilderSemanticIntent(document.surface,purpose,node);
   const explicitSource=(node.props as any)?.data_binding?.source;
   const explicitResponsive=(node.props as any)?.responsive;
   const plannedType=GENERIC.has(node.type)&&plan.intent!=="generic"?plan.component:node.type;
   const props={...(node.props??{}),semantic_intent:{name:plan.intent,confidence:plan.confidence,reason:plan.reason,authority_granted:false},responsive:explicitResponsive??plan.responsive} as Record<string,unknown>;
   if(!explicitSource&&plan.data_source)props.data_binding={source:plan.data_source,mode:"read-only",field_map:plan.field_map,auto:true,reason:plan.reason,confidence:plan.confidence};
   const existing=new Set((node.actions??[]).map(a=>a.action));
   const actions=[...(node.actions??[]),...plan.actions.filter(a=>!existing.has(a)).map(action=>({action,data_source:plan.data_source}))];
   return {...node,type:plannedType,props,actions,children};
 };
 return Object.freeze({...document,root:visit(document.root)});
}
