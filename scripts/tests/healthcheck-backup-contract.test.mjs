import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("scripts/healthcheck-garonhome.sh","utf8");
test("health monitor reads backup status independently and emits an urgent alert",()=>{
 assert.match(code,/check-backup-health.mjs/);
 assert.match(code,/status=backup_missing_stale_or_incomplete/);
 assert.match(code,/Title: Sorted verified backup unavailable/);
});
test("monitoring failures return nonzero to supervising cron or systemd",()=>{
 assert.match(code,/HEALTHCHECK_FAILED=1/);
 assert.match(code,/if \[\[ "\$\{HEALTHCHECK_FAILED:-0\}" == "1" \]\]; then\s+exit 1/);
 assert.match(code,/status=container_down/);
 assert.match(code,/exit 1/);
});
test("external ntfy endpoints include URL scheme",()=>{
 assert.doesNotMatch(code,/\s"ntfy\.sh\/\$\{NTFY_TOPIC\}"/);
 assert.match(code,/NTFY_URL_BASE="https:\/\/ntfy\.sh"/);
 assert.match(code,/NTFY_URL_BASE="http:\/\/\$\{NTFY_BASE\}"/);
});
