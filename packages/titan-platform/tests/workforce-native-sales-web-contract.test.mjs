import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../../../", import.meta.url).pathname);
const adapter = fs.readFileSync(path.join(root, "apps/web/lib/titan/workforce-native/sales.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "apps/web/app/api/v1/titan/workforce/native/sales/route.ts"), "utf8");

test("Sales web adapter delegates only planned native Business Ops operations", () => {
  assert.match(adapter, /fetch\(target/);
  assert.match(adapter, /session\.accountId/);
  assert.match(adapter, /x-titan-workforce-agent/);
  assert.match(adapter, /materializePath/);
  assert.doesNotMatch(adapter + route, /chrome\.runtime|browser\.runtime/);
});

test("Sales endpoint is owner/admin guarded and exposes governed actions", () => {
  assert.match(route, /withRole\(\["owner", "admin"\]/);
  for (const action of ["list_leads", "qualify_lead", "next_best_action", "progress_lead", "prepare_quote_handoff", "create_quote", "plan_follow_up", "handle_objection", "escalate"]) {
    assert.match(route, new RegExp(action));
  }
});
