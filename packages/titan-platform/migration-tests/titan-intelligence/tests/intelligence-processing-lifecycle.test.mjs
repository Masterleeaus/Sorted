import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
const lifecycleText = fs.readFileSync(new URL('titan-intelligence/core/processing-lifecycle.mjs', root), 'utf8');
const overseerText = fs.readFileSync(new URL('titan-intelligence/overseer.mjs', root), 'utf8');
const storageText = fs.readFileSync(new URL('titan-intelligence/core/storage.mjs', root), 'utf8');

const memory = new Map();
globalThis.chrome = {
  storage: { local: {
    async get(key) { return { [key]: memory.get(key) }; },
    async set(obj) { for (const [key, value] of Object.entries(obj)) memory.set(key, structuredClone(value)); }
  } }
};

const lifecycle = await import('../core/processing-lifecycle.mjs');

test('pass 4 increments BOS package version', () => assert.equal(manifest.version, '0.18.2'));
test('canonical normal lifecycle is explicit and ordered', () => {
  assert.deepEqual(lifecycle.PROCESSING_ORDER, ['RECEIVED','PROCESSING','PROCESSED','APPROVED']);
});
test('processing lifecycle is durable local Zero state', () => {
  assert.match(storageText, /titan\.zero\.processing-lifecycle\.v1/);
  assert.match(overseerText, /TITAN_ZERO_PROCESS_RECEIVE/);
  assert.match(overseerText, /TITAN_ZERO_PROCESS_TRANSITION/);
});
test('exact revision binding and Titan compliance are explicit', () => {
  assert.match(lifecycleText, /approved_revision_id/);
  assert.match(lifecycleText, /approved_revision_digest/);
  assert.match(lifecycleText, /titan_compliant: true/);
  assert.match(lifecycleText, /processing-revision-id-reused-with-different-content/);
});
test('company_id remains sole canonical company boundary', () => {
  assert.match(lifecycleText, /company_id/);
  assert.doesNotMatch(lifecycleText, /tenant_id|tenant_company_id/);
});
test('item cannot skip states and APPROVED requires passed intelligence checks', async () => {
  memory.clear();
  const item = { item_id: 'booking-1', company_id: 'company-A', revision_id: 'r1', revision: { customer: 'A', amount: 120 } };
  await lifecycle.receiveForProcessing(item);
  await assert.rejects(() => lifecycle.transitionProcessing({ item_id: 'booking-1', revision_id: 'r1', target_state: 'PROCESSED', revision: item.revision }), /transition-invalid/);
  await lifecycle.transitionProcessing({ item_id: 'booking-1', revision_id: 'r1', target_state: 'PROCESSING', revision: item.revision });
  await assert.rejects(() => lifecycle.transitionProcessing({ item_id: 'booking-1', revision_id: 'r1', target_state: 'PROCESSED', revision: item.revision }), /required-intelligence-checks-not-passed/);
  const checks = [{ id: 'meaning', required: true, passed: true }, { id: 'reality', required: true, passed: true }];
  await lifecycle.transitionProcessing({ item_id: 'booking-1', revision_id: 'r1', target_state: 'PROCESSED', revision: item.revision, intelligence_checks: checks });
  const result = await lifecycle.transitionProcessing({ item_id: 'booking-1', revision_id: 'r1', target_state: 'APPROVED', revision: item.revision });
  const approved = result.items.find(candidate => candidate.item_id === 'booking-1');
  assert.equal(approved.state, 'APPROVED');
  assert.equal(approved.titan_compliant, true);
  assert.equal(approved.approved_revision_id, 'r1');
});
test('approval is invalidated by any material revision mismatch', async () => {
  const changed = { customer: 'A', amount: 999 };
  await assert.rejects(() => lifecycle.transitionProcessing({ item_id: 'booking-1', revision_id: 'r1', target_state: 'APPROVED', revision: changed }), /revision-content-mismatch|approved-state-final/);
  await assert.rejects(() => lifecycle.receiveForProcessing({ item_id: 'booking-1', company_id: 'company-A', revision_id: 'r1', revision: changed }), /revision-id-reused-with-different-content/);
});
