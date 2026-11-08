import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import path from "node:path";

const root = path.resolve(process.cwd(), "../..");
const adapter = fs.readFileSync(path.join(root, "apps/web/lib/titan/workforce-native/scheduling.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "apps/web/app/api/v1/titan/workforce/native/scheduling/route.ts"), "utf8");

test("web scheduling adapter derives company and actor from authenticated session", () => {
  assert.match(adapter, /companyId:\s*session\.accountId/);
  assert.match(adapter, /actorId:\s*session\.userId/);
  assert.match(adapter, /ALLOWED_ROLES = new Set\(\["owner", "admin"\]\)/);
  assert.doesNotMatch(adapter, /tenant_company_id/);
});

test("native scheduling route exposes governed actions only", () => {
  assert.match(route, /withRole\(\["owner", "admin"\]/);
  assert.match(route, /schedule_visits/);
  assert.match(route, /reschedule_visit/);
  assert.match(route, /canonical-visit-conflicts/);
});
