import { afterEach, describe, expect, it } from "vitest";
import {
  clearZeroRuntimeDispatcher,
  dispatchZeroRuntime,
  registerZeroRuntimeDispatcher,
  type ZeroRuntimeDispatchInput,
} from "./runtime-dispatch";

afterEach(() => clearZeroRuntimeDispatcher());

describe("Zero runtime dispatch boundary", () => {
  it("fails closed when production composition is not registered", async () => {
    await expect(
      dispatchZeroRuntime({
        company_id: "company-1",
        actor_id: "one-1",
        conversation_id: "conversation-1",
        interaction_id: "interaction-1",
        client_message_id: "message-1",
        text: "Reschedule tomorrow's first job",
        correlation_id: "correlation-1",
      }),
    ).rejects.toMatchObject({ code: "ZERO_RUNTIME_UNAVAILABLE" });
  });

  it("preserves requested worker and continuation identity across the production seam", async () => {
    let received: ZeroRuntimeDispatchInput | undefined;
    registerZeroRuntimeDispatcher({
      async dispatch(input) {
        received = input;
        return { accepted: true, events: [], continuation_token: input.continuation_token };
      },
    });

    const input: ZeroRuntimeDispatchInput = {
      company_id: "company-1",
      actor_id: "one-1",
      conversation_id: "conversation-1",
      interaction_id: "interaction-1",
      client_message_id: "message-1",
      text: "Continue the approval",
      correlation_id: "correlation-1",
      requested_agent_id: "dispatch-agent",
      continuation_token: "run-123",
    };

    const result = await dispatchZeroRuntime(input);

    expect(received).toEqual(input);
    expect(result.continuation_token).toBe("run-123");
  });
});
