import { describe, expect, it, vi, beforeEach } from "vitest";

const connect = vi.fn();
vi.mock("@/lib/db", () => ({ getPool: () => ({ connect }) }));

import { withTokenAccountContext } from "../account-context";

const ACCOUNT = "11111111-2222-4333-8444-555555555555";

function fakeClient() {
  const calls: { text: string; params?: unknown[] }[] = [];
  const client = {
    calls,
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return client;
}

describe("withTokenAccountContext", () => {
  beforeEach(() => {
    connect.mockReset();
  });

  it("refuses to run when the account id is missing, without opening a connection", async () => {
    const fn = vi.fn();
    await expect(withTokenAccountContext(undefined, fn)).rejects.toThrow(/Account context missing/);
    await expect(withTokenAccountContext("", fn)).rejects.toThrow(/Account context missing/);
    await expect(withTokenAccountContext("not-a-uuid", fn)).rejects.toThrow(/Account context missing/);
    expect(connect).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it("sets account and public role context in the transaction before running fn", async () => {
    const client = fakeClient();
    connect.mockResolvedValue(client);
    const result = await withTokenAccountContext(ACCOUNT, async (c) => {
      await c.query("SELECT 1");
      return 42;
    });
    expect(result).toBe(42);
    expect(client.calls[0].text).toBe("BEGIN");
    expect(client.calls[1].text).toContain("set_config('app.current_account_id'");
    expect(client.calls[1].text).toContain("set_config('app.company_id', $1, true)");
    expect(client.calls[1].params).toEqual([ACCOUNT, "public"]);
    expect(client.calls[2].text).toBe("SELECT 1");
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("uses the owner role only when the caller asks for it", async () => {
    const client = fakeClient();
    connect.mockResolvedValue(client);
    await withTokenAccountContext(ACCOUNT, async () => 1, "owner");
    expect(client.calls[1].params).toEqual([ACCOUNT, "owner"]);
  });

  it("rolls back and rethrows when fn fails", async () => {
    const client = fakeClient();
    connect.mockResolvedValue(client);
    await expect(
      withTokenAccountContext(ACCOUNT, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(client.calls.map((c) => c.text)).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });
});
