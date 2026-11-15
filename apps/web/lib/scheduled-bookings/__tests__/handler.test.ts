import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

vi.mock("../../work-orders/create-default", () => ({
  createDefaultWorkOrderForJob: vi.fn(async () => "wo-1"),
}));

import { handleScheduledBookingEvent, type EnabledScheduledBookingConfig } from "../handler";
import { canonicalJson, signEnvelope, verifyEnvelopeSignature } from "../envelope";
import { readScheduledBookingConfig } from "../config";

const SECRET = "test-route-secret-0123456789abcdefghij";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";
const JOB = "55555555-5555-4555-8555-555555555555";

const config: EnabledScheduledBookingConfig = {
  enabled: true,
  secret: SECRET,
  organisationId: TENANT,
  actorUserId: ACTOR,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    bookingId: "bk_1001",
    companyId: TENANT,
    occurredAt: "2026-11-15T01:00:00.000Z",
    serviceId: "svc_clean",
    staffIds: ["st_1"],
    startAt: "2026-11-20T09:00:00.000Z",
    endAt: "2026-11-20T11:00:00.000Z",
    timezone: "Australia/Melbourne",
    status: "confirmed",
    customerRef: "cus_abc123",
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}, key = "idem-1") {
  const unsigned: Record<string, unknown> = {
    eventId: "66666666-6666-4666-8666-666666666666",
    organisationId: TENANT,
    sourceProduct: "scheduled",
    eventType: "booking.created",
    schemaVersion: 1,
    correlationId: "corr-1",
    idempotencyKey: key,
    occurredAt: "2026-11-15T01:00:01.000Z",
    payload: payload(),
    ...overrides,
  };
  return { ...unsigned, signature: signEnvelope(unsigned, SECRET) };
}

/** In-memory stand-in for the tenant transaction. Recognises the statements the handler uses. */
function fakeTenant() {
  const receipts = new Set<string>();
  const links = new Map<string, { job_id: string; last_occurred_at: Date; status: string }>();
  const customers = new Map<string, string>([["cus_abc123", CLIENT]]);
  const jobs = new Map<string, string>();
  const writes: string[] = [];
  const tenantsSeen: string[] = [];

  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("INSERT INTO scheduled_booking_receipts")) {
        const key = `${params[0]}|${params[1]}`;
        if (receipts.has(key)) return { rows: [], rowCount: 0 };
        receipts.add(key);
        return { rows: [{ idempotency_key: params[1] }], rowCount: 1 };
      }
      if (sql.includes("FROM scheduled_booking_links") && sql.includes("FOR UPDATE")) {
        const link = links.get(String(params[1]));
        return { rows: link ? [link] : [], rowCount: link ? 1 : 0 };
      }
      if (sql.includes("FROM scheduled_customer_links")) {
        const clientId = customers.get(String(params[1]));
        return { rows: clientId ? [{ client_id: clientId }] : [], rowCount: clientId ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO jobs")) {
        const id = JOB;
        jobs.set(id, "draft");
        writes.push("jobs.insert");
        return { rows: [{ id }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO scheduled_booking_links")) {
        links.set(String(params[1]), {
          job_id: String(params[2]),
          status: String(params[3]),
          last_occurred_at: new Date(String(params[9])),
        });
        writes.push("links.upsert");
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE jobs")) {
        writes.push("jobs.cancel");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL in test: ${sql.slice(0, 60)}`);
    },
  } as unknown as PoolClient;

  const runInTenant = vi.fn(async (tenantId: string, fn: (c: PoolClient) => Promise<unknown>) => {
    tenantsSeen.push(tenantId);
    return fn(client);
  });

  return { runInTenant, receipts, links, jobs, writes, tenantsSeen };
}

function post(body: unknown) {
  return JSON.stringify(body);
}

describe("canonicalJson", () => {
  it("sorts keys at every depth with no whitespace, matching Central", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe("envelope signature", () => {
  it("rejects a bad signature and a malformed one", () => {
    const good = envelope();
    expect(verifyEnvelopeSignature(good, SECRET)).toBe(true);
    expect(verifyEnvelopeSignature({ ...good, signature: "0".repeat(64) }, SECRET)).toBe(false);
    expect(verifyEnvelopeSignature({ ...good, signature: "not-hex" }, SECRET)).toBe(false);
    expect(verifyEnvelopeSignature(good, "another-secret-another-secret-0000")).toBe(false);
  });

  it("rejects a valid signature when a signed field is altered", () => {
    const good = envelope();
    expect(verifyEnvelopeSignature({ ...good, correlationId: "tampered" }, SECRET)).toBe(false);
  });
});

describe("handleScheduledBookingEvent", () => {
  let tenant: ReturnType<typeof fakeTenant>;
  beforeEach(() => {
    tenant = fakeTenant();
  });

  it("rejects a bad signature before any tenant work", async () => {
    const bad = { ...envelope(), signature: "a".repeat(64) };
    const result = await handleScheduledBookingEvent({
      rawBody: post(bad),
      config,
      runInTenant: tenant.runInTenant,
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: { code: "bad_signature" } });
    expect(tenant.runInTenant).not.toHaveBeenCalled();
  });

  it("refuses a validly signed event for another tenant without writing", async () => {
    const foreign = envelope({ organisationId: OTHER_TENANT, payload: payload({ companyId: OTHER_TENANT }) });
    const result = await handleScheduledBookingEvent({
      rawBody: post(foreign),
      config,
      runInTenant: tenant.runInTenant,
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: "tenant_mismatch" } });
    expect(tenant.runInTenant).not.toHaveBeenCalled();
  });

  it("refuses a payload whose companyId differs from the envelope tenant", async () => {
    const mixed = envelope({ payload: payload({ companyId: OTHER_TENANT }) });
    const result = await handleScheduledBookingEvent({
      rawBody: post(mixed),
      config,
      runInTenant: tenant.runInTenant,
    });
    expect(result.status).toBe(403);
    expect(tenant.runInTenant).not.toHaveBeenCalled();
  });

  it("creates a job for a valid booking.created and records the receipt", async () => {
    const result = await handleScheduledBookingEvent({
      rawBody: post(envelope()),
      config,
      runInTenant: tenant.runInTenant,
    });
    expect(result).toEqual({ status: 200, body: { data: { outcome: "created" } } });
    expect(tenant.tenantsSeen).toEqual([TENANT]);
    expect(tenant.jobs.get(JOB)).toBe("draft");
    expect(tenant.links.get("bk_1001")?.job_id).toBe(JOB);
  });

  it("treats a duplicate event key as a no-op", async () => {
    const body = post(envelope({}, "idem-dup"));
    await handleScheduledBookingEvent({ rawBody: body, config, runInTenant: tenant.runInTenant });
    const writesAfterFirst = tenant.writes.length;
    const second = await handleScheduledBookingEvent({ rawBody: body, config, runInTenant: tenant.runInTenant });
    expect(second).toEqual({ status: 200, body: { data: { outcome: "duplicate" } } });
    expect(tenant.writes.length).toBe(writesAfterFirst);
  });

  it("cancels the linked job on booking.cancelled", async () => {
    await handleScheduledBookingEvent({ rawBody: post(envelope({}, "k-c")), config, runInTenant: tenant.runInTenant });
    const cancel = envelope(
      {
        eventType: "booking.cancelled",
        idempotencyKey: "k-x",
        occurredAt: "2026-11-15T02:00:00.000Z",
        payload: payload({ status: "cancelled", occurredAt: "2026-11-15T02:00:00.000Z" }),
      },
      "k-x",
    );
    const result = await handleScheduledBookingEvent({ rawBody: post(cancel), config, runInTenant: tenant.runInTenant });
    expect(result.body).toEqual({ data: { outcome: "cancelled" } });
    expect(tenant.writes).toContain("jobs.cancel");
  });

  it("refuses an unmapped customer reference with a retryable 409 and no receipt", async () => {
    const unmapped = envelope({ payload: payload({ customerRef: "cus_unknown" }) }, "k-unmapped");
    const result = await handleScheduledBookingEvent({ rawBody: post(unmapped), config, runInTenant: tenant.runInTenant });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: "customer_unmapped" } });
  });

  it("rejects an unsupported schema version and a bad payload field", async () => {
    const v2 = await handleScheduledBookingEvent({
      rawBody: post(envelope({ schemaVersion: 2 })),
      config,
      runInTenant: tenant.runInTenant,
    });
    expect(v2.status).toBe(422);
    const badEnd = await handleScheduledBookingEvent({
      rawBody: post(envelope({ payload: payload({ endAt: "2026-11-19T09:00:00.000Z" }) })),
      config,
      runInTenant: tenant.runInTenant,
    });
    expect(badEnd.status).toBe(422);
    expect(tenant.runInTenant).not.toHaveBeenCalled();
  });
});

describe("readScheduledBookingConfig", () => {
  it("is disabled unless the flag is exactly 1", () => {
    expect(readScheduledBookingConfig({})).toEqual({ enabled: false });
    expect(readScheduledBookingConfig({ SCHEDULED_BOOKING_EVENTS_ENABLED: "true" })).toEqual({ enabled: false });
  });

  it("fails closed when enabled without a usable secret or tenant", () => {
    expect(() =>
      readScheduledBookingConfig({ SCHEDULED_BOOKING_EVENTS_ENABLED: "1", SCHEDULED_BOOKING_EVENTS_SECRET: "short" }),
    ).toThrow(/SCHEDULED_BOOKING_EVENTS_SECRET/);
  });
});
