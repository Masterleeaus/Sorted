import { describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import { enqueueNotification, cancelNotificationsForEntity } from "./enqueue.js";

const base = {
  accountId: "account-a",
  clientId: null,
  automationType: "invoice.followup",
  priority: 30,
  toAddress: "owner@example.test",
  subject: "Invoice update",
  htmlBody: "<p>Invoice update</p>",
  idempotencyKey: "invoice:account-a:invoice-1",
};

function makeClient(existingStatus: string | null, upsertRows: Array<{ id: string }>) {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("SELECT status FROM notification_queue")) {
        return { rows: existingStatus ? [{ status: existingStatus }] : [] };
      }
      if (sql.includes("INSERT INTO notification_queue")) return { rows: upsertRows };
      return { rows: [] };
    }),
  } as unknown as Client;
  return { client, queries };
}

describe("worker notification enqueue ownership and retry", () => {
  it("inserts new notifications and constrains a racing upsert to failed same-account rows", async () => {
    const { client, queries } = makeClient(null, [{ id: "queued" }]);
    expect(await enqueueNotification(client, base)).toBe("enqueued");
    const insert = queries.find(q => q.sql.includes("INSERT INTO notification_queue"))!;
    expect(insert.sql).toContain("WHERE notification_queue.status = 'failed'");
    expect(insert.sql).toContain("notification_queue.account_id = EXCLUDED.account_id");
    expect(insert.sql).toContain("RETURNING id");
    expect(insert.params?.[0]).toBe("account-a");
    expect(insert.params?.[7]).toBe("invoice:account-a:invoice-1");
  });

  it("requeues a failed message and clears old delivery attempts and failure timestamps", async () => {
    const { client, queries } = makeClient("failed", [{ id: "previous" }]);
    expect(await enqueueNotification(client, base)).toBe("enqueued");
    const sql = queries.find(q => q.sql.includes("INSERT INTO notification_queue"))!.sql;
    for (const expected of ["attempt_count   = 0", "failed_at       = NULL",
      "sent_at         = NULL", "failure_reason  = NULL", "status          = 'pending'"]) {
      expect(sql).toContain(expected);
    }
  });

  it("does not alter an already-sent notification", async () => {
    const { client, queries } = makeClient("sent", []);
    expect(await enqueueNotification(client, base)).toBe("duplicate");
    expect(queries.some(q => q.sql.includes("INSERT INTO notification_queue"))).toBe(false);
  });

  it("reports concurrent duplicates rather than falsely claiming they were enqueued", async () => {
    const { client, queries } = makeClient(null, []);
    expect(await enqueueNotification(client, base)).toBe("duplicate");
    expect(queries.some(q => q.sql.includes("INSERT INTO notification_queue"))).toBe(true);
  });

  it("does not update an existing row belonging to another account", async () => {
    const { client, queries } = makeClient("failed", []);
    expect(await enqueueNotification(client, {
      ...base, accountId: "account-b", idempotencyKey: "shared-key",
    })).toBe("duplicate");
    const sql = queries.find(q => q.sql.includes("INSERT INTO notification_queue"))!.sql;
    expect(sql).toContain("notification_queue.account_id = EXCLUDED.account_id");
  });
  it("cancels only a company's pending notifications for the specified entity and event", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 2 };
      }),
    } as unknown as Client;
    const count = await cancelNotificationsForEntity(
      client, "account-a", "invoice", "invoice-1", "invoice.paid",
    );
    expect(count).toBe(2);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual(["account-a", "invoice", "invoice-1", "invoice.paid"]);
    expect(queries[0].sql).toContain("WHERE account_id = $1::uuid");
    expect(queries[0].sql).toContain("AND entity_id   = $3::uuid");
    expect(queries[0].sql).toContain("AND status      = 'pending'");
    expect(queries[0].sql).toContain("AND $4 = ANY(cancel_on_events)");
  });

  it("does not report cancelled messages when the tenant-scoped update matches nothing", async () => {
    const client = {
      query: vi.fn(async () => ({ rowCount: 0 })),
    } as unknown as Client;
    expect(await cancelNotificationsForEntity(
      client, "account-b", "invoice", "invoice-1", "invoice.paid",
    )).toBe(0);
  });

});
