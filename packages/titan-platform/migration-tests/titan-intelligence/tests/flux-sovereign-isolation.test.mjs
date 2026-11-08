import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
const memory = new Map();
globalThis.chrome = { storage: { local: {
  async get(key) { return { [key]: memory.get(key) }; },
  async set(obj) { for (const [key, value] of Object.entries(obj)) memory.set(key, structuredClone(value)); }
}}};
const lifecycle = await import('../core/processing-lifecycle.mjs');

async function approve(itemId='flux-1', elevated=false) {
  const revision = { amount: elevated ? 80000 : 800, action: 'supplier-change' };
  await lifecycle.receiveForProcessing({ item_id:itemId, company_id:'company-A', revision_id:'r1', revision, requires_authorisation:elevated, receiving_domain:elevated?'finance':null });
  await lifecycle.transitionProcessing({ item_id:itemId, revision_id:'r1', revision, target_state:'PROCESSING' });
  await lifecycle.transitionProcessing({ item_id:itemId, revision_id:'r1', revision, target_state:'PROCESSED', intelligence_checks:[{id:'reality',required:true,passed:true}] });
  await lifecycle.transitionProcessing({ item_id:itemId, revision_id:'r1', revision, target_state:'APPROVED' });
  if (elevated) await lifecycle.transitionProcessing({ item_id:itemId, revision_id:'r1', revision, target_state:'AUTHORISED', receiving_specialist_acceptance:{accepted:true,specialist_id:'finance-manager',receiving_domain:'finance'} });
  return revision;
}

test('pass 4 increments BOS package version', () => assert.equal(manifest.version, '0.18.2'));
test('FLUX is exceptional and is not inserted into the normal processing order', () => {
  assert.equal(lifecycle.PROCESSING_STATES.FLUX, 'FLUX');
  assert.deepEqual(lifecycle.PROCESSING_ORDER, ['RECEIVED','PROCESSING','PROCESSED','APPROVED']);
});
test('approved item entering FLUX loses active authority but preserves evidence and history', async () => {
  memory.clear(); const revision = await approve();
  let state = await lifecycle.transitionProcessing({ item_id:'flux-1', revision_id:'r1', revision, target_state:'FLUX', flux_isolation:{reason:'Conflicting provenance requires sovereign review',isolated_by:'zero-assurance',authority:'T0GM',evidence_refs:['evidence:a','evidence:b']} });
  const item = state.items.find(x=>x.item_id==='flux-1');
  assert.equal(item.state,'FLUX'); assert.equal(item.flux_prior_state,'APPROVED');
  assert.equal(item.authority_suspended,true); assert.equal(item.propagation_blocked,true);
  assert.equal(item.revision_id,'r1'); assert.equal(item.history.at(-1).prior_state,'APPROVED');
  assert.deepEqual(item.flux_isolation.evidence_refs,['evidence:a','evidence:b']);
  assert.equal(state.approved.some(x=>x.item_id==='flux-1'),false);
  assert.equal(state.flux.some(x=>x.item_id==='flux-1'),true);
});
test('authorised item can be sovereignly isolated and active authorisation is withdrawn', async () => {
  memory.clear(); const revision = await approve('flux-auth',true);
  const state = await lifecycle.transitionProcessing({ item_id:'flux-auth', revision_id:'r1', revision, target_state:'FLUX', flux_isolation:{reason:'High-risk authenticity challenge',isolated_by:'t0gm-review'} });
  const item=state.items.find(x=>x.item_id==='flux-auth');
  assert.equal(item.flux_prior_state,'AUTHORISED'); assert.equal(item.authorised_revision_id,'r1');
  assert.equal(state.authorised.some(x=>x.item_id==='flux-auth'),false);
});
test('FLUX requires explicit isolation provenance and blocks normal lifecycle continuation', async () => {
  memory.clear(); const revision=await approve('flux-block');
  await assert.rejects(()=>lifecycle.transitionProcessing({item_id:'flux-block',revision_id:'r1',revision,target_state:'FLUX',flux_isolation:{isolated_by:'zero'}}),/flux-reason-required/);
  await lifecycle.transitionProcessing({item_id:'flux-block',revision_id:'r1',revision,target_state:'FLUX',flux_isolation:{reason:'Hold for review',isolated_by:'zero'}});
  await assert.rejects(()=>lifecycle.transitionProcessing({item_id:'flux-block',revision_id:'r1',revision,target_state:'APPROVED'}),/flux-state-isolated/);
});
test('FLUX remains bound to exact revision content', async () => {
  memory.clear(); const revision=await approve('flux-revision');
  await assert.rejects(()=>lifecycle.transitionProcessing({item_id:'flux-revision',revision_id:'r1',revision:{...revision,amount:999},target_state:'FLUX',flux_isolation:{reason:'Review',isolated_by:'zero'}}),/revision-content-mismatch/);
});
