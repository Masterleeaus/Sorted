import { describe, expect, it, vi } from "vitest";
import { emailIdempotencyBucket, enqueueAttentionOwnerEmail } from "../email";
import type { PoolClient } from "pg";
import { ATTENTION_EMAIL_TYPES, ATTENTION_EVENT_TYPES } from "../types";

describe("emailIdempotencyBucket", () => {
  it("floors to 15-minute UTC buckets", () => {
    // 2026-08-03T12:07:30Z → floor to 12:00
    const a = emailIdempotencyBucket(new Date("2026-08-03T12:07:30.000Z"));
    const b = emailIdempotencyBucket(new Date("2026-08-03T12:14:59.000Z"));
    const c = emailIdempotencyBucket(new Date("2026-08-03T12:15:00.000Z"));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    // consecutive buckets differ by 1
    expect(Number(c) - Number(a)).toBe(1);
  });
});

describe("ATTENTION_EMAIL_TYPES", () => {
  it("emails high-signal types only (not partial, not opens spam)", () => {
    expect(ATTENTION_EMAIL_TYPES).toContain("invoice.opened");
    expect(ATTENTION_EMAIL_TYPES).toContain("invoice.paid");
    expect(ATTENTION_EMAIL_TYPES).toContain("estimate.approved");
    expect(ATTENTION_EMAIL_TYPES).toContain("estimate.declined");
    expect(ATTENTION_EMAIL_TYPES as readonly string[]).not.toContain("invoice.partial");
    expect(ATTENTION_EMAIL_TYPES as readonly string[]).not.toContain("estimate.opened");
    expect(ATTENTION_EMAIL_TYPES as readonly string[]).not.toContain("booking_request.created");
  });

  it("only includes known event types", () => {
    for (const t of ATTENTION_EMAIL_TYPES) {
      expect(ATTENTION_EVENT_TYPES as readonly string[]).toContain(t);
    }
  });
});

describe("Sorted Field operational email identity", () => {
  it("brands owner alerts without changing their account scope or idempotency envelope", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[]) => {
        statements.push({ sql, values });
        if (sql.includes("FROM users")) return { rows: [{ email: "owner@example.test", full_name: "Owner" }] };
        if (sql.includes("FROM notification_queue")) return { rows: [] };
        if (sql.includes("INSERT INTO notification_queue")) return { rows: [{ id: "queue-1" }] };
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    const outcome = await enqueueAttentionOwnerEmail(client, {
      accountId: "account-a",
      type: "invoice.paid",
      entityType: "invoice",
      entityId: "invoice-123",
      title: "Invoice paid",
      summary: "Payment received",
      href: "/app/invoices/invoice-123",
    });
    expect(outcome).toBe("enqueued");
    const inserted = statements.find((entry) => entry.sql.includes("INSERT INTO notification_queue"));
    expect(inserted).toBeDefined();
    expect(inserted!.values[0]).toBe("account-a");
    expect(inserted!.values[3]).toBe("[Sorted Field] Invoice paid");
    expect(inserted!.values[4]).toContain("needs attention in Sorted Field.");
    expect(inserted!.values[4]).not.toContain("Dovetails");
    expect(inserted!.values[5]).toMatch(/^attention-email:v2:account-a:invoice.paid:invoice-123:/);
    expect(inserted!.values[7]).toBe("invoice-123");
  });
  it("scopes identical invoice events to separate accounts without idempotency collisions", async () => {
    const keys: string[] = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[]) => {
        if (sql.includes("FROM users")) return { rows: [{ email: "owner@example.test" }] };
        if (sql.includes("FROM notification_queue")) return { rows: [] };
        if (sql.includes("INSERT INTO notification_queue")) {
          keys.push(String(values[5]));
          return { rows: [{ id: `queue-${keys.length}` }] };
        }
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    for (const accountId of ["company-a", "company-b"]) {
      expect(await enqueueAttentionOwnerEmail(client, {
        accountId, type: "invoice.paid", entityType: "invoice", entityId: "same-id",
        title: "Invoice paid", href: "/app/invoices/same-id",
      })).toBe("enqueued");
    }
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toContain(":company-a:");
    expect(keys[1]).toContain(":company-b:");
  });

  it("rejects unsafe owner-alert links and stores only the sanitized destination", async () => {
    const unsafe = ["//external.example/phish", "/\\external.example", "/app\" onclick=\"alert(1)", "https://external.example"];
    for (const href of unsafe) {
      const queries: Array<{ sql: string; values: unknown[] }> = [];
      const client = {
        query: vi.fn(async (sql: string, values: unknown[]) => {
          queries.push({ sql, values });
          if (sql.includes("FROM users")) return { rows: [{ email: "owner@example.test" }] };
          if (sql.includes("INSERT INTO notification_queue")) return { rows: [{ id: "queue-1" }] };
          return { rows: [] };
        }),
      } as unknown as PoolClient;
      const outcome = await enqueueAttentionOwnerEmail(client, {
        accountId: "company-a", type: "invoice.paid", entityType: "invoice",
        entityId: "inv-1", title: "Invoice paid", href,
      });
      expect(outcome).toBe("enqueued");
      const insert = queries.find(q => q.sql.includes("INSERT INTO notification_queue"))!;
      expect(insert.values[4]).toContain('href="http://localhost:3000/app"');
      expect(JSON.parse(String(insert.values[8]))).toEqual({
        attentionType: "invoice.paid", href: "/app",
      });
    }
  });

  it("requeues failed owner notifications with fresh delivery state and never resets sent rows", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM users")) return { rows: [{ email: "owner@example.test" }] };
        if (sql.includes("FROM notification_queue")) return { rows: [{ status: "failed" }] };
        if (sql.includes("INSERT INTO notification_queue")) return { rows: [{ id: "queue-1" }] };
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    expect(await enqueueAttentionOwnerEmail(client, {
      accountId: "company-a", type: "invoice.paid", entityType: "invoice",
      entityId: "invoice-1", title: "Paid", href: "/app/invoices/invoice-1",
    })).toBe("enqueued");
    const upsert = statements.find(s => s.includes("INSERT INTO notification_queue"))!;
    expect(upsert).toContain("ON CONFLICT (idempotency_key) DO UPDATE");
    expect(upsert).toContain("attempt_count = 0");
    expect(upsert).toContain("failed_at = NULL");
    expect(upsert).toContain("WHERE notification_queue.status = 'failed'");
    expect(upsert).toContain("notification_queue.account_id = EXCLUDED.account_id");
    expect(upsert).toContain("RETURNING id");
  });

  it("reports duplicate when another enqueue wins the race", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM users")) return { rows: [{ email: "owner@example.test" }] };
        if (sql.includes("FROM notification_queue")) return { rows: [] };
        // A conflicting non-failed row makes the conditional upsert return nothing.
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    expect(await enqueueAttentionOwnerEmail(client, {
      accountId: "company-a", type: "invoice.paid", entityType: "invoice",
      entityId: "invoice-1", title: "Paid", href: "/app/invoices/invoice-1",
    })).toBe("duplicate");
  });

});
