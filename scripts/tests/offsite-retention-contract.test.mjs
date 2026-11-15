import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const src=readFileSync("scripts/backup-garonhome.sh","utf8");
test("age-only bulk deletion cannot erase incomplete or unverified offsite sets",()=>{
 assert.doesNotMatch(src,/^\s*rclone delete\b/m);
 assert.match(src,/offsite prune deferred/);
 assert.match(src,/no destructive age-only delete/);
});
test("local prune requires an individual verified-set marker",()=>{
 assert.match(src,/verified-\$\{ts\}/);
 assert.match(src,/\$\{#FAILURES\[@\]\} == 0/);
 assert.match(src,/find "\$\{BACKUP_DIR\}" -maxdepth 1 -type f/);
});
