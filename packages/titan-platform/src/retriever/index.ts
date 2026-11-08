export {
  RETRIEVER_NATIVE_PROTOCOL,
  RETRIEVER_NATIVE_VERSION,
  RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
  type RetrieverNativeCapability,
  type RetrieverExecutionGateInput,
  type RetrieverCapabilityHello,
  type RetrieverNativeRequest,
  type RetrieverNativeHandlerInput,
  type RetrieverNativeHandler,
  type RetrieverNativeHandlers,
} from "./contracts.js";

export {
  RETRIEVER_NATIVE_EXECUTOR_SCHEMA,
  negotiateRetrieverNativeCapabilities,
  createRetrieverNativeExecutor,
} from "./executor.js";

export {
  RETRIEVER_NATIVE_LIFECYCLE_SCHEMA,
  RETRIEVER_LIFECYCLE_CHECKPOINT_SCHEMA,
  createRetrieverNativeLifecycle,
  type RetrieverLifecycleState,
  type RetrieverLifecycleRecord,
  type RetrieverLifecycleCheckpoint,
} from "./lifecycle.js";

export {
  RETRIEVER_NATIVE_SURFACE_BRIDGE_SCHEMA,
  RETRIEVER_NATIVE_SURFACE_TYPES,
  createRetrieverNativeSurfaceBridge,
  type RetrieverNativeSurfaceType,
  type RetrieverNativeSurfaceMessage,
} from "./surface-bridge.js";

export {
  RETRIEVER_DONOR_REFERENCE_POLICY,
  classifyRetrieverDonorReference,
  type RetrieverDonorReferenceClass,
} from "./donor-policy.js";

export {
  RETRIEVER_RECOVERY_SESSION_SCHEMA,
  RETRIEVER_RECOVERY_RESULT_SCHEMA,
  createRetrieverRecoverySession,
  classifyRetrieverRecoverySession,
  recoverRetrieverSession,
  createRetrieverReconnectPlan,
  type RetrieverRecoverySession,
} from "./recovery.js";

export {
  RETRIEVER_SEMANTIC_RETIREMENT_SCHEMA,
  evaluateRetrieverSemanticRetirement,
  buildRetrieverSemanticRetirementLedger,
} from "./semantic-retirement.js";
