export const RETRIEVER_NATIVE_PROTOCOL = "titan.retriever.native";
export const RETRIEVER_NATIVE_VERSION = "1.0";

export const RETRIEVER_NATIVE_DEFAULT_CAPABILITIES = Object.freeze([
  "work_submission",
  "progress_observation",
  "result_delivery",
  "cancellation",
] as const);

export type RetrieverNativeCapability = typeof RETRIEVER_NATIVE_DEFAULT_CAPABILITIES[number];

export type RetrieverExecutionGateInput = Readonly<{
  company_id: string;
  execution_allowed: true;
  decision_id: string;
  authority_source: string;
  policy_version: string;
  approval_state?: string;
  identity_only?: boolean;
  ai_identity_granted?: boolean;
}>;

export type RetrieverCapabilityHello = Readonly<{
  runtime: string;
  version: string;
  capabilities: readonly string[];
}>;

export type RetrieverNativeRequest = Readonly<{
  company_id: string;
  tenant_id?: never;
  tenant_company_id?: never;
  capability: RetrieverNativeCapability;
  work_id: string;
  correlation_id?: string;
  operation_id?: string;
  idempotency_key?: string;
  actor_id?: string | null;
  device_id?: string | null;
  source?: string;
  payload?: unknown;
  context?: Readonly<Record<string, unknown>>;
  execution_gate: RetrieverExecutionGateInput;
}>;

export type RetrieverNativeHandlerInput = Readonly<{
  protocol: typeof RETRIEVER_NATIVE_PROTOCOL;
  version: typeof RETRIEVER_NATIVE_VERSION;
  capability: RetrieverNativeCapability;
  work_id: string;
  correlation_id: string | null;
  operation_id: string | null;
  idempotency_key: string | null;
  context: Readonly<{
    company_id: string;
    actor_id: string | null;
    device_id: string | null;
    correlation_id: string | null;
    operation_id: string | null;
    source: string;
  }>;
  payload: unknown;
  gate: Readonly<{
    company_id: string;
    execution_allowed: true;
    decision_id: string;
    authority_source: string;
    policy_version: string;
    approval_state: string;
    externally_authorized: true;
  }>;
  authority: Readonly<{
    external_authority_consumed: true;
    identity_grants_authority: false;
    executor_grants_authority: false;
    execution_authority: false;
  }>;
}>;

export type RetrieverNativeHandler = (
  input: RetrieverNativeHandlerInput,
) => Promise<unknown> | unknown;

export type RetrieverNativeHandlers = Partial<
  Record<RetrieverNativeCapability, RetrieverNativeHandler>
>;
