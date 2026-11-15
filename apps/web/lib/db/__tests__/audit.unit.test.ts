import { describe, expect, it, vi } from "vitest";
import { appendAuditLog } from "../audit";

const COMPANY_ID = "11111111-2222-4333-8444-555555555555";

describe("appendAuditLog", () => {
  // Migration 209 renames audit_log.account_id to company_id, so after 209 the
  // table has company_id and no account_id column. This test pins that shape.
  it("inserts into the post-209 audit_log columns, with company_id as the first value", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as Parameters<typeof appendAuditLog>[0];

    await appendAuditLog(client, {
      company_id: COMPANY_ID,
      entity_type: "job",
      entity_id: "job-1",
      action: "update",
      actor_id: "user-1",
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("(company_id, entity_type, entity_id, action, actor_id, trace_id, old_value, new_value)");
    expect(sql).not.toMatch(/\baccount_id\b/);
    expect(params).toHaveLength(8);
    expect(params[0]).toBe(COMPANY_ID);
    expect(params[1]).toBe("job");
    expect(params[2]).toBe("job-1");
    expect(params[4]).toBe("user-1");
    expect(params[5]).toBeNull();
  });
});
