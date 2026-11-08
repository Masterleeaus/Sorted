import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../../../", import.meta.url).pathname);
const adapter = fs.readFileSync(path.join(root, "apps/web/lib/titan/workforce-native/booking.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "apps/web/app/api/v1/titan/workforce/native/booking/route.ts"), "utf8");

test("Booking web adapter delegates only planned canonical Business Ops operations", () => {
  assert.match(adapter, /fetch\(target/);
  assert.match(adapter, /session\.accountId/);
  assert.match(adapter, /x-titan-workforce-agent/);
  assert.match(adapter, /materializePath/);
  assert.doesNotMatch(adapter + route, /chrome\.runtime|browser\.runtime/);
});

test("Booking endpoint is owner/admin guarded and exposes bounded actions", () => {
  assert.match(route, /withRole\(\["owner", "admin"\]/);
  for (const action of ["list_requests", "get_request", "list_properties", "prepare_booking", "check_availability", "prepare_confirmation", "confirm_request", "reconcile_calendar", "handoff_scheduling", "handoff_jobs"]) {
    assert.match(route, new RegExp(action));
  }
});
