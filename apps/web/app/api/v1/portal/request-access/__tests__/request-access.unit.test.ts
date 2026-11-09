import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  sendEmail: vi.fn(),
  sendSmsViaGateway: vi.fn(),
  isSmsGatewayConfigured: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  query: h.query,
  getPool: () => ({
    connect: async () => ({
      // Account-context transaction: set_config and BEGIN/COMMIT are no-ops; reads go to h.query.
      query: async (sql: string, params?: unknown[]) =>
        sql.startsWith("SELECT set_config") || sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
          ? { rows: [] }
          : { rows: await h.query(sql, params) },
      release: () => {},
    }),
  }),
}));
vi.mock("@/lib/email/mailer", () => ({
  sendEmail: h.sendEmail,
  appUrl: () => "https://app.example.test",
}));
vi.mock("@/lib/sms/gateway", () => ({
  sendSmsViaGateway: h.sendSmsViaGateway,
  isSmsGatewayConfigured: h.isSmsGatewayConfigured,
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

import { _resetStore } from "@/lib/rate-limit";

const ACCOUNT_ID = "00000000-0000-0000-0000-000000000002";
const OTHER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000009";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/portal/request-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Mock the DB so magic-link inserts succeed and client lookups return `rows`. */
function mockLookup(rows: unknown[]) {
  h.query.mockImplementation(async (sql: string) => {
    if (sql.includes("INSERT INTO portal_magic_links")) return [{ token: "tok-1" }];
    return rows;
  });
}

async function post(body: unknown) {
  const { POST } = await import("../route");
  const res = await POST(makeRequest(body));
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  _resetStore();
  process.env.BOOKING_ACCOUNT_ID = ACCOUNT_ID;
  h.isSmsGatewayConfigured.mockReturnValue(true);
  h.sendSmsViaGateway.mockResolvedValue({ ok: true });
  h.sendEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.BOOKING_ACCOUNT_ID;
});

describe("POST /api/v1/portal/request-access: missing or invalid account config", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["not a UUID", "not-a-uuid"],
  ])("returns generic ok, queries nothing, and sends nothing when BOOKING_ACCOUNT_ID is %s", async (_label, value) => {
    if (value === undefined) delete process.env.BOOKING_ACCOUNT_ID;
    else process.env.BOOKING_ACCOUNT_ID = value;
    mockLookup([{ id: "c1", name: "Jane", can_text: true }]);

    const byEmail = await post({ email: "jane@example.test" });
    const byPhone = await post({ phone: "555-123-4567" });

    expect(byEmail).toEqual({ status: 200, json: { ok: true } });
    expect(byPhone).toEqual({ status: 200, json: { ok: true } });
    expect(h.query).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.sendSmsViaGateway).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalled();
  });

  it("logs the config error server-side only, not in the response", async () => {
    delete process.env.BOOKING_ACCOUNT_ID;
    const res = await post({ email: "jane@example.test" });
    expect(JSON.stringify(res.json)).not.toMatch(/BOOKING_ACCOUNT_ID/);
    expect(h.logger.error.mock.calls[0][0]).toMatch(/BOOKING_ACCOUNT_ID/);
  });
});

describe("POST /api/v1/portal/request-access: account-scoped lookups", () => {
  it("scopes the email lookup to the configured account and never searches all accounts", async () => {
    mockLookup([{ id: "c1", name: "Jane Doe", can_text: false }]);
    await post({ email: "jane@example.test" });

    const [sql, params] = h.query.mock.calls[0];
    expect(sql).toContain("c.account_id = $2::uuid");
    expect(sql).not.toContain("IS NULL");
    expect(params).toEqual(["jane@example.test", ACCOUNT_ID]);
  });

  it("scopes the phone lookup to the configured account", async () => {
    mockLookup([{ id: "c1", name: "Jane Doe", can_text: true }]);
    await post({ phone: "555-123-4567" });

    const [sql, params] = h.query.mock.calls[0];
    expect(sql).toContain("c.account_id = $2::uuid");
    expect(sql).not.toContain("IS NULL");
    expect(params).toEqual(["5551234567", ACCOUNT_ID]);
  });

  it("issues a link and sends email when exactly one client matches", async () => {
    mockLookup([{ id: "c1", name: "Jane Doe", can_text: false }]);
    const res = await post({ email: "jane@example.test" });

    expect(res.json).toEqual({ ok: true });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const mail = h.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("jane@example.test");
    expect(mail.html).toContain("https://app.example.test/api/v1/portal/auth/verify?token=tok-1");
    expect(mail.text).toContain("https://app.example.test/api/v1/portal/auth/verify?token=tok-1");
  });
});

describe("POST /api/v1/portal/request-access: ambiguous matches fail closed", () => {
  it("sends no email when the email matches more than one client in the account", async () => {
    mockLookup([
      { id: "c1", name: "Jane Doe", can_text: true },
      { id: "c2", name: "Jane Smith", can_text: true },
    ]);
    const res = await post({ email: "jane@example.test" });

    expect(res).toEqual({ status: 200, json: { ok: true } });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO portal_magic_links"))).toBe(false);
    expect(h.logger.warn).toHaveBeenCalledWith(
      "portal sign-in ambiguous match; no link issued",
      expect.objectContaining({ channel: "email" }),
    );
  });

  it("sends no SMS when the phone matches more than one client in the account", async () => {
    mockLookup([
      { id: "c1", name: "Jane Doe", can_text: true },
      { id: "c2", name: "Joe Doe", can_text: true },
    ]);
    const res = await post({ phone: "555-123-4567" });

    expect(res).toEqual({ status: 200, json: { ok: true } });
    expect(h.sendSmsViaGateway).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledWith(
      "portal sign-in ambiguous match; no link issued",
      expect.objectContaining({ channel: "phone" }),
    );
  });

  it("does not send to a duplicate from another account because the SQL is account-scoped", async () => {
    // Duplicates across accounts are excluded by the account_id predicate, so the
    // query returns only the configured account's row. Verify the configured ID is used.
    mockLookup([{ id: "c1", name: "Jane Doe", can_text: false }]);
    process.env.BOOKING_ACCOUNT_ID = OTHER_ACCOUNT_ID;
    await post({ email: "jane@example.test" });
    expect(h.query.mock.calls[0][1]).toEqual(["jane@example.test", OTHER_ACCOUNT_ID]);
  });
});

describe("POST /api/v1/portal/request-access: no match and escaping", () => {
  it("returns generic ok and sends nothing when no client matches", async () => {
    mockLookup([]);
    const res = await post({ email: "nobody@example.test" });
    expect(res).toEqual({ status: 200, json: { ok: true } });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("escapes a hostile client name in the HTML email", async () => {
    mockLookup([{ id: "c1", name: `<img src=x onerror="alert(1)">`, can_text: false }]);
    await post({ email: "jane@example.test" });
    const html: string = h.sendEmail.mock.calls[0][0].html;
    expect(html).not.toMatch(/<img src=x/i);
    expect(html).toContain("Hi &lt;img, click below");
  });
});
