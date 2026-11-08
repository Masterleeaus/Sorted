/**
 * Unit tests for the public intake route.
 *
 * The database is an in-memory model of the intake_invites row. It models
 * Postgres READ COMMITTED behaviour for one row: a claim takes a row lock that
 * is held until COMMIT or ROLLBACK; a second claim waits for the lock, then
 * re-checks its predicate against the committed state. This is a model, not a
 * real database. A real-Postgres run is a separate check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

type Invite = {
  id: string;
  token: string;
  account_id: string;
  booking_request_id: string | null;
  lead_name: string;
  lead_email: string;
  used: boolean;
  expired: boolean;
};

type Tx = { id: number; claimed: Invite | null; staged: string[] };

const db = vi.hoisted(() => {
  const state = {
    invites: [] as Array<Invite>,
    committedBookingNames: [] as string[],
    queryCount: 0,
    sqlLog: [] as string[],
    failNextBookingUpdate: false,
    intakeMediaByInvite: {} as Record<string, number>,
    lastMetadataJson: null as string | null,
    linkedMediaInvites: [] as string[],
    lockOwner: null as number | null,
    lockWaiters: [] as Array<() => void>,
    nextTxId: 1,
  };

  function releaseLock() {
    state.lockOwner = null;
    const waiters = state.lockWaiters.splice(0);
    for (const wake of waiters) wake();
  }

  async function run(tx: Tx | null, sql: string, params: unknown[] = []) {
    state.queryCount++;
    state.sqlLog.push(sql);
    const txId = tx?.id ?? 0;

    if (sql.startsWith("BEGIN") || sql.includes("set_config")) return { rows: [] };

    if (sql.startsWith("SELECT id, account_id, booking_request_id")) {
      const inv = state.invites.find((i) => i.token === params[0] && !i.used && !i.expired);
      return { rows: inv ? [inv] : [] };
    }

    if (sql.startsWith("SELECT used_at, expires_at")) {
      const inv = state.invites.find((i) => i.token === params[0]);
      return {
        rows: inv
          ? [{ used_at: inv.used ? "2026-01-01T00:00:00Z" : null, expires_at: "2099-01-01T00:00:00Z" }]
          : [],
      };
    }

    if (sql.startsWith("UPDATE intake_invites")) {
      // Row lock: wait until the holder commits or rolls back.
      while (state.lockOwner !== null && state.lockOwner !== txId) {
        await new Promise<void>((resolve) => state.lockWaiters.push(resolve));
      }
      const inv = state.invites.find((i) => i.id === params[0]);
      // Re-evaluate the predicate written in the SQL on the latest committed row.
      const requireUnused = /used_at IS NULL/.test(sql);
      const requireUnexpired = /expires_at > now\(\)/.test(sql);
      const matches =
        !!inv && (!requireUnused || !inv.used) && (!requireUnexpired || !inv.expired);
      if (inv && matches && tx) {
        state.lockOwner = txId;
        tx.claimed = inv;
        return { rows: [{ id: inv.id }] };
      }
      return { rows: [] };
    }

    if (sql.startsWith("SELECT count(*)::int AS n FROM intake_media")) {
      return { rows: [{ n: state.intakeMediaByInvite[params[0] as string] ?? 0 }] };
    }

    if (sql.startsWith("UPDATE intake_media")) {
      state.linkedMediaInvites.push(params[1] as string);
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE booking_requests")) {
      if (state.failNextBookingUpdate) {
        state.failNextBookingUpdate = false;
        throw new Error("simulated booking update failure");
      }
      tx?.staged.push(params[10] as string);
      state.lastMetadataJson = params[2] as string;
      return { rows: [] };
    }

    if (sql === "COMMIT" && tx) {
      if (tx.claimed) tx.claimed.used = true;
      state.committedBookingNames.push(...tx.staged);
      tx.staged = [];
      releaseLock();
      return { rows: [] };
    }

    if (sql === "ROLLBACK" && tx) {
      tx.staged = [];
      tx.claimed = null;
      releaseLock();
      return { rows: [] };
    }

    throw new Error(`unexpected SQL in test model: ${sql.slice(0, 60)}`);
  }

  const pool = {
    query: (sql: string, params?: unknown[]) => run(null, sql, params),
    connect: async () => {
      const tx: Tx = { id: state.nextTxId++, claimed: null, staged: [] };
      return {
        query: (sql: string, params?: unknown[]) => run(tx, sql, params),
        release: () => {},
      };
    },
  };

  return { state, pool };
});

vi.mock("@/lib/db", () => ({
  getPool: () => db.pool,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "../route";
import { _resetStore } from "@/lib/rate-limit";

const VALID_BODY = {
  name: "Jane Client",
  service_category: "general_repairs",
  service_description: "Door latch is loose and needs adjustment.",
  preferred_time_slot: "flexible",
  intake_metadata: {},
};

let ipCounter = 0;

function makeRequest(
  token: string,
  body: unknown,
  ip = `10.1.0.${++ipCounter}`
): NextRequest {
  return new NextRequest(`http://localhost:3000/api/intake/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function submit(token: string, body: unknown = VALID_BODY, ip?: string) {
  return POST(makeRequest(token, body, ip), { params: Promise.resolve({ token }) });
}

function seedInvite(token: string, overrides: Partial<Invite> = {}) {
  const invite: Invite = {
    id: `invite-${token}`,
    token,
    account_id: "00000000-0000-0000-0000-000000000002",
    booking_request_id: "11111111-1111-1111-1111-111111111111",
    lead_name: "Lead",
    lead_email: "lead@example.com",
    used: false,
    expired: false,
    ...overrides,
  };
  db.state.invites.push(invite);
  return invite;
}

const originalTrust = process.env.TRUSTED_PROXY_COUNT;

beforeEach(() => {
  process.env.TRUSTED_PROXY_COUNT = "1";
  _resetStore();
  db.state.invites = [];
  db.state.committedBookingNames = [];
  db.state.queryCount = 0;
  db.state.sqlLog = [];
  db.state.failNextBookingUpdate = false;
  db.state.lockOwner = null;
  db.state.lockWaiters = [];
});

afterEach(() => {
  if (originalTrust === undefined) delete process.env.TRUSTED_PROXY_COUNT;
  else process.env.TRUSTED_PROXY_COUNT = originalTrust;
});

describe("intake invite claim (atomic consume)", () => {
  it("uses a conditional claim with RETURNING inside the submission", async () => {
    seedInvite("tok-claim");
    const res = await submit("tok-claim");
    expect(res.status).toBe(200);

    const claim = db.state.sqlLog.find((s) => s.startsWith("UPDATE intake_invites"));
    expect(claim).toBeDefined();
    expect(claim).toMatch(/used_at IS NULL/);
    expect(claim).toMatch(/expires_at > now\(\)/);
    expect(claim).toMatch(/RETURNING/);
  });

  it("two concurrent submissions with the same valid token: exactly one proceeds", async () => {
    const invite = seedInvite("tok-race");

    const [a, b] = await Promise.all([
      submit("tok-race", { ...VALID_BODY, name: "Alice Winner-or-Loser" }, "10.9.0.1"),
      submit("tok-race", { ...VALID_BODY, name: "Bob Winner-or-Loser" }, "10.9.0.2"),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error.code).toBe("ALREADY_USED");

    // Exactly one booking update was committed, and the invite is consumed.
    expect(db.state.committedBookingNames).toHaveLength(1);
    expect(invite.used).toBe(true);
  });

  it("a failed booking update rolls back the claim, so the invite is still usable", async () => {
    const invite = seedInvite("tok-fail");
    db.state.failNextBookingUpdate = true;

    const first = await submit("tok-fail");
    expect(first.status).toBe(500);
    expect(invite.used).toBe(false);
    expect(db.state.committedBookingNames).toHaveLength(0);

    const second = await submit("tok-fail", { ...VALID_BODY, name: "Retry Name" });
    expect(second.status).toBe(200);
    expect(invite.used).toBe(true);
    expect(db.state.committedBookingNames).toEqual(["Retry Name"]);
  });

  it("a resubmission after success returns 409 and does not update the booking again", async () => {
    seedInvite("tok-again");
    expect((await submit("tok-again")).status).toBe(200);
    const again = await submit("tok-again", { ...VALID_BODY, name: "Second" });
    expect(again.status).toBe(409);
    expect(db.state.committedBookingNames).toHaveLength(1);
  });

  it("an expired invite returns 410 and never attempts the claim", async () => {
    seedInvite("tok-old", { expired: true });
    const res = await submit("tok-old");
    expect(res.status).toBe(410);
    expect(db.state.sqlLog.some((s) => s.startsWith("UPDATE intake_invites"))).toBe(false);
  });
});

describe("intake rate limits", () => {
  it("limits invalid-token traffic per IP before body parsing or DB access", async () => {
    const ip = "203.0.113.7";
    // Distinct tokens, so only the per-IP limit can trip here.
    for (let i = 0; i < 20; i++) {
      const res = await submit(`no-such-token-${i}`, VALID_BODY, ip);
      expect(res.status).toBe(404);
    }

    const queriesBefore = db.state.queryCount;
    // Garbage body on the blocked request: must be rejected as 429, not 400.
    const blocked = await submit("no-such-token-blocked", "not json", ip);
    expect(blocked.status).toBe(429);
    expect(db.state.queryCount).toBe(queriesBefore);

    const body = await blocked.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("token-scoped limit applies across rotating IPs and does not reveal validity", async () => {
    seedInvite("tok-used", { used: true });

    // Ten attempts per token, each from a different IP, so only the token
    // limit can trip. The pre-limit responses differ (404 vs 409), which is
    // expected; the limited responses must not.
    for (let i = 0; i < 10; i++) {
      expect((await submit("tok-unknown", VALID_BODY, `198.51.100.${i + 1}`)).status).toBe(404);
      expect((await submit("tok-used", VALID_BODY, `198.51.101.${i + 1}`)).status).toBe(409);
    }

    // The next attempt is limited for both, from fresh IPs.
    const unknownBlocked = await submit("tok-unknown", VALID_BODY, "198.51.100.200");
    const usedBlocked = await submit("tok-used", VALID_BODY, "198.51.101.200");
    expect(unknownBlocked.status).toBe(429);
    expect(usedBlocked.status).toBe(429);
    expect(unknownBlocked.headers.get("Retry-After")).not.toBeNull();
    // A limited response looks the same for a valid and an invalid token.
    expect(await unknownBlocked.text()).toBe(await usedBlocked.text());
  });

  it("rejects a declared oversized body with 413 before any DB access", async () => {
    const req = new NextRequest("http://localhost:3000/api/intake/tok-big", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(64 * 1024),
        "x-forwarded-for": "192.0.2.10",
      },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req, { params: Promise.resolve({ token: "tok-big" }) });
    expect(res.status).toBe(413);
    expect(db.state.queryCount).toBe(0);
  });

  it("rejects a streamed oversized body with 413 while reading", async () => {
    const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i++) controller.enqueue(chunk); // 64 KiB total
        controller.close();
      },
    });
    const req = new NextRequest("http://localhost:3000/api/intake/tok-stream", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.11" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await POST(req, { params: Promise.resolve({ token: "tok-stream" }) });
    expect(res.status).toBe(413);
    expect(db.state.queryCount).toBe(0);
  });

  it("still returns 400 INVALID_JSON for a small malformed body", async () => {
    const res = await submit("tok-bad-json", "{not json", "192.0.2.12");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });
});

describe("intake submit with photos", () => {
  beforeEach(() => {
    db.state.intakeMediaByInvite = {};
    db.state.linkedMediaInvites = [];
    db.state.lastMetadataJson = null;
  });

  it("sets photo_count from the server's count and links the invite's photos to the request", async () => {
    seedInvite("tok-photos");
    db.state.intakeMediaByInvite["invite-tok-photos"] = 3;
    const res = await submit("tok-photos");
    expect(res.status).toBe(200);
    expect(JSON.parse(db.state.lastMetadataJson ?? "{}")).toMatchObject({ photo_count: "3" });
    expect(db.state.linkedMediaInvites).toEqual(["invite-tok-photos"]);
  });

  it("ignores a client-supplied photo_count and reports zero when no photos were uploaded", async () => {
    seedInvite("tok-none");
    const res = await submit("tok-none", { ...VALID_BODY, intake_metadata: { photo_count: "99" } });
    expect(res.status).toBe(200);
    expect(JSON.parse(db.state.lastMetadataJson ?? "{}")).toMatchObject({ photo_count: "0" });
  });

  it("no longer accepts a numeric photo_count placeholder from the old client", async () => {
    seedInvite("tok-old-client");
    const res = await submit("tok-old-client", { ...VALID_BODY, intake_metadata: { photo_count: 0 } });
    expect(res.status).toBe(400);
  });
});
