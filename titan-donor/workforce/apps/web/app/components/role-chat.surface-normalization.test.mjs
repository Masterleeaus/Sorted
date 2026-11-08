import fs from "node:fs"; import assert from "node:assert/strict";
const chat=fs.readFileSync(new URL("./role-chat.tsx", import.meta.url),"utf8");
const secondary=fs.readFileSync(new URL("./role-secondary-surfaces.tsx", import.meta.url),"utf8");
assert.match(chat,/export type TitanRole = "zero" \| "go" \| "hub";/);
assert.ok(!/role === "command"/.test(chat)); assert.ok(!/\bcommand:\s*\[/.test(chat));
assert.ok(!/role === "command"/.test(secondary));
console.log("PASS role surfaces normalize to zero/go/hub");
