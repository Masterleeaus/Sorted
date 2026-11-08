import test from "node:test";import assert from "node:assert/strict";import {createSessionBinding,validateSession,redactSecrets,createSecureEnvelope} from "../.test-dist/security-boundary.js";
const binding=createSessionBinding({session_id:"s1",company_id:"co1",actor_id:"a1",device_id:"d1",issued_at:"2026-09-29T00:00:00Z",expires_at:"2026-10-01T00:00:00Z",revoked:false});
test("binds envelopes to trusted company/session and redacts secrets",()=>{validateSession(binding,"co1","2026-09-29T01:00:00Z");const e=createSecureEnvelope(binding,"co1",{message:"ok",api_key:"hidden",nested:{password:"hidden"}},"user","2026-09-29T01:00:00Z");assert.equal(e.role,"user");assert.equal(e.payload.api_key,"[REDACTED]");assert.equal(e.payload.nested.password,"[REDACTED]")});
test("rejects cross-company, expired/revoked and privileged caller claims",()=>{assert.throws(()=>validateSession(binding,"co2","2026-09-29T01:00:00Z"),/company/);assert.throws(()=>validateSession({...binding,revoked:true},"co1","2026-09-29T01:00:00Z"),/revoked/);assert.throws(()=>validateSession(binding,"co1","2026-10-01T00:00:00Z"),/expired/);assert.throws(()=>createSecureEnvelope(binding,"co1",{},"system","2026-09-29T01:00:00Z"),/role/);assert.deepEqual(redactSecrets({refresh_token:"x",ok:true}),{refresh_token:"[REDACTED]",ok:true})});


for (const [label, change, now] of [
  ["invalid expiry", { expires_at: "invalid" }],
  ["invalid issuance", { issued_at: "invalid" }],
  ["future issuance", { issued_at: "2026-09-30T00:00:00Z" }],
  ["reversed lifetime", { expires_at: "2026-09-28T00:00:00Z" }],
  ["zero revision", { revision: 0 }],
  ["fractional revision", { revision: 1.5 }],
  ["unsafe revision", { revision: Number.MAX_SAFE_INTEGER + 1 }],
  ["missing device", { device_id: "" }],
  ["malformed revocation", { revoked: "false" }],
  ["invalid clock", {}, "not-a-date"],
]) {
  test(`rejects ${label} before creating a trusted envelope`, () => {
    assert.throws(() => validateSession({ ...binding, ...change }, "co1", now ?? "2026-09-29T01:00:00Z"));
  });
}
test("session creation validates the complete binding", () => {
  assert.throws(() => createSessionBinding({ ...binding, issued_at: "invalid" }));
  assert.throws(() => createSessionBinding({ ...binding, actor_id: " a1 " }));
});
for (const [field, value] of [
  ['issued_at', '2026-02-30T00:00:00Z'],
  ['issued_at', '0'],
  ['issued_at', '2026-09-29T00:00:00'],
  ['expires_at', '2026-10-01'],
]) {
  test(`rejects noncanonical timestamp ${value}`, () => {
    assert.throws(() => validateSession({ ...binding, [field]: value }, 'co1', '2026-09-29T01:00:00Z'));
  });
}
