import assert from "node:assert/strict";
import test from "node:test";

// Source-level contract test intentionally avoids TS runtime tooling.
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/business-ops.ts", import.meta.url), "utf8");

test("native Business Ops agent command surface covers the operating chain", () => {
  for (const id of [
    "estimates.create_project",
    "projects.create",
    "work_orders.start_visit",
    "visits.transition",
    "invoices.send",
  ]) assert.match(source, new RegExp(`\\"${id.replace('.', '\\.')}\\"`));
});

test("command paths target native Business Ops APIs rather than extension messaging", () => {
  assert.match(source, /\/api\/v1\/jobs/);
  assert.match(source, /\/api\/v1\/work-orders/);
  assert.doesNotMatch(source, /chrome\.runtime/);
});
