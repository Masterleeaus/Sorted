import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
vi.mock("pg", () => ({
  Pool: class {
    connect = connect;
  },
}));
vi.mock("../env", () => ({ getEnv: () => ({ DATABASE_URL: "postgresql://unused" }) }));

import { assertCompanyId, companyIdFromSession, withDbSession } from "../db";

const ACCOUNT = "11111111-2222-4333-8444-555555555555";

function fakeClient() {
  const calls: { text: string; params?: unknown[] }[] = [];
  return {
    calls,
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

describe("assertCompanyId", () => {
  it("accepts a uuid in any letter case", () => {
    expect(assertCompanyId(ACCOUNT)).toBe(ACCOUNT);
    expect(assertCompanyId(ACCOUNT.toUpperCase())).toBe(ACCOUNT.toUpperCase());
  });

  it.each([undefined, null, "", "acct-a", "11111111-2222-4333-8444-55555555555", 42])(
    "rejects a missing or malformed value (%s)",
    (value) => {
      expect(() => assertCompanyId(value)).toThrow(/Company context missing/);
    },
  );
});

describe("companyIdFromSession", () => {
  it("uses the session account id as the company id", () => {
    expect(companyIdFromSession({ userId: "u", accountId: ACCOUNT, role: "owner" })).toBe(ACCOUNT);
  });
});

describe("withDbSession company context", () => {
  beforeEach(() => {
    connect.mockReset();
  });

  it("fails closed before opening a connection when the session account is malformed", async () => {
    const fn = vi.fn();
    await expect(
      withDbSession({ userId: "u", accountId: "not-a-uuid", role: "owner" }, fn),
    ).rejects.toThrow(/Company context missing/);
    await expect(
      withDbSession({ userId: "u", accountId: undefined as unknown as string, role: "owner" }, fn),
    ).rejects.toThrow(/Company context missing/);
    expect(connect).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it("sets account, company and role in one transaction-local statement before fn runs", async () => {
    const client = fakeClient();
    connect.mockResolvedValue(client);
    const out = await withDbSession({ userId: "user-1", accountId: ACCOUNT, role: "tech" }, async (c) => {
      await c.query("SELECT 1");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(client.calls[0].text).toBe("BEGIN");
    const set = client.calls[1];
    expect(set.text).toContain("set_config('app.current_account_id'");
    expect(set.text).toContain("set_config('app.company_id', $3, true)");
    expect(set.text).toContain("set_config('app.current_role', $4, true)");
    expect(set.params).toEqual(["user-1", ACCOUNT, ACCOUNT, "tech"]);
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("rolls back and rethrows when fn fails", async () => {
    const client = fakeClient();
    connect.mockResolvedValue(client);
    await expect(
      withDbSession({ userId: "u", accountId: ACCOUNT, role: "owner" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(client.calls.map((c) => c.text)).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });
});
