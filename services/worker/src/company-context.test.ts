import { describe, expect, it, vi } from "vitest";
import { assertCompanyId, runInCompanyContext } from "./company-context";

const COMPANY = "11111111-2222-4333-8444-555555555555";

function fakeClient() {
  const calls: { text: string; params?: unknown[] }[] = [];
  return {
    calls,
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: [] };
    }),
  };
}

describe("assertCompanyId", () => {
  it("accepts a uuid", () => {
    expect(assertCompanyId(COMPANY)).toBe(COMPANY);
  });

  it.each([undefined, null, "", "not-a-uuid", "11111111-2222-4333-8444-5555555555555"])(
    "rejects missing or malformed (%s)",
    (value) => {
      expect(() => assertCompanyId(value)).toThrow(/Company context missing/);
    },
  );
});

describe("runInCompanyContext", () => {
  it("sets app.company_id inside the transaction before fn runs, then commits", async () => {
    const client = fakeClient();
    const out = await runInCompanyContext(client, COMPANY, async () => {
      await client.query("SELECT 1");
      return 7;
    });
    expect(out).toBe(7);
    expect(client.calls.map((c) => c.text)).toEqual([
      "BEGIN",
      "SELECT set_config('app.company_id', $1, true)",
      "SELECT 1",
      "COMMIT",
    ]);
    expect(client.calls[1].params).toEqual([COMPANY]);
  });

  it("refuses without any SQL when the company id is malformed", async () => {
    const client = fakeClient();
    const fn = vi.fn(async () => 1);
    await expect(runInCompanyContext(client, "nope", fn)).rejects.toThrow(/Company context missing/);
    expect(client.calls).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rolls back and rethrows when fn fails", async () => {
    const client = fakeClient();
    await expect(
      runInCompanyContext(client, COMPANY, async () => {
        throw new Error("job failed");
      }),
    ).rejects.toThrow("job failed");
    expect(client.calls.map((c) => c.text)).toContain("ROLLBACK");
    expect(client.calls.map((c) => c.text)).not.toContain("COMMIT");
  });
});
