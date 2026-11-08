import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
const lifecycleText = fs.readFileSync(new URL('titan-intelligence/core/processing-lifecycle.mjs', root), 'utf8');
const memory = new Map();
globalThis.chrome = {
  storage: { local: {
    async get(key) { return { [key]: memory.get(key) }; },
    async set(obj) { for (const [key, value] of Object.entries(obj)) memory.set(key, structuredClone(value)); }
  } }
};
const lifecycle = await import('../core/processing-lifecycle.mjs');

async function approveElevated(itemId='job-risk-1') {
  const revision = { amount: 50000, supplier: 'critical-vendor' };
  await lifecycle.receiveForProcessing({
    item_id: itemId,
    company_id: 'company-A',
    revision_id: 'r1',
    revision,
    requires_authorisation: true,
    risk_level: 'high',
    receiving_domain: 'jobs'
  });
  await lifecycle.transitionProcessing({ item_id: itemId, revision_id: 'r1', revision, target_state: 'PROCESSING' });
  const checks = [{ id: 'meaning', required: true, passed: true }, { id: 'reality', required: true, passed: true }];
  await lifecycle.transitionProcessing({ item_id: itemId, revision_id: 'r1', revision, target_state: 'PROCESSED', intelligence_checks: checks });
  await lifecycle.transitionProcessing({ item_id: itemId, revision_id: 'r1', revision, target_state: 'APPROVED' });
  return revision;
}

test('pass 3 increments BOS package version', () => assert.equal(manifest.version, '0.18.2'));
test('APPROVED remains the final normal processing state and AUTHORISED is elevated', () => {
  assert.deepEqual(lifecycle.PROCESSING_ORDER, ['RECEIVED','PROCESSING','PROCESSED','APPROVED']);
  assert.equal(lifecycle.PROCESSING_STATES.AUTHORISED, 'AUTHORISED');
});
test('normal-risk approved items cannot be elevated without explicit requirement', async () => {
  memory.clear();
  const revision = { amount: 120 };
  await lifecycle.receiveForProcessing({ item_id: 'normal-1', company_id: 'company-A', revision_id: 'r1', revision });
  await lifecycle.transitionProcessing({ item_id: 'normal-1', revision_id: 'r1', revision, target_state: 'PROCESSING' });
  await lifecycle.transitionProcessing({ item_id: 'normal-1', revision_id: 'r1', revision, target_state: 'PROCESSED', intelligence_checks: [{ id: 'basic', required: true, passed: true }] });
  const approvedState = await lifecycle.transitionProcessing({ item_id: 'normal-1', revision_id: 'r1', revision, target_state: 'APPROVED' });
  const approvedItem = approvedState.items.find(x => x.item_id === 'normal-1');
  assert.equal(approvedItem.operational_final, true);
  await assert.rejects(() => lifecycle.transitionProcessing({
    item_id: 'normal-1', revision_id: 'r1', revision, target_state: 'AUTHORISED',
    receiving_specialist_acceptance: { accepted: true, specialist_id: 'jobs-manager', receiving_domain: 'jobs' }
  }), /authorisation-not-required/);
});
test('higher-risk authorisation requires receiving-domain specialist acceptance', async () => {
  memory.clear();
  const revision = await approveElevated();
  await assert.rejects(() => lifecycle.transitionProcessing({ item_id: 'job-risk-1', revision_id: 'r1', revision, target_state: 'AUTHORISED' }), /requires-receiving-specialist-acceptance/);
  await assert.rejects(() => lifecycle.transitionProcessing({
    item_id: 'job-risk-1', revision_id: 'r1', revision, target_state: 'AUTHORISED',
    receiving_specialist_acceptance: { accepted: true, specialist_id: 'jobs-manager', receiving_domain: 'finance' }
  }), /receiving-domain-mismatch/);
  const state = await lifecycle.transitionProcessing({
    item_id: 'job-risk-1', revision_id: 'r1', revision, target_state: 'AUTHORISED',
    receiving_specialist_acceptance: {
      accepted: true,
      specialist_id: 'jobs-manager-7',
      specialist_role: 'Jobs Agent Manager',
      receiving_domain: 'jobs',
      revision_id: 'r1',
      reason: 'Higher-risk job change satisfies receiving-domain controls.'
    }
  });
  const item = state.items.find(x => x.item_id === 'job-risk-1');
  assert.equal(item.state, 'AUTHORISED');
  assert.equal(item.authorised_revision_id, 'r1');
  assert.equal(item.authorised_revision_digest, item.revision_digest);
  assert.equal(item.authorised_by.specialist_id, 'jobs-manager-7');
  assert.equal(item.authorised_by.receiving_domain, 'jobs');
  assert.equal(item.operational_final, true);
  assert.equal(item.authorisation_required, true);
  assert.equal(state.authorised.length, 1);
  assert.equal(state.authorised[0].company_id, 'company-A');
});
test('authorisation remains bound to the exact approved revision', async () => {
  memory.clear();
  const revision = await approveElevated('job-risk-2');
  await assert.rejects(() => lifecycle.transitionProcessing({
    item_id: 'job-risk-2', revision_id: 'r1', revision: { ...revision, amount: 51000 }, target_state: 'AUTHORISED',
    receiving_specialist_acceptance: { accepted: true, specialist_id: 'jobs-manager', receiving_domain: 'jobs' }
  }), /revision-content-mismatch/);
});
test('authorised item is terminal for this lifecycle revision', async () => {
  const item = await lifecycle.getProcessingItem('job-risk-2');
  assert.equal(item.state, 'APPROVED');
});
test('implementation never introduces legacy tenant authority names', () => {
  assert.match(lifecycleText, /company_id/);
  assert.doesNotMatch(lifecycleText, /tenant_id|tenant_company_id/);
});
