import { afterEach, describe, expect, it, vi } from "vitest";
import { createZeroHttpTransport } from "./zero-http-transport";

afterEach(() => vi.unstubAllGlobals());

describe("Zero HTTP transport", () => {
  it("posts canonical company and conversation scope", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ accepted: true, events: [] }), { status: 202, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createZeroHttpTransport("/api/v1/zero/interactions");

    await transport.send({
      company_id: "company-a",
      conversation_id: "conv-a",
      surface: "zero",
      text: "Emma is sick tomorrow. Sort it out.",
      client_message_id: "message-a",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      company_id: "company-a",
      conversation_id: "conv-a",
      surface: "zero",
      client_message_id: "message-a",
    });
  });

  it("surfaces fail-closed runtime unavailability", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Zero runtime is not available", code: "ZERO_RUNTIME_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } })));
    const transport = createZeroHttpTransport();

    await expect(transport.send({
      company_id: "company-a",
      conversation_id: "conv-a",
      surface: "zero",
      text: "Do it",
      client_message_id: "message-a",
    })).rejects.toMatchObject({ code: "ZERO_RUNTIME_UNAVAILABLE", status: 503 });
  });
});
