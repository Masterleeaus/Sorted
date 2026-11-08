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
    expect(inserted!.values[5]).toMatch(/^attention-email:invoice.paid:invoice-123:/);
    expect(inserted!.values[7]).toBe("invoice-123");
  });
});
