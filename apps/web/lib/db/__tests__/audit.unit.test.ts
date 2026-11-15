import { describe, expect, it, vi } from "vitest";
import { appendAuditLog } from "../audit";

const ACCOUNT_ID = "11111111-2222-4333-8444-555555555555";

describe("appendAuditLog", () => {
  it("writes company_id alongside account_id, equal to the account id", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as Parameters<typeof appendAuditLog>[0];

    await appendAuditLog(client, {
      account_id: ACCOUNT_ID,
      entity_type: "job",
      entity_id: "job-1",
      action: "update",
      actor_id: "user-1",
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("(account_id, company_id, entity_type");
    expect(params[0]).toBe(ACCOUNT_ID);
    expect(params[1]).toBe(ACCOUNT_ID);
    expect(params[2]).toBe("job");
    expect(params).toHaveLength(9);
  });
});
