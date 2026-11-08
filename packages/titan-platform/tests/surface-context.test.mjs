import test from "node:test";
import assert from "node:assert/strict";
import { assertSurfaceProjectionContext, createSurfaceProjection } from "../.test-dist/surface/index.js";

function projection(overrides = {}) {
  return createSurfaceProjection({
    company_id: "company-a",
    surface: "zero",
    actor_id: "actor-1",
    revision: "rev-7",
    issued_at: "2026-09-29T00:00:00.000Z",
    expires_at: "2026-09-30T00:00:00.000Z",
    capabilities: [{ capability_id: "decisions.read", operations: ["read"] }],
    ...overrides,
  });
}

test("accepts a current company and surface context", () => {
  const current = projection();
  assert.equal(assertSurfaceProjectionContext(current, {
    company_id: "company-a",
    surface: "command",
    revision: "rev-7",
    now: "2026-09-29T01:00:00.000Z",
  }), current);
});

test("rejects stale or cross-company reconnect context", () => {
  const current = projection();
  assert.throws(() => assertSurfaceProjectionContext(current, {
    company_id: "company-b", surface: "zero", now: "2026-09-29T01:00:00.000Z",
  }), { message: "surface-projection-company-mismatch" });
  assert.throws(() => assertSurfaceProjectionContext(current, {
    company_id: "company-a", surface: "zero", revision: "rev-6", now: "2026-09-29T01:00:00.000Z",
  }), { message: "surface-projection-revision-mismatch" });
});

test("rejects expired projections before capability use", () => {
  assert.throws(() => assertSurfaceProjectionContext(projection(), {
    company_id: "company-a", surface: "zero", now: "2026-10-01T00:00:00.000Z",
  }), { message: "surface-projection-expired" });
});
