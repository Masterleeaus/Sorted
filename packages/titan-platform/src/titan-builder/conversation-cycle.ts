import { createInteractionPresentationIntent } from "../ported/titan-runtime/interaction-engine/presentation-intent.js";
import type { InterfaceContext } from "../interface-runtime.js";
import type { VisualEnvironment, VisualPreferences } from "../visual-runtime.js";
import { TitanBuilderWorkspace, type BuilderDocument, type BuilderNode } from "./editor.js";
import { createBuilderProposalFromPresentationIntent, createBuilderPublishedHandoff, previewBuilderThroughRuntimes } from "./runtime-bridge.js";
import { resolveBuilderSurface, sanitizeBuilderProjection, validateBuilderIntent, type BuilderSurface } from "./index.js";
import type { BuilderSignalPriorityContext } from "./signal-priority.js";

export type BuilderConversationRequest = Readonly<{
  company_id:string; surface:string; presentation_id:string; message:string; purpose?:string;
  semantic_components?:readonly unknown[]; visual_hints?:Readonly<Record<string,unknown>>; signal_priority?:BuilderSignalPriorityContext;
}>;
export type BuilderEdit = Readonly<
  | {kind:"insert"; parent_id:string; node:BuilderNode; index?:number}
  | {kind:"patch"; node_id:string; props:Record<string,unknown>}
  | {kind:"move"; node_id:string; parent_id:string; index?:number}
  | {kind:"remove"; node_id:string}
  | {kind:"bind-action"; node_id:string; action:string; data_source?:string}
>;
export type BuilderApproval = Readonly<{approved:boolean; approved_by:string; approved_at:string; company_id:string; workspace_id:string; draft_revision:number}>;

function semanticToNode(value:unknown,index:number):BuilderNode {
  const raw=(value && typeof value==="object" && !Array.isArray(value)) ? value as Record<string,unknown> : {};
  const type=String(raw.type ?? raw.component ?? "text");
  const id=String(raw.id ?? raw.key ?? `${type}-${index+1}`);
  const props=(sanitizeBuilderProjection(raw.props ?? raw) ?? {}) as Record<string,unknown>;
  delete props.type; delete props.component; delete props.id; delete props.key; delete props.children;
  const children=Array.isArray(raw.children) ? raw.children.map(semanticToNode) : [];
  return {id,type,props,children};
}

/** One governed conversational Builder session. No chat request can publish by itself. */
export class TitanBuilderConversationCycle {
  readonly company_id:string; readonly surface:BuilderSurface; readonly context:InterfaceContext;
  #workspace:TitanBuilderWorkspace; #approval:BuilderApproval|null=null; #lastPreviewRevision:number|null=null;

  private constructor(input:{company_id:string;surface:BuilderSurface;context:InterfaceContext;workspace:TitanBuilderWorkspace}) {
    this.company_id=input.company_id; this.surface=input.surface; this.context=input.context; this.#workspace=input.workspace;
  }

  static fromChatRequest(request:BuilderConversationRequest,context:InterfaceContext) {
    if(!request.company_id.trim()) throw new Error("company_id_required");
    if(context.company_id!==request.company_id) throw new Error("builder_context_company_mismatch");
    const surface=resolveBuilderSurface(request.surface || context.product_surface);
    if(resolveBuilderSurface(context.product_surface)!==surface) throw new Error("builder_context_surface_mismatch");
    const gate=validateBuilderIntent({company_id:request.company_id,surface}); if(!gate.accepted) throw new Error(gate.reason);
    const purpose=(request.purpose ?? request.message).trim(); if(!purpose) throw new Error("builder_chat_purpose_required");
    const interactionIntent=createInteractionPresentationIntent({
      company_id:request.company_id,presentation_id:request.presentation_id,surface,purpose,
      semantic_components:request.semantic_components ?? [],visual_hints:request.visual_hints ?? {},actions:[]
    }) as any;
    const components=(interactionIntent.payload.semantic_components ?? []).map(semanticToNode).map((node:BuilderNode)=>({key:node.id,type:node.type,props:node.props,children:(node.children??[]).map((c:any)=>({key:c.id,type:c.type,props:c.props,children:c.children??[]}))}));
    const proposal=createBuilderProposalFromPresentationIntent({company_id:request.company_id,context,intent:{purpose:interactionIntent.payload.purpose,surface,components,visual_hints:interactionIntent.payload.visual_hints},title:purpose,signal_priority:request.signal_priority});
    const workspace=new TitanBuilderWorkspace({company_id:proposal.company_id,surface:proposal.surface,id:proposal.workspace.id,title:proposal.workspace.title,root:proposal.workspace.root});
    return new TitanBuilderConversationCycle({company_id:request.company_id,surface,context,workspace});
  }

  snapshot(){return this.#workspace.snapshot()}
  apply(edit:BuilderEdit){this.#approval=null;this.#lastPreviewRevision=null;switch(edit.kind){
    case "insert": return this.#workspace.insert(edit.parent_id,edit.node,edit.index);
    case "patch": return this.#workspace.patch(edit.node_id,edit.props);
    case "move": return this.#workspace.move(edit.node_id,edit.parent_id,edit.index);
    case "remove": return this.#workspace.remove(edit.node_id);
    case "bind-action": return this.#workspace.bindAction(edit.node_id,{action:edit.action,data_source:edit.data_source});
  }}
  preview(environment:VisualEnvironment,preferences?:VisualPreferences){const document=this.#workspace.snapshot();const preview=previewBuilderThroughRuntimes({document,context:this.context,environment,preferences});this.#lastPreviewRevision=document.revision;return preview;}
  requestApproval(approved_by:string):BuilderApproval {const document=this.#workspace.snapshot();if(this.#lastPreviewRevision!==document.revision)throw new Error("builder_preview_required_before_approval");if(!approved_by.trim())throw new Error("builder_approver_required");this.#approval=Object.freeze({approved:true,approved_by,approved_at:new Date().toISOString(),company_id:this.company_id,workspace_id:document.id,draft_revision:document.revision});return this.#approval;}
  publish(){const before=this.#workspace.snapshot();if(!this.#approval?.approved)throw new Error("builder_explicit_approval_required");if(this.#approval.company_id!==before.company_id||this.#approval.workspace_id!==before.id||this.#approval.draft_revision!==before.revision)throw new Error("builder_approval_stale");const published=this.#workspace.publish();const handoff=createBuilderPublishedHandoff(published.document,this.context);this.#approval=null;return Object.freeze({schema:"titan.builder.conversation-publish/v1",approval:Object.freeze({...published,document:undefined}),document:published.document,handoff,requires_downstream_action_authorization:true,builder_grants_authority:false});}
}

export function restoreBuilderConversationCycle(document:BuilderDocument,context:InterfaceContext){
  if(document.company_id!==context.company_id)throw new Error("builder_context_company_mismatch");
  const surface=resolveBuilderSurface(document.surface);if(resolveBuilderSurface(context.product_surface)!==surface)throw new Error("builder_context_surface_mismatch");
  const workspace=new TitanBuilderWorkspace({company_id:document.company_id,surface,id:document.id,title:document.title,root:document.root});
  return {workspace,company_id:document.company_id,surface};
}
