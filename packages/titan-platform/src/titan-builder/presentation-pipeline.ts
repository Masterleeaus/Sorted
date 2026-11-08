import { createTitanInterfaceRuntime, type InterfaceContext, type PresentationIntent, type PresentationNode, type PresentationTree } from "../interface-runtime.js";
import { defaultVisualCapabilitySupport, planVisualRuntime, type VisualEnvironment, type VisualPreferences } from "../visual-runtime.js";
import type { BuilderDocument, BuilderNode } from "./editor.js";
import { resolveBuilderSurface, sanitizeBuilderProjection, type BuilderSurface } from "./index.js";

/**
 * Canonical Builder presentation pipeline.
 * Interaction Engine owns semantic intent; Builder owns editable presentation state;
 * Interface Runtime owns composition; Visual Runtime owns visual execution planning.
 * Builder never implements a parallel renderer or grants action authority.
 */
export type BuilderPresentationPipelineResult = Readonly<{
  schema:"titan.builder.presentation-pipeline/v1";
  company_id:string;
  surface:BuilderSurface;
  presentation:PresentationTree;
  visual:Readonly<Record<string,unknown>>;
  owners:Readonly<{semantic:"interaction-engine";editing:"titan-builder";composition:"interface-runtime";visual_execution:"visual-runtime"}>;
  parallel_renderer:false;
  authority_granted:false;
}>;

function toPresentationNode(node:BuilderNode):PresentationNode {
  return Object.freeze({
    key:node.id,
    type:node.type,
    props:Object.freeze(sanitizeBuilderProjection(node.props ?? {}) as Record<string,unknown>),
    children:Object.freeze((node.children ?? []).map(toPresentationNode)),
  });
}

export function createBuilderInterfaceIntent(document:BuilderDocument,context:InterfaceContext):PresentationIntent {
  if(document.company_id!==context.company_id) throw new Error("builder_context_company_mismatch");
  const surface=resolveBuilderSurface(document.surface);
  if(resolveBuilderSurface(context.product_surface)!==surface) throw new Error("builder_context_surface_mismatch");
  return Object.freeze({
    purpose:String(document.root.props?.purpose ?? document.title),
    surface,
    components:Object.freeze((document.root.children ?? []).map(toPresentationNode)),
    visual_hints:Object.freeze((sanitizeBuilderProjection(document.root.props?.visual_hints ?? {}) ?? {}) as Record<string,unknown>),
    // Actions stay on Builder nodes as declarative bindings and leave through Command Bus.
    // They are deliberately not promoted to Interface Runtime authority here.
    governed_actions:Object.freeze([]),
  });
}

export function composeBuilderThroughInterfaceRuntime(document:BuilderDocument,context:InterfaceContext):PresentationTree {
  return createTitanInterfaceRuntime().presentation.compose(createBuilderInterfaceIntent(document,context),context);
}

export function runBuilderPresentationPipeline(input:{document:BuilderDocument;context:InterfaceContext;environment:VisualEnvironment;preferences?:VisualPreferences}):BuilderPresentationPipelineResult {
  if(input.document.company_id!==input.context.company_id) throw new Error("builder_context_company_mismatch");
  const surface=resolveBuilderSurface(input.document.surface);
  if(resolveBuilderSurface(input.context.product_surface)!==surface) throw new Error("builder_context_surface_mismatch");
  if(input.environment.company_id!=null && String(input.environment.company_id)!==input.document.company_id) throw new Error("builder_visual_company_mismatch");
  if(resolveBuilderSurface(input.environment.surface)!==surface) throw new Error("builder_visual_surface_mismatch");
  const presentation=composeBuilderThroughInterfaceRuntime(input.document,input.context);
  const hints=(input.document.root.props?.visual_hints ?? {}) as Record<string,unknown>;
  const visual=planVisualRuntime({
    company_id:input.document.company_id,
    visualTreatment:typeof hints.visualTreatment==="string"?hints.visualTreatment:undefined,
    motionPreset:typeof hints.motionPreset==="string"?hints.motionPreset:undefined,
    transitionPreset:typeof hints.transitionPreset==="string"?hints.transitionPreset:undefined,
    visualCapabilityRequirements:Array.isArray(hints.visualCapabilityRequirements)?hints.visualCapabilityRequirements.filter((x):x is string=>typeof x==="string"):undefined,
  },input.environment,input.preferences ?? {},defaultVisualCapabilitySupport(input.environment));
  return Object.freeze({schema:"titan.builder.presentation-pipeline/v1",company_id:input.document.company_id,surface,presentation,visual:visual as unknown as Readonly<Record<string,unknown>>,owners:Object.freeze({semantic:"interaction-engine",editing:"titan-builder",composition:"interface-runtime",visual_execution:"visual-runtime"}),parallel_renderer:false,authority_granted:false});
}
