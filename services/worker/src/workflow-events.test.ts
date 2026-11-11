import { describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import { processWorkflowEvents } from "./workflow-events.js";

type EventRow = {
  id: string;
  account_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
};

function event(accountId: string, eventType = "invoice.paid"): EventRow {
  return {
    id: `event-${accountId}`,
    account_id: accountId,
    event_type: eventType,
    entity_type: "invoice",
    entity_id: "invoice-1",
    payload: {},
  };
}

function clientWithEvents(rows: EventRow[], failCancel = false) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("FROM workflow_events")) return { rows };
      if (sql.includes("UPDATE notification_queue")) {
        if (failCancel) throw new Error("cancellation unavailable");
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    }),
  } as unknown as Client;
  return { client, calls };
}

describe("workflow-event notification cancellation", () => {
  it("passes each event's company ID to the cancellation query", async () => {
    const { client, calls } = clientWithEvents([
      event("company-a"), event("company-b"),
    ]);
    expect(await processWorkflowEvents(client)).toBe(2);
    const cancels = calls.filter(call => call.sql.includes("UPDATE notification_queue"));
    expect(cancels).toHaveLength(2);
    expect(cancels[0].params).toEqual(["company-a", "invoice", "invoice-1", "invoice.paid"]);
    expect(cancels[1].params).toEqual(["company-b", "invoice", "invoice-1", "invoice.paid"]);
    for (const cancel of cancels) {
      expect(cancel.sql).toContain("WHERE account_id = $1::uuid");
      expect(cancel.sql).toContain("AND status      = 'pending'");
    }
    expect(calls.filter(call => call.sql.includes("UPDATE workflow_events"))).toHaveLength(2);
  });

  it("does not cancel notifications for unrelated workflow-event types", async () => {
    const { client, calls } = clientWithEvents([event("company-a", "invoice.created")]);
    expect(await processWorkflowEvents(client)).toBe(1);
    expect(calls.some(call => call.sql.includes("UPDATE notification_queue"))).toBe(false);
    expect(calls.some(call => call.sql.includes("UPDATE workflow_events"))).toBe(true);
  });

  it("does not acknowledge an event when tenant-scoped cancellation fails", async () => {
    const { client, calls } = clientWithEvents([event("company-a")], true);
    expect(await processWorkflowEvents(client)).toBe(0);
    expect(calls.some(call => call.sql.includes("UPDATE notification_queue"))).toBe(true);
    expect(calls.some(call => call.sql.includes("UPDATE workflow_events"))).toBe(false);
  });
});
