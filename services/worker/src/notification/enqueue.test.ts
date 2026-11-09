import { describe, it, expect, vi } from "vitest";
import type { Client } from "pg";
import { enqueueNotification, cancelNotificationsForEntity } from "./enqueue.js";
import { PRIORITY } from "./priority.js";

const ACCOUNT_A = "11111111-1111-1111-1111-111111111111";
const ENTITY = "22222222-2222-2222-2222-222222222222";

function mockClient() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  return { client: { query } as unknown as Client, query };
}

const OPTS = {
  accountId: ACCOUNT_A,
  clientId: null,
  automationType: "review_request",
  priority: PRIORITY.LOW,
  toAddress: "client@example.com",
  subject: "s",
  htmlBody: "<p>b</p>",
  idempotencyKey: "review_request:job-1",
};

describe("enqueueNotification account scoping", () => {
  it("looks up the idempotency key within the account", async () => {
    const { client, query } = mockClient();
    await enqueueNotification(client, OPTS);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("account_id");
    expect(params).toEqual([ACCOUNT_A, "review_request:job-1"]);
  });

  it("upserts on the account-scoped unique key", async () => {
    const { client, query } = mockClient();
    await enqueueNotification(client, OPTS);

    const insert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO notification_queue"));
    expect(insert?.[0]).toContain("ON CONFLICT (account_id, idempotency_key)");
  });
});

describe("cancelNotificationsForEntity account scoping", () => {
  it("passes the account and filters on it", async () => {
    const { client, query } = mockClient();
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const cancelled = await cancelNotificationsForEntity(client, "job", ENTITY, "invoice.paid", ACCOUNT_A);

    expect(cancelled).toBe(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("account_id  = $4");
    expect(params).toEqual(["job", ENTITY, "invoice.paid", ACCOUNT_A]);
  });
});
