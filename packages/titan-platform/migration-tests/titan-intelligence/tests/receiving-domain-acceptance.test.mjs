import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PROCESSING_STATES, receiveForProcessing, transitionProcessing, getProcessingItem, getProcessingState
} from '../core/processing-lifecycle.mjs';

function chromeMemory() {
  const store = {};
  globalThis.chrome = { storage: { local: {
    async get(key) { return { [key]: structuredClone(store[key]) }; },
    async set(values) { Object.assign(store, structuredClone(values)); }
  } } };
  return store;
}

const revision = { booking_id: 'b-1', service: 'clean', start: '09:00' };
const checks = [{ check_id:'source-check', required:true, passed:true }];

async function receiveCrossDomain(item='cross-1') {
  await receiveForProcessing({
    item_id:item, company_id:'company-1', revision_id:'r1', revision,
    source_domain:'bookings', receiving_domain:'jobs'
  });
  await transitionProcessing({ item_id:item, revision_id:'r1', revision, target_state:'PROCESSING' });
}

test('pass 7 increments BOS package version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '0.18.2');
});

test('cross-domain PROCESSED requires a source-domain seal for the exact revision', async () => {
  chromeMemory();
  await receiveCrossDomain('source-seal');
  await assert.rejects(() => transitionProcessing({
    item_id:'source-seal', revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:checks
  }), /source-domain-seal-required/);
  await assert.rejects(() => transitionProcessing({
    item_id:'source-seal', revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:checks,
    source_domain_processing:{ processed:true, processor_id:'booking-agent', source_domain:'finance' }
  }), /source-domain-mismatch/);
  await transitionProcessing({
    item_id:'source-seal', revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:checks,
    source_domain_processing:{ processed:true, processor_id:'booking-agent', processor_role:'Booking Agent', source_domain:'bookings', revision_id:'r1' }
  });
  const item = await getProcessingItem('source-seal');
  assert.equal(item.state, PROCESSING_STATES.PROCESSED);
  assert.equal(item.source_domain_processing.processor_id, 'booking-agent');
  assert.equal(item.source_domain_processing.source_domain, 'bookings');
  assert.equal(item.source_domain_processing.revision_digest, item.revision_digest);
});

test('destination intelligence must independently accept exact revision before APPROVED', async () => {
  chromeMemory();
  await receiveCrossDomain('receiver-gate');
  await transitionProcessing({
    item_id:'receiver-gate', revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:checks,
    source_domain_processing:{ processed:true, processor_id:'booking-agent', source_domain:'bookings' }
  });
  await assert.rejects(() => transitionProcessing({
    item_id:'receiver-gate', revision_id:'r1', revision, target_state:'APPROVED'
  }), /requires-receiving-domain-acceptance/);
  await assert.rejects(() => transitionProcessing({
    item_id:'receiver-gate', revision_id:'r1', revision, target_state:'APPROVED',
    receiving_domain_acceptance:{ accepted:true, receiver_id:'booking-agent', receiving_domain:'jobs' }
  }), /independence-required/);
  await assert.rejects(() => transitionProcessing({
    item_id:'receiver-gate', revision_id:'r1', revision, target_state:'APPROVED',
    receiving_domain_acceptance:{ accepted:true, receiver_id:'jobs-agent', receiving_domain:'finance' }
  }), /receiving-domain-mismatch/);
  const state = await transitionProcessing({
    item_id:'receiver-gate', revision_id:'r1', revision, target_state:'APPROVED',
    receiving_domain_acceptance:{
      accepted:true, receiver_id:'jobs-agent', receiver_role:'Jobs Agent', receiving_domain:'jobs', revision_id:'r1',
      reason:'Destination domain independently accepts booking revision.'
    }
  });
  const item = state.items.find(x => x.item_id === 'receiver-gate');
  assert.equal(item.state, PROCESSING_STATES.APPROVED);
  assert.equal(item.receiving_domain_acceptance.receiver_id, 'jobs-agent');
  assert.equal(item.receiving_domain_acceptance.revision_digest, item.revision_digest);
  assert.equal(state.approved[0].receiving_domain, 'jobs');
  assert.equal(state.approved[0].source_domain, 'bookings');
});

test('receiving-domain acceptance is exact-revision bound', async () => {
  chromeMemory();
  await receiveCrossDomain('exact-receiver');
  await transitionProcessing({
    item_id:'exact-receiver', revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:checks,
    source_domain_processing:{ processed:true, processor_id:'booking-agent', source_domain:'bookings' }
  });
  const item = await getProcessingItem('exact-receiver');
  await assert.rejects(() => transitionProcessing({
    item_id:'exact-receiver', revision_id:'r1', revision, target_state:'APPROVED',
    receiving_domain_acceptance:{ accepted:true, receiver_id:'jobs-agent', receiving_domain:'jobs', revision_digest:'fnv1a32:deadbeef' }
  }), /revision-digest-mismatch/);
  assert.equal(item.state, PROCESSING_STATES.PROCESSED);
});

test('same-domain/local flow preserves normal canonical progression', async () => {
  chromeMemory();
  await receiveForProcessing({ item_id:'same-domain', company_id:'company-1', revision_id:'r1', revision, source_domain:'jobs', receiving_domain:'jobs' });
  await transitionProcessing({ item_id:'same-domain', revision_id:'r1', revision, target_state:'PROCESSING' });
  await transitionProcessing({ item_id:'same-domain', revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:checks });
  await transitionProcessing({ item_id:'same-domain', revision_id:'r1', revision, target_state:'APPROVED' });
  assert.equal((await getProcessingItem('same-domain')).state, PROCESSING_STATES.APPROVED);
});

test('material revision reset clears prior source and receiving acceptance', async () => {
  chromeMemory();
  await receiveCrossDomain('reset-cross');
  await transitionProcessing({
    item_id:'reset-cross', revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:checks,
    source_domain_processing:{ processed:true, processor_id:'booking-agent', source_domain:'bookings' }
  });
  await transitionProcessing({
    item_id:'reset-cross', revision_id:'r1', revision, target_state:'APPROVED',
    receiving_domain_acceptance:{ accepted:true, receiver_id:'jobs-agent', receiving_domain:'jobs' }
  });
  const revision2 = { ...revision, start:'10:00' };
  await receiveForProcessing({ item_id:'reset-cross', company_id:'company-1', revision_id:'r2', revision:revision2, source_domain:'bookings', receiving_domain:'jobs' });
  const item = await getProcessingItem('reset-cross');
  assert.equal(item.state, PROCESSING_STATES.PROCESSING);
  assert.equal(item.source_domain_processing, null);
  assert.equal(item.receiving_domain_acceptance, null);
  assert.equal((await getProcessingState()).approved.some(x => x.item_id === 'reset-cross'), false);
});
