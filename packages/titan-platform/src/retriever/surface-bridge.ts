import type { RetrieverExecutionGateInput } from "./contracts.js";
import { createRetrieverNativeLifecycle } from "./lifecycle.js";

export const RETRIEVER_NATIVE_SURFACE_BRIDGE_SCHEMA =
  "titan-zero-retriever-native-surface-bridge/v1";

export const RETRIEVER_NATIVE_SURFACE_TYPES = Object.freeze([
  "retriever.chat.submit",
  "retriever.workflow.progress",
  "retriever.workflow.complete",
  "retriever.workflow.cancel",
  "retriever.workflow.timeout",
  "retriever.surface.snapshot",
] as const);

export type RetrieverNativeSurfaceType =
  typeof RETRIEVER_NATIVE_SURFACE_TYPES[number];

type RetrieverLifecycle = ReturnType<typeof createRetrieverNativeLifecycle>;

export type RetrieverNativeSurfaceMessage = Readonly<{
  type: RetrieverNativeSurfaceType;
  company_id: string;
  tenant_id?: never;
  tenant_company_id?: never;
  work_id: string;
  correlation_id?: string;
  operation_id?: string;
  idempotency_key?: string;
  actor_id?: string | null;
  device_id?: string | null;
  payload?: unknown;
  execution_gate?: RetrieverExecutionGateInput;
}>;

const clean = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function rejectLegacyBoundary(input: object): void {
  if ("tenant_id" in input || "tenant_company_id" in input) {
    throw new TypeError("legacy tenant boundaries are not accepted by native Retriever surface bridge");
  }
}

function requireText(value: unknown, name: string): string {
  const result = clean(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

function requireGate(
  gate: RetrieverExecutionGateInput | undefined,
): RetrieverExecutionGateInput {
  if (!gate) throw new TypeError("execution_gate is required for Retriever mutations");
  return gate;
}

function surfaceFor(type: RetrieverNativeSurfaceType): "chat" | "workflow" | "side-panel-compatible" {
  if (type === "retriever.chat.submit") return "chat";
  if (type.startsWith("retriever.workflow.")) return "workflow";
  return "side-panel-compatible";
}

export function createRetrieverNativeSurfaceBridge(options: {
  lifecycle: RetrieverLifecycle;
}) {
  const lifecycle = options?.lifecycle;
  if (!lifecycle || typeof lifecycle.submit !== "function") {
    throw new TypeError("native Retriever lifecycle is required");
  }

  function descriptor() {
    return Object.freeze({
      schema: RETRIEVER_NATIVE_SURFACE_BRIDGE_SCHEMA,
      company_boundary: "company_id",
      supported_surfaces: Object.freeze([
        "chat",
        "workflow",
        "side-panel-compatible",
      ] as const),
      message_types: RETRIEVER_NATIVE_SURFACE_TYPES,
      browser_extension_required: false,
      donor_runtime_required: false,
      chrome_runtime_required: false,
      ui_replacement_required: false,
      identity_grants_authority: false,
      execution_authority: false,
    });
  }

  async function handle(message: RetrieverNativeSurfaceMessage) {
    if (!message || typeof message !== "object") {
      throw new TypeError("Retriever surface message must be an object");
    }
    rejectLegacyBoundary(message);
    if (!RETRIEVER_NATIVE_SURFACE_TYPES.includes(message.type)) {
      throw new TypeError(`unsupported Retriever surface message type: ${String(message.type)}`);
    }

    const company_id = requireText(message.company_id, "company_id");
    const work_id = requireText(message.work_id, "work_id");
    const surface = surfaceFor(message.type);

    if (message.type === "retriever.surface.snapshot") {
      const record = lifecycle.get({ company_id, work_id });
      return Object.freeze({
        schema: RETRIEVER_NATIVE_SURFACE_BRIDGE_SCHEMA,
        type: message.type,
        surface,
        company_id,
        work_id,
        state: record.state,
        revision: record.revision,
        record,
        authority_required: false,
        execution_authority: false,
        identity_grants_authority: false,
      });
    }

    const execution_gate = requireGate(message.execution_gate);
    const common = {
      company_id,
      work_id,
      correlation_id: clean(message.correlation_id) ?? undefined,
      operation_id: clean(message.operation_id) ?? undefined,
      idempotency_key: clean(message.idempotency_key) ?? undefined,
      actor_id: message.actor_id ?? null,
      device_id: message.device_id ?? null,
      execution_gate,
      payload: message.payload ?? null,
      source: `titan-retriever-surface:${surface}`,
    };

    let record;
    switch (message.type) {
      case "retriever.chat.submit":
        record = await lifecycle.submit(common);
        break;
      case "retriever.workflow.progress":
        record = await lifecycle.progress(common);
        break;
      case "retriever.workflow.complete":
        record = await lifecycle.complete(common);
        break;
      case "retriever.workflow.cancel":
        record = await lifecycle.cancel(common);
        break;
      case "retriever.workflow.timeout":
        record = await lifecycle.timeout(common);
        break;
      default:
        throw new TypeError(`unsupported Retriever surface message type: ${String(message.type)}`);
    }

    return Object.freeze({
      schema: RETRIEVER_NATIVE_SURFACE_BRIDGE_SCHEMA,
      type: message.type,
      surface,
      company_id,
      work_id,
      state: record.state,
      revision: record.revision,
      record,
      authority_required: true,
      external_authority_consumed: true,
      execution_authority: false,
      identity_grants_authority: false,
    });
  }

  return Object.freeze({
    descriptor,
    handle,
  });
}
