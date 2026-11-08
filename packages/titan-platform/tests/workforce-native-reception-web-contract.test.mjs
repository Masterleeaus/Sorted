import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../../../", import.meta.url).pathname);
const adapter = fs.readFileSync(path.join(root, "apps/web/lib/titan/workforce-native/reception.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "apps/web/app/api/v1/titan/workforce/native/reception/route.ts"), "utf8");

test("Reception web adapter delegates mutations to existing native APIs and never Chrome messaging", () => {
  assert.match(adapter, /fetch\(target/);
  assert.match(adapter, /session\.accountId/);
  assert.match(adapter, /x-titan-workforce-agent/);
  assert.doesNotMatch(adapter + route, /chrome\.runtime|browser\.runtime/);
});

test("Reception endpoint is owner/admin guarded and exposes only bounded actions", () => {
  assert.match(route, /withRole\(\["owner", "admin"\]/);
  for (const action of ["search_customer", "capture_customer", "list_service_requests", "capture_service_request", "handoff"]) {
    assert.match(route, new RegExp(action));
  }
});
