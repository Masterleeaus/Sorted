import { type InterfaceContext, type PresentationIntent, type PresentationNode, type PresentationTree } from "../interface-runtime.js";
import { type VisualEnvironment, type VisualPreferences } from "../visual-runtime.js";
import { TitanBuilderWorkspace, type BuilderDocument, type BuilderNode } from "./editor.js";
import { resolveBuilderSurface, sanitizeBuilderProjection, validateBuilderIntent, type BuilderSurface } from "./index.js";
import { applyAutomaticBuilderBindings } from "./auto-binding.js";
import { applyBuilderSemanticIntentPlan } from "./intent-planner.js";
import { applyBuilderWorkspacePlan } from "./workspace-planner.js";
import { applyBuilderSignalPriorityToDocument, type BuilderSignalPriorityContext } from "./signal-priority.js";
import { composeBuilderThroughInterfaceRuntime, runBuilderPresentationPipeline } from "./presentation-pipeline.js";

export type BuilderConversationProposal = Readonly<{
  schema: "titan.builder.conversation-proposal/v1";
  company_id: string;
  surface: BuilderSurface;
  purpose: string;
  workspace: BuilderDocument;
  source: "interaction-engine-presentation-intent";
  requires_review: true;
  authority_granted: false;
}>;

export type BuilderRuntimePreview = Readonly<{
  schema: "titan.builder.runtime-preview/v1";
  company_id: string;
  surface: BuilderSurface;
  presentation: PresentationTree;
  visual: Readonly<Record<string, unknown>>;
  draft_revision: number;
  publish: false;
  authority_granted: false;
}>;

const safeId=(value:string,index:number)=>{
  const id=value.trim().replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
  return id || `node-${index}`;
};

function presentationNodeToBuilder(node:PresentationNode,index:number):BuilderNode {
  return {
    id:safeId(node.key || `${node.type}-${index}`,index),
    type:node.type,
    props:sanitizeBuilderProjection(node.props ?? {}) as Record<string,unknown>,
    children:(node.children ?? []).map((child,childIndex)=>presentationNodeToBuilder(child,childIndex)),
  };
}

/**
 * Converts Interaction Engine PresentationIntent into a Builder draft only.
 * The proposal never auto-publishes and never inherits execution authority.
 */
export function createBuilderProposalFromPresentationIntent(input:{
  company_id:string;
  context:InterfaceContext;
  intent:PresentationIntent;
  workspace_id?:string;
  title?:string;
  signal_priority?:BuilderSignalPriorityContext;
}):BuilderConversationProposal {
  if(!input.company_id.trim()) throw new Error("company_id_required");
  if(input.context.company_id !== input.company_id) throw new Error("builder_context_company_mismatch");
  const surface=resolveBuilderSurface(input.intent.surface ?? input.context.product_surface);
  const gate=validateBuilderIntent({company_id:input.company_id,surface});
  if(!gate.accepted) throw new Error(gate.reason);
  const children=(input.intent.components ?? []).map((node,index)=>presentationNodeToBuilder(node,index));
  const workspace=new TitanBuilderWorkspace({
    company_id:input.company_id,
    surface,
    id:input.workspace_id,
    title:input.title ?? input.intent.purpose,
    root:{id:"root",type:"stack",props:{purpose:input.intent.purpose,visual_hints:sanitizeBuilderProjection(input.intent.visual_hints ?? {})},children},
  });
  const planned=applyAutomaticBuilderBindings(applyBuilderSemanticIntentPlan(applyBuilderWorkspacePlan(workspace.snapshot(),input.intent.purpose,input.signal_priority),input.intent.purpose),input.intent.purpose);
  const prioritized=input.signal_priority?applyBuilderSignalPriorityToDocument(planned,input.signal_priority):planned;
  return Object.freeze({schema:"titan.builder.conversation-proposal/v1",company_id:input.company_id,surface,purpose:input.intent.purpose,workspace:prioritized,source:"interaction-engine-presentation-intent",requires_review:true,authority_granted:false});
}

/** Builds the exact Interface Runtime tree that Builder preview/publish will hand off. */
export function composeBuilderPresentation(document:BuilderDocument, context:InterfaceContext):PresentationTree {
  if(document.company_id !== context.company_id) throw new Error("builder_context_company_mismatch");
  return composeBuilderThroughInterfaceRuntime(document,context);
}

/**
 * Runs a Builder draft through Interface Runtime + Visual Runtime without publishing.
 * Visual Runtime is semantics-preserving and cannot authorize actions.
 */
export function previewBuilderThroughRuntimes(input:{
  document:BuilderDocument;
  context:InterfaceContext;
  environment:VisualEnvironment;
  preferences?:VisualPreferences;
}):BuilderRuntimePreview {
  if(input.document.company_id !== input.context.company_id) throw new Error("builder_context_company_mismatch");
  if(input.environment.company_id != null && String(input.environment.company_id) !== input.document.company_id) throw new Error("builder_visual_company_mismatch");
  const pipeline=runBuilderPresentationPipeline(input);
  return Object.freeze({schema:"titan.builder.runtime-preview/v1",company_id:input.document.company_id,surface:pipeline.surface,presentation:pipeline.presentation,visual:pipeline.visual,draft_revision:input.document.revision,publish:false,authority_granted:false});
}

/** Published handoff stays declarative; downstream capability owners must re-authorize every action. */
export function createBuilderPublishedHandoff(document:BuilderDocument,context:InterfaceContext) {
  if(document.status !== "published") throw new Error("builder_document_not_published");
  const presentation=composeBuilderPresentation(document,context);
  return Object.freeze({schema:"titan.builder.published-handoff/v1",company_id:document.company_id,surface:document.surface,revision:document.revision,presentation,requires_downstream_action_authorization:true,builder_grants_authority:false});
}

/**
 * Preview handoff for server capability owners. Builder describes the exact read-only
 * projections it needs; the owning runtime may resolve them, but Builder never fetches
 * providers or widens authority itself.
 */
export async function previewBuilderWithRuntimeProjections(input:{
  document:BuilderDocument;
  context:InterfaceContext;
  environment:VisualEnvironment;
  preferences?:VisualPreferences;
  projectionProvider?:import("./runtime-projection.js").BuilderProjectionProvider;
}) {
  const [{ createBuilderProjectionRequests, resolveBuilderRuntimeProjections }, preview] = await Promise.all([
    import("./runtime-projection.js"),
    Promise.resolve(previewBuilderThroughRuntimes(input)),
  ]);
  const projection_requests=createBuilderProjectionRequests(input.document,input.context);
  const runtime_previews=await resolveBuilderRuntimeProjections({document:input.document,context:input.context,provider:input.projectionProvider});
  return Object.freeze({
    schema:"titan.builder.runtime-projection-preview/v1" as const,
    preview,
    projection_requests,
    runtime_previews,
    fallback_mode:runtime_previews.length?"runtime-with-synthetic-fallback" as const:"synthetic" as const,
    read_only:true as const,
    authority_granted:false as const,
  });
}
