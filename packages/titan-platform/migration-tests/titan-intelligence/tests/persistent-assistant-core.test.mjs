import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
const overseer = fs.readFileSync(new URL('titan-intelligence/overseer.mjs', root), 'utf8');
const core = fs.readFileSync(new URL('titan-intelligence/core/persistent-core.mjs', root), 'utf8');
const defaults = fs.readFileSync(new URL('titan-intelligence/core/defaults.mjs', root), 'utf8');

test('persistent assistant core remains present in cumulative BOS build', () => assert.equal(manifest.version, '0.18.2'));
test('Zero remains local-first and model-independent', () => {
  assert.match(defaults, /externalModelRequired: false/);
  assert.match(defaults, /providerDependency: 'none'/);
  assert.match(defaults, /mode: 'offline-zero'/);
});
test('persistent core owns required state domains', () => {
  for (const token of ['context','workingState','memory','preferences','knowledge','capabilities','confidence','journeys','intelligence']) assert.match(core, new RegExp(token));
});
test('Zero exposes durable local message bridge', () => {
  for (const token of ['TITAN_ZERO_SET_CONTEXT','TITAN_ZERO_REMEMBER','TITAN_ZERO_SET_PREFERENCES','TITAN_ZERO_ADD_KNOWLEDGE','TITAN_ZERO_SET_CAPABILITIES','TITAN_ZERO_SET_CONFIDENCE','TITAN_ZERO_UPSERT_JOURNEY','TITAN_ZERO_ACCUMULATE']) assert.match(overseer, new RegExp(token));
});
test('company_id is the canonical company context field', () => {
  assert.match(core, /company_id/);
  assert.doesNotMatch(core, /tenant_company_id|tenant_id/);
});
test('MV3 heartbeat keeps Zero re-wakeable without cloud dependency', () => {
  assert.match(overseer, /titan\.zero\.heartbeat/);
  assert.match(overseer, /periodInMinutes: 1/);
});
test('Zero discovers baseline on-device capabilities', () => {
  assert.match(overseer, /discoverBaselineCapabilities/);
  assert.match(overseer, /browser\.storage\.local/);
  assert.match(overseer, /state\.persistence/);
});
