export type ZeroDispatchEvent = {
  id: string;
  kind: string;
  conversation_id: string;
  company_id: string;
  surface: "zero";
  [key: string]: unknown;
};

export type ZeroRuntimeDispatchInput = {
  company_id: string;
  actor_id: string;
  conversation_id: string;
  interaction_id: string;
  client_message_id: string;
  text: string;
  correlation_id: string;
  requested_agent_id?: string;
  continuation_token?: string;
};

export type ZeroRuntimeDispatchResult = {
  accepted: true;
  events: ZeroDispatchEvent[];
  continuation_token?: string;
};

export interface ZeroRuntimeDispatcher {
  dispatch(input: ZeroRuntimeDispatchInput): Promise<ZeroRuntimeDispatchResult>;
}

let dispatcher: ZeroRuntimeDispatcher | undefined;

export function registerZeroRuntimeDispatcher(next: ZeroRuntimeDispatcher): void {
  dispatcher = next;
}

export function clearZeroRuntimeDispatcher(): void {
  dispatcher = undefined;
}

export async function dispatchZeroRuntime(input: ZeroRuntimeDispatchInput): Promise<ZeroRuntimeDispatchResult> {
  if (!dispatcher) {
    try {
      const { getProductionZeroRuntime } = await import("./production-runtime");
      return (await getProductionZeroRuntime()).dispatch(input);
    } catch (cause) {
      const error = new Error("zero-production-runtime-unavailable", { cause }) as Error & { code?: string };
      error.code = "ZERO_RUNTIME_UNAVAILABLE";
      throw error;
    }
  }
  return dispatcher.dispatch(input);
}
