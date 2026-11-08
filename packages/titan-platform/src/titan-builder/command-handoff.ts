import { builderActionOptions, validateBuilderBinding } from "./binding-policy.js";
import { resolveBuilderSurface, sanitizeBuilderProjection, type BuilderSurface } from "./index.js";
import type { BuilderDocument, BuilderNode } from "./editor.js";

export type BuilderCommandIntent = Readonly<{
  schema:"titan.builder.command-intent/v1"; company_id:string; surface:BuilderSurface;
  document_id:string; document_revision:number; node_id:string; action:string;
  data_source?:string; required_capability?:string; confirmation?:string;
  parameters:Readonly<Record<string,unknown>>; authority_granted:false;
  requires_downstream_authorization:true; execution_owner:"command-bus";
}>;
export type BuilderCommandReceipt = Readonly<{accepted:boolean; command_id?:string; status:"accepted"|"denied"|"unavailable"; reason?:string; authority_source:"downstream-command-bus"}>;
export interface BuilderCommandGateway { dispatch(intent:BuilderCommandIntent):Promise<BuilderCommandReceipt>|BuilderCommandReceipt }

function findNode(node:BuilderNode,id:string):BuilderNode|undefined { if(node.id===id)return node; for(const child of node.children??[]){const hit=findNode(child,id);if(hit)return hit;} }
function safeParameters(value:unknown):Readonly<Record<string,unknown>> { const clean=sanitizeBuilderProjection(value??{}); if(!clean||Array.isArray(clean)||typeof clean!=="object") return Object.freeze({}); return Object.freeze(clean as Record<string,unknown>); }

/** Builder may describe an action request, but only Command Bus can authorize/execute it. */
export function createBuilderCommandIntent(input:{document:BuilderDocument;company_id:string;surface:string;node_id:string;action:string;parameters?:unknown}):BuilderCommandIntent {
  if(input.document.status!=="published") throw new Error("builder_action_requires_published_document");
  if(input.document.company_id!==input.company_id) throw new Error("builder_command_company_mismatch");
  const surface=resolveBuilderSurface(input.surface);
  if(surface!==input.document.surface) throw new Error("builder_command_surface_mismatch");
  const node=findNode(input.document.root,input.node_id); if(!node) throw new Error("builder_command_node_not_found");
  const binding=(node.actions??[]).find(x=>x.action===input.action); if(!binding) throw new Error("builder_command_action_not_bound");
  const governed=validateBuilderBinding(surface,input.action,binding.data_source);
  const option=builderActionOptions(surface).find(x=>x.id===input.action); if(!option) throw new Error("builder_command_action_not_registered");
  return Object.freeze({schema:"titan.builder.command-intent/v1",company_id:input.company_id,surface,document_id:input.document.id,document_revision:input.document.revision,node_id:input.node_id,action:input.action,data_source:binding.data_source,required_capability:option.required_capability,confirmation:option.confirmation,parameters:safeParameters(input.parameters),authority_granted:false,requires_downstream_authorization:governed.requires_downstream_authorization,execution_owner:"command-bus"});
}
export async function dispatchBuilderCommandIntent(intent:BuilderCommandIntent,gateway?:BuilderCommandGateway):Promise<BuilderCommandReceipt>{
  if(!gateway)return Object.freeze({accepted:false,status:"unavailable",reason:"command_bus_gateway_unavailable",authority_source:"downstream-command-bus"});
  const receipt=await gateway.dispatch(intent); return Object.freeze({...receipt,authority_source:"downstream-command-bus"});
}
