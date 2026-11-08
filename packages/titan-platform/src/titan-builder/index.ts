import catalogJson from "./catalog.json" with { type: "json" };

export type TitanBuilderCollection =
  | "components" | "blocks" | "pages" | "themes" | "templates" | "surfaces"
  | "data-sources" | "verticals" | "actions" | "schemas" | "specs";

export type BuilderCatalogItem = Readonly<{ collection: TitanBuilderCollection; id: string; file: string; data: unknown }>;
export type BuilderSurface = "zero" | "hub" | "go";

const catalog = catalogJson as unknown as {
  schema: string;
  manifest: Record<string, unknown> & { allowed_actions?: string[]; allowed_data_sources?: string[]; canonical_surface_aliases?: Record<string,string> };
  items: BuilderCatalogItem[];
  counts: Record<string, number>;
};

const deniedKeys = /(api[_-]?key|secret|password|token|credential|private[_-]?key|client[_-]?secret|authorization|cookie)/i;

export function titanBuilderCatalog() { return catalog; }
export function listBuilderItems(collection?: TitanBuilderCollection): BuilderCatalogItem[] {
  return catalog.items.filter((item) => !collection || item.collection === collection);
}
export function getBuilderItem(collection: TitanBuilderCollection, id: string): BuilderCatalogItem | undefined {
  return catalog.items.find((item) => item.collection === collection && (item.id === id || item.file.endsWith(`/${id}.json`)));
}
export function resolveBuilderSurface(surface: string): BuilderSurface {
  const normalized = String(surface || "").trim().toLowerCase();
  const aliases = catalog.manifest.canonical_surface_aliases ?? {};
  const resolved = aliases[normalized] ?? normalized;
  if (resolved !== "zero" && resolved !== "hub" && resolved !== "go") throw new Error("unsupported_builder_surface");
  return resolved;
}
export function sanitizeBuilderProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBuilderProjection);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!deniedKeys.test(key)) output[key] = sanitizeBuilderProjection(child);
  }
  return output;
}
export function validateBuilderIntent(input: { company_id: string; surface: string; action?: string; data_source?: string }) {
  if (!String(input.company_id || "").trim()) return { accepted: false as const, reason: "company_id_required" };
  let surface: BuilderSurface;
  try { surface = resolveBuilderSurface(input.surface); } catch { return { accepted: false as const, reason: "unsupported_surface" }; }
  if (input.action && !(catalog.manifest.allowed_actions ?? []).includes(input.action)) return { accepted: false as const, reason: "action_not_registered" };
  if (input.data_source && !(catalog.manifest.allowed_data_sources ?? []).includes(input.data_source)) return { accepted: false as const, reason: "data_source_not_registered" };
  return { accepted: true as const, surface, authority_granted: false as const, presentation_only: true as const };
}

export const TITAN_BUILDER_CONTRACT = Object.freeze({
  schema: "titan.builder.typescript-runtime/v1",
  company_boundary: "company_id",
  authority: "presentation-only",
  surfaces: ["zero", "hub", "go"] as const,
  onboarding: { surface: "zero", journey: "onboarding" },
  registration_confers_authority: false,
  source: "Titan Builder Master v0.10.2",
});
export { TitanBuilderWorkspace, builderCollections } from "./editor.js";
export type { BuilderNode, BuilderDocument, BuilderHistoryEntry } from "./editor.js";
export { createBuilderProposalFromPresentationIntent, composeBuilderPresentation, previewBuilderThroughRuntimes, previewBuilderWithRuntimeProjections, createBuilderPublishedHandoff } from "./runtime-bridge.js";
export type { BuilderConversationProposal, BuilderRuntimePreview } from "./runtime-bridge.js";
export { TitanBuilderConversationCycle, restoreBuilderConversationCycle } from "./conversation-cycle.js";
export type { BuilderConversationRequest, BuilderEdit, BuilderApproval } from "./conversation-cycle.js";

export { builderPropControls, builderCatalogPolicy, coerceBuilderProp } from "./prop-schema.js";
export type { BuilderPropControl } from "./prop-schema.js";
export { builderDataSourceOptions, builderActionOptions, validateBuilderBinding, type BuilderDataSourceOption, type BuilderActionOption } from "./binding-policy.js";

export * from "./field-mapping.js";
export { createBuilderPreviewRecords, mapBuilderPreviewRecord, previewBuilderNodeProps } from "./preview-data.js";
export { adaptBuilderRuntimePreview } from "./preview-adapter.js";
export type { BuilderRuntimePreviewEnvelope, BuilderPreviewAdapterResult } from "./preview-adapter.js";

export { createBuilderProjectionRequests, resolveBuilderRuntimeProjections } from "./runtime-projection.js";
export type { BuilderProjectionRequest, BuilderProjectionProvider } from "./runtime-projection.js";
export { builderProjectionOwner, createCapabilityOwnedBuilderProjectionProvider, createWorkCoreBuilderProjectionProvider, createTitanMoneyBuilderProjectionProvider } from "./projection-providers.js";
export type { BuilderProjectionOwner, BuilderCapabilityProjectionQuery, BuilderCapabilityProjectionResult, BuilderCapabilityProjectionExecutor, BuilderProjectionExecutors } from "./projection-providers.js";

export { inferBuilderDataBinding, applyAutomaticBuilderBindings, type BuilderAutoBinding } from "./auto-binding.js";

export { planBuilderSemanticIntent, applyBuilderSemanticIntentPlan } from "./intent-planner.js";
export type { BuilderSemanticIntent, BuilderIntentPlan } from "./intent-planner.js";

export { planBuilderWorkspace, applyBuilderWorkspacePlan } from "./workspace-planner.js";
export type { BuilderWorkspacePlan, BuilderWorkspaceSection } from "./workspace-planner.js";

export { prioritizeBuilderWorkspace, applyBuilderSignalPriorityToDocument } from "./signal-priority.js";
export type { BuilderPresentationSignal, BuilderSignalPriorityContext, BuilderSignalSeverity } from "./signal-priority.js";

export { adaptTitanSignalForBuilder, projectTitanSignalsForBuilder } from "./signal-projection.js";
export type { TitanSignalProjectionEnvelope, BuilderSignalProjectionRequest, BuilderSignalProjectionProvider } from "./signal-projection.js";

export { createBuilderCommandIntent, dispatchBuilderCommandIntent } from "./command-handoff.js";
export type { BuilderCommandIntent, BuilderCommandReceipt, BuilderCommandGateway } from "./command-handoff.js";

export { createBuilderInterfaceIntent, composeBuilderThroughInterfaceRuntime, runBuilderPresentationPipeline } from "./presentation-pipeline.js";
export type { BuilderPresentationPipelineResult } from "./presentation-pipeline.js";

export { certifyBuilderSurface, assertBuilderSurfaceCertified } from "./surface-certification.js";
export type { BuilderSurfaceCertification, BuilderSurfaceCertificationIssue } from "./surface-certification.js";

export { persistBuilderDraft, publishBuilderRevision, rewindBuilderRevision } from "./lifecycle.js";
export type { BuilderLifecycleRecord, BuilderLifecycleStore } from "./lifecycle.js";

export { assertBuilderSecurityGate, sanitizeBuilderAiOutput, assertBuilderCommandSecurity, filterBuilderSignalsAtSecurityBoundary } from "./security-gate.js";
export type { BuilderSecurityGateResult } from "./security-gate.js";
