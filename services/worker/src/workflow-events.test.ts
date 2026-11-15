import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client } from "pg";

vi.mock("./notification/enqueue.js", () => ({
  cancelNotificationsForEntity: vi.fn().mockResolvedValue(1),
}));

import { cancelNotificationsForEntity } from "./notification/enqueue.js";
import { processWorkflowEvents } from "./workflow-events.js";

const ACCOUNT_A = "11111111-1111-1111-1111-111111111111";
const ENTITY = "22222222-2222-2222-2222-222222222222";

describe("processWorkflowEvents", () => {
  beforeEach(() => {
    vi.mocked(cancelNotificationsForEntity).mockClear();
  });

  it("cancels only within the event's account", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "evt-1",
            account_id: ACCOUNT_A,
            event_type: "invoice.paid",
            entity_type: "job",
            entity_id: ENTITY,
            payload: {},
          },
        ],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query } as unknown as Client;

    const processed = await processWorkflowEvents(client);

    expect(processed).toBe(1);
    expect(cancelNotificationsForEntity).toHaveBeenCalledWith(
      client,
      "job",
      ENTITY,
      "invoice.paid",
      ACCOUNT_A
    );
  });
});
