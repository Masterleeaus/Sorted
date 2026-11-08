import { describe, expect, it, vi } from "vitest";
import { ZeroWorkforceDispatcher, type ZeroWorkforceDispatchPort } from "./workforce-dispatcher";

const input = {
  company_id: "company-1",
  actor_id: "one-1",
  conversation_id: "conversation-1",
  interaction_id: "interaction-1",
  client_message_id: "message-1",
  text: "Emma is sick tomorrow. Sort it out.",
  correlation_id: "correlation-1",
};

describe("ZeroWorkforceDispatcher", () => {
  it("creates company-scoped work through the workforce port instead of executing directly", async () => {
    const create = vi.fn(async (work) => ({ company_id: work.company_id, work_id: work.work_id, state: "READY" as const, assignee: work.assignee }));
    const workforce: ZeroWorkforceDispatchPort = { create, resume: vi.fn() };
    const dispatcher = new ZeroWorkforceDispatcher(workforce, () => "dispatch-agent");

    const result = await dispatcher.dispatch(input);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      company_id: "company-1",
      creator: "one-1",
      assignee: "dispatch-agent",
      objective: input.text,
      origin: expect.objectContaining({ conversation_id: "conversation-1", surface: "zero", correlation_id: "correlation-1" }),
    }));
    expect(result.continuation_token).toBe("zero:interaction-1");
    expect(result.events[0]).toMatchObject({ kind: "work.accepted", company_id: "company-1", conversation_id: "conversation-1" });
  });

  it("resumes existing work when a continuation token is supplied", async () => {
    const resume = vi.fn(async (company_id: string, work_id: string) => ({ company_id, work_id, state: "READY" as const, assignee: "dispatch-agent" }));
    const workforce: ZeroWorkforceDispatchPort = { create: vi.fn(), resume };
    const dispatcher = new ZeroWorkforceDispatcher(workforce, () => "dispatch-agent");

    const result = await dispatcher.dispatch({ ...input, continuation_token: "work-existing", requested_agent_id: "dispatch-agent" });

    expect(resume).toHaveBeenCalledWith("company-1", "work-existing", "one-1");
    expect(workforce.create).not.toHaveBeenCalled();
    expect(result.continuation_token).toBe("work-existing");
  });

  it("fails closed when the workforce response crosses company or work boundaries", async () => {
    const workforce: ZeroWorkforceDispatchPort = {
      create: vi.fn(async () => ({ company_id: "company-2", work_id: "zero:interaction-1", state: "READY" })),
      resume: vi.fn(),
    };
    const dispatcher = new ZeroWorkforceDispatcher(workforce, () => "dispatch-agent");

    await expect(dispatcher.dispatch(input)).rejects.toThrow("zero-workforce-boundary-mismatch");
  });
});
