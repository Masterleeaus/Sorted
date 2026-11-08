import {
  createCompanyExecutionContext,
  type TitanCompanyExecutionContext,
} from "../runtime.js";
import {
  negotiateAdapterCapabilities,
  negotiateAdapterVersion,
} from "../ported/titan-runtime/adapters/execution-adapter-protocol.js";
import {
  validateExternalExecutionGate,
} from "../ported/titan-runtime/adapters/work-runtime-adapter.js";
import {
  RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
  RETRIEVER_NATIVE_PROTOCOL,
  RETRIEVER_NATIVE_VERSION,
  type RetrieverCapabilityHello,
  type RetrieverNativeCapability,
  type RetrieverNativeHandlerInput,
  type RetrieverNativeHandlers,
  type RetrieverNativeRequest,
} from "./contracts.js";

export const RETRIEVER_NATIVE_EXECUTOR_SCHEMA = "titan-zero-retriever-native-executor/v1";

const clean = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function rejectLegacyBoundary(input: object): void {
  if ("tenant_id" in input || "tenant_company_id" in input) {
    throw new TypeError("legacy tenant boundaries are not accepted by native Retriever");
  }
}

function normalizeCapability(value: unknown): RetrieverNativeCapability {
  const capability = clean(value);
  if (!capability || !RETRIEVER_NATIVE_DEFAULT_CAPABILITIES.includes(
    capability as RetrieverNativeCapability,
  )) {
    throw new TypeError(`unsupported native Retriever capability: ${capability ?? "missing"}`);
  }
  return capability as RetrieverNativeCapability;
}

function requireWorkId(value: unknown): string {
  const workId = clean(value);
  if (!workId) throw new TypeError("Retriever work_id is required");
  return workId;
}

function assertCompanyGate(
  context: TitanCompanyExecutionContext,
  input: RetrieverNativeRequest,
) {
  const gate = validateExternalExecutionGate(input.execution_gate);
  if (gate.company_id !== context.company_id) {
    throw new TypeError("execution gate company_id must match Retriever company_id");
  }
  return gate;
}

export function negotiateRetrieverNativeCapabilities(
  remote: RetrieverCapabilityHello,
  localCapabilities: readonly RetrieverNativeCapability[] = RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
) {
  const runtime = clean(remote?.runtime);
  if (!runtime || runtime.toLowerCase() !== "retriever") {
    return Object.freeze({
      schema: "titan-zero-retriever-native-negotiation/v1",
      compatible: false,
      selected_version: null,
      capabilities: Object.freeze([] as string[]),
      error: Object.freeze({ code: "RETRIEVER_RUNTIME_INCOMPATIBLE", retryable: false }),
      fail_closed: true,
      execution_authority: false,
      capability_negotiation_grants_authority: false,
    });
  }

  const version = negotiateAdapterVersion(RETRIEVER_NATIVE_VERSION, remote.version);
  if (!version.compatible) {
    return Object.freeze({
      schema: "titan-zero-retriever-native-negotiation/v1",
      compatible: false,
      selected_version: null,
      capabilities: Object.freeze([] as string[]),
      error: version.error,
      fail_closed: true,
      execution_authority: false,
      capability_negotiation_grants_authority: false,
    });
  }

  const capabilities = negotiateAdapterCapabilities(localCapabilities, remote.capabilities);
  return Object.freeze({
    schema: "titan-zero-retriever-native-negotiation/v1",
    compatible: true,
    selected_version: version.selected_version,
    capabilities,
    error: null,
    fail_closed: false,
    execution_authority: false,
    capability_negotiation_grants_authority: false,
  });
}

export function createRetrieverNativeExecutor(options: {
  handlers?: RetrieverNativeHandlers;
  capabilities?: readonly RetrieverNativeCapability[];
} = {}) {
  const handlers: RetrieverNativeHandlers = Object.freeze({ ...(options.handlers ?? {}) });
  const capabilities = Object.freeze([
    ...new Set(options.capabilities ?? RETRIEVER_NATIVE_DEFAULT_CAPABILITIES),
  ]);

  function descriptor() {
    return Object.freeze({
      schema: RETRIEVER_NATIVE_EXECUTOR_SCHEMA,
      protocol: RETRIEVER_NATIVE_PROTOCOL,
      runtime: "Retriever",
      version: RETRIEVER_NATIVE_VERSION,
      capabilities,
      company_boundary: "company_id",
      device_first: true,
      native_only: true,
      donor_runtime_required: false,
      identity_grants_authority: false,
      capability_negotiation_grants_authority: false,
      executor_grants_authority: false,
      execution_authority: false,
    });
  }

  function negotiate(remote: RetrieverCapabilityHello) {
    return negotiateRetrieverNativeCapabilities(remote, capabilities);
  }

  function prepare(input: RetrieverNativeRequest): RetrieverNativeHandlerInput {
    if (!input || typeof input !== "object") {
      throw new TypeError("native Retriever request must be an object");
    }
    rejectLegacyBoundary(input);
    const capability = normalizeCapability(input.capability);
    if (!capabilities.includes(capability)) {
      throw new TypeError(`native Retriever capability is not enabled: ${capability}`);
    }
    const handler = handlers[capability];
    if (typeof handler !== "function") {
      throw new TypeError(`native handler is not available for capability: ${capability}`);
    }

    const context = createCompanyExecutionContext({
      company_id: input.company_id,
      actor_id: input.actor_id ?? null,
      device_id: input.device_id ?? null,
      correlation_id: clean(input.correlation_id),
      operation_id: clean(input.operation_id),
      source: clean(input.source) ?? "titan-retriever-native",
    });
    const gate = assertCompanyGate(context, input);
    const work_id = requireWorkId(input.work_id);

    return Object.freeze({
      protocol: RETRIEVER_NATIVE_PROTOCOL,
      version: RETRIEVER_NATIVE_VERSION,
      capability,
      work_id,
      correlation_id: clean(input.correlation_id),
      operation_id: clean(input.operation_id),
      idempotency_key: clean(input.idempotency_key),
      context,
      payload: input.payload ?? null,
      gate,
      authority: Object.freeze({
        external_authority_consumed: true,
        identity_grants_authority: false,
        executor_grants_authority: false,
        execution_authority: false,
      }),
    });
  }

  async function execute(input: RetrieverNativeRequest) {
    const prepared = prepare(input);
    const handler = handlers[prepared.capability];
    if (typeof handler !== "function") {
      throw new TypeError(`native handler is not available for capability: ${prepared.capability}`);
    }
    const receipt = await handler(prepared);
    return Object.freeze({
      schema: "titan-zero-retriever-native-execution-receipt/v1",
      protocol: RETRIEVER_NATIVE_PROTOCOL,
      version: RETRIEVER_NATIVE_VERSION,
      company_id: prepared.context.company_id,
      work_id: prepared.work_id,
      capability: prepared.capability,
      correlation_id: prepared.correlation_id,
      operation_id: prepared.operation_id,
      idempotency_key: prepared.idempotency_key,
      transport_mode: "native_retriever",
      transport_performed: true,
      external_authority_consumed: true,
      executor_granted_authority: false,
      execution_authority: false,
      receipt: receipt ?? null,
    });
  }

  return Object.freeze({
    descriptor,
    negotiate,
    prepare,
    execute,
  });
}
