import {
  createCompanyExecutionContext as createCompanyExecutionContextRaw,
  normalizeCompatibilityCompanyInput as normalizeCompatibilityCompanyInputRaw,
  assertCompanyBoundaryMatch as assertCompanyBoundaryMatchRaw,
  bindCompanyBoundary as bindCompanyBoundaryRaw,
} from "./ported/titan-runtime/company-context.js";

export type TitanCompanyExecutionContext = Readonly<{
  company_id: string;
  actor_id: string | null;
  device_id: string | null;
  correlation_id: string | null;
  operation_id: string | null;
  source: string;
}>;

export type TitanCompanyContextInput = {
  company_id?: string;
  tenant_id?: string;
  tenant_company_id?: string;
  actor_id?: string | null;
  device_id?: string | null;
  correlation_id?: string | null;
  operation_id?: string | null;
  source?: string;
  [key: string]: unknown;
};

export const createCompanyExecutionContext = createCompanyExecutionContextRaw as (
  input: TitanCompanyContextInput,
  options?: { allowLegacyAliases?: boolean },
) => TitanCompanyExecutionContext;

export const normalizeCompatibilityCompanyInput = normalizeCompatibilityCompanyInputRaw as (
  input: TitanCompanyContextInput,
  options?: { allowLegacyAliases?: boolean },
) => Readonly<TitanCompanyContextInput & { company_id: string }>;

export const assertCompanyBoundaryMatch = assertCompanyBoundaryMatchRaw as (
  expectedCompanyId: string,
  candidate: Record<string, unknown>,
  stage?: string,
) => string;

export const bindCompanyBoundary = bindCompanyBoundaryRaw as <T extends Record<string, unknown>>(
  context: TitanCompanyExecutionContext,
  stage: "authorization" | "storage" | "projection" | "decision" | "execution",
  payload: T & { company_id: string },
) => Readonly<T & { company_id: string; company_boundary_stage: string }>;

export {
  createZeroInteraction,
  ZERO_INTERACTION_SCHEMA,
} from "./ported/titan-runtime/interaction-engine/zero-interaction.js";

export {
  createDecisionEngineEnvelope,
  runtimeDescriptor as decisionEngineDescriptor,
  RUNTIME_ID as DECISION_ENGINE_RUNTIME_ID,
} from "./ported/titan-runtime/decision-engine/index.js";

export {
  createVisualRuntimeEnvelope,
  negotiateVisualCapabilities,
  planVisualFallback,
  planVisualRuntime,
  planVisualStateTransition,
  resolveVisualContribution,
  resolveVisualResource,
  runtimeDescriptor as visualRuntimeDescriptor,
  RUNTIME_ID as VISUAL_RUNTIME_ID,
  VISUAL_TENANT_BOUNDARY,
  SUPPORTED_VISUAL_SURFACES,
} from "./ported/titan-runtime/visual-runtime/index.js";
export type {
  VisualSurface,
  VisualState,
  VisualEnvironment,
  VisualPreferences,
  VisualRequest,
  VisualCapabilitySupport,
  VisualNegotiation,
  VisualFallbackPlan,
  VisualPlan,
  VisualContribution,
  VisualResource,
} from "./ported/titan-runtime/visual-runtime/index.js";
export {
  DEFAULT_VISUAL_CAPABILITIES,
  VISUAL_METADATA_CONTRACT_VERSION,
  VISUAL_METADATA_SCHEMA_SHA256,
  defaultVisualCapabilitySupport,
  planVisualCapabilityDegradation,
  assertVisualMetadataCompatible,
  validateVisualMetadata,
  negotiateVisualRuntimeCompatibility,
  planVisualOfflineCache,
  evaluateVisualResourceFreshness,
  verifyVisualResourceIntegrity,
  getVisualRuntimeHealth,
  type VisualCacheResource,
} from "./ported/titan-runtime/visual-runtime/index.js";
export {
  compareVisualContributionVersions,
  VisualContributionRegistry,
  snapshotVisualContributions,
  VisualResourceRegistry,
  VISUAL_MOTION_PRESETS,
  VISUAL_TRANSITION_PRESETS,
  VISUAL_TREATMENTS,
  type RegisteredVisualContribution,
  type VisualResourceDefinition,
} from "./ported/titan-runtime/visual-runtime/index.js";
export { VISUAL_RUNTIME_PACKAGE_MANIFEST, VISUAL_SUITE_COMPATIBILITY, validateVisualRuntimePackageManifest, validateVisualContributionSchema, sanitizeVisualBrowserMetadata, detectVisualBrowserEnvironment, applyVisualBrowserPlan, assertVisualInterfaceBridgeCompatibility } from "./ported/titan-runtime/visual-runtime/index.js";

export * from './interface-runtime.js';

export {
  createPrimeEnvelope,
  runtimeDescriptor as primeRuntimeDescriptor,
  RUNTIME_ID as PRIME_RUNTIME_ID,
} from "./ported/titan-runtime/prime/index.js";
