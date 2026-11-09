import { describe, it, expect, vi } from "vitest";
import { pruneAbandonedIntakeMedia } from "./prune-abandoned-intake-media.js";
import { resolveIntakeMediaPath } from "./intake-media-storage.js";

const ROOT = "/app/uploads/intake";
const row = { id: "m1", intake_invite_id: "inv-1", filename: "abc.jpg" };

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("gone"), { code: "ENOENT" });
}

describe("pruneAbandonedIntakeMedia", () => {
  it("selects only unlinked rows on unused, expired invites past the retention window", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await pruneAbandonedIntakeMedia({ query } as never);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("m.booking_request_id IS NULL");
    expect(sql).toContain("i.used_at IS NULL");
    expect(sql).toContain("i.expires_at < now()");
    expect(query.mock.calls[0][1]).toEqual(["30", 200]);
  });

  it("removes the file, then the row, and counts the row", async () => {
    const order: string[] = [];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT m.id")) return { rows: [row] };
      order.push("delete-row");
      return { rowCount: 1 };
    });
    const removeFile = vi.fn(async () => { order.push("unlink"); });
    const result = await pruneAbandonedIntakeMedia({ query } as never, { removeFile, resolvePath: (i, f) => resolveIntakeMediaPath(i, f, ROOT) });
    expect(result).toEqual({ deleted: 1, errors: 0 });
    expect(removeFile).toHaveBeenCalledWith(`${ROOT}/inv-1/abc.jpg`);
    expect(order).toEqual(["unlink", "delete-row"]);
  });

  it("treats a missing file as already removed and still deletes the row", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT m.id") ? { rows: [row] } : { rowCount: 1 });
    const result = await pruneAbandonedIntakeMedia({ query } as never, { removeFile: async () => { throw enoent(); } });
    expect(result).toEqual({ deleted: 1, errors: 0 });
  });

  it("keeps the row and counts an error when the file cannot be removed", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT m.id") ? { rows: [row] } : { rowCount: 1 });
    const removeFile = vi.fn(async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); });
    const result = await pruneAbandonedIntakeMedia({ query } as never, { removeFile });
    expect(result).toEqual({ deleted: 0, errors: 1 });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("DELETE"))).toBe(false);
  });

  it("skips a row whose stored path is unsafe and does not touch the file system", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT m.id") ? { rows: [{ id: "m2", intake_invite_id: "../x", filename: "abc.jpg" }] } : { rowCount: 1 });
    const removeFile = vi.fn();
    const result = await pruneAbandonedIntakeMedia({ query } as never, {
      removeFile,
      resolvePath: (i, f) => resolveIntakeMediaPath(i, f, ROOT),
    });
    expect(result).toEqual({ deleted: 0, errors: 1 });
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("does not count a row that was linked to a request between select and delete", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT m.id") ? { rows: [row] } : { rowCount: 0 });
    const result = await pruneAbandonedIntakeMedia({ query } as never, { removeFile: async () => undefined });
    expect(result).toEqual({ deleted: 0, errors: 0 });
    const deleteSql = String(query.mock.calls[1][0]);
    expect(deleteSql).toContain("m.booking_request_id IS NULL");
    expect(deleteSql).toContain("i.used_at IS NULL");
  });

  it("returns an error count when the select fails", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const result = await pruneAbandonedIntakeMedia({ query } as never);
    expect(result).toEqual({ deleted: 0, errors: 1 });
  });
});

describe("resolveIntakeMediaPath", () => {
  it("builds a path under the intake root", () => {
    expect(resolveIntakeMediaPath("inv-1", "abc.jpg", ROOT)).toBe(`${ROOT}/inv-1/abc.jpg`);
  });

  it("rejects separators, dot segments and non-stored filenames", () => {
    expect(resolveIntakeMediaPath("..", "abc.jpg", ROOT)).toBeNull();
    expect(resolveIntakeMediaPath("inv-1", "../../etc.jpg", ROOT)).toBeNull();
    expect(resolveIntakeMediaPath("inv-1", "abc", ROOT)).toBeNull();
    expect(resolveIntakeMediaPath("inv/1", "abc.jpg", ROOT)).toBeNull();
  });
});
