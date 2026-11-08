import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PROCESSING_STATES, receiveForProcessing, transitionProcessing, getProcessingState, getProcessingItem
} from '../core/processing-lifecycle.mjs';

function chromeMemory() {
  const store = {};
  globalThis.chrome = { storage: { local: {
    async get(key) { return { [key]: structuredClone(store[key]) }; },
    async set(values) { Object.assign(store, structuredClone(values)); }
  } } };
  return store;
}

const checks = [{ check_id:'required', required:true, passed:true }];

async function approve(item='item-1', requires_authorisation=false) {
  await receiveForProcessing({ item_id:item, company_id:'company-1', revision_id:'r1', revision:{ amount:10 }, requires_authorisation, receiving_domain:'jobs' });
  await transitionProcessing({ item_id:item, revision_id:'r1', revision:{ amount:10 }, target_state:'PROCESSING' });
  await transitionProcessing({ item_id:item, revision_id:'r1', revision:{ amount:10 }, target_state:'PROCESSED', intelligence_checks:checks });
  await transitionProcessing({ item_id:item, revision_id:'r1', revision:{ amount:10 }, target_state:'APPROVED', intelligence_checks:checks });
}

test('pass 6 increments BOS package version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '0.18.2');
});

test('material change after APPROVED automatically returns exact new revision to PROCESSING', async () => {
  chromeMemory();
  await approve('approved-item');
  await receiveForProcessing({ item_id:'approved-item', company_id:'company-1', revision_id:'r2', revision:{ amount:25 }, material_change:true, material_change_reason:'price changed', changed_by:'booking-agent' });
  const item = await getProcessingItem('approved-item');
  assert.equal(item.state, PROCESSING_STATES.PROCESSING);
  assert.equal(item.revision_id, 'r2');
  assert.equal(item.titan_compliant, false);
  assert.equal(item.approved_revision_id, null);
  assert.deepEqual(item.intelligence_checks, []);
  assert.equal(item.history.at(-1).event, 'MATERIAL_REVISION_RESET');
  const state = await getProcessingState();
  assert.equal(state.approved.some(x => x.item_id === 'approved-item'), false);
  assert.equal(state.revision_resets.at(-1).prior_state, PROCESSING_STATES.APPROVED);
});

test('material change after AUTHORISED withdraws both approval and authorisation projections', async () => {
  chromeMemory();
  await approve('authorised-item', true);
  await transitionProcessing({
    item_id:'authorised-item', revision_id:'r1', revision:{ amount:10 }, target_state:'AUTHORISED',
    receiving_specialist_acceptance:{ accepted:true, specialist_id:'jobs-manager', receiving_domain:'jobs', revision_id:'r1' }
  });
  await receiveForProcessing({ item_id:'authorised-item', company_id:'company-1', revision_id:'r2', revision:{ amount:11 }, material_change_reason:'scope changed' });
  const item = await getProcessingItem('authorised-item');
  const state = await getProcessingState();
  assert.equal(item.state, PROCESSING_STATES.PROCESSING);
  assert.equal(item.previous_authority_state, PROCESSING_STATES.AUTHORISED);
  assert.equal(state.approved.some(x => x.item_id === 'authorised-item'), false);
  assert.equal(state.authorised.some(x => x.item_id === 'authorised-item'), false);
});

test('new revision cannot inherit prior intelligence checks or skip back to APPROVED', async () => {
  chromeMemory();
  await approve('fresh-checks');
  await receiveForProcessing({ item_id:'fresh-checks', company_id:'company-1', revision_id:'r2', revision:{ amount:50 } });
  await assert.rejects(() => transitionProcessing({ item_id:'fresh-checks', revision_id:'r2', revision:{ amount:50 }, target_state:'APPROVED' }), /transition-invalid|approval-requires/);
  await assert.rejects(() => transitionProcessing({ item_id:'fresh-checks', revision_id:'r2', revision:{ amount:50 }, target_state:'PROCESSED' }), /intelligence-checks-not-passed/);
});

test('same approved exact revision remains idempotent and company boundary cannot change', async () => {
  chromeMemory();
  await approve('same-revision');
  await receiveForProcessing({ item_id:'same-revision', company_id:'company-1', revision_id:'r1', revision:{ amount:10 } });
  assert.equal((await getProcessingItem('same-revision')).state, PROCESSING_STATES.APPROVED);
  await assert.rejects(() => receiveForProcessing({ item_id:'same-revision', company_id:'company-2', revision_id:'r2', revision:{ amount:12 } }), /company-boundary-mismatch/);
});

test('caller cannot label changed approved revision non-material to preserve authority', async () => {
  chromeMemory();
  await approve('material-guard');
  await assert.rejects(() => receiveForProcessing({ item_id:'material-guard', company_id:'company-1', revision_id:'r2', revision:{ amount:12 }, material_change:false }), /must-be-reprocessed/);
  assert.equal((await getProcessingItem('material-guard')).state, PROCESSING_STATES.APPROVED);
});
