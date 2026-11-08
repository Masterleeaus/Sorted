import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEAM_B_LENSES, createTeamBAnalysis, verifyTeamBSeal } from '../core/intelligence-team-b.mjs';

const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
const moduleSource = await readFile(new URL('../core/intelligence-team-b.mjs', import.meta.url), 'utf8');
const base = {
  company_id:'c1', item_id:'i1', revision_id:'r1', analysis_id:'b1', lens:'provenance-reality',
  evidence:[
    { evidence_id:'e1', kind:'provenance', source:'browser-event-ledger', claim:'The booking event originated from the expected company-bound channel.', confidence:0.93, provenance:{ company_id:'c1', channel:'web-booking' } },
    { evidence_id:'e2', kind:'consistency', source:'local-relationship-graph', claim:'Customer, service and booking references are internally consistent.', confidence:0.88 }
  ],
  interpretation:'The event appears authentic and internally consistent with its claimed source and relationships.',
  confidence:0.87, unresolved:['upstream-signature-not-yet-available'], sealed_at:456
};

test('pass 10 increments BOS package version', () => assert.equal(manifest.version, '0.18.2'));
test('Team B lenses are orthogonal to Team A meaning/context lens family', () => {
  assert.deepEqual(TEAM_B_LENSES, ['provenance-reality','relational-consistency','anomaly-signature','authenticity-integrity']);
  assert.equal(TEAM_B_LENSES.includes('meaning-context'), false);
  assert.equal(TEAM_B_LENSES.includes('temporal-causal'), false);
});
test('Team B module has no Team A module dependency', () => {
  assert.doesNotMatch(moduleSource, /from\s+['"].*intelligence-team-a\.mjs['"]/);
});
test('Team B produces a sealed independent exact-revision analysis', async () => {
  const b = await createTeamBAnalysis(base);
  assert.equal(b.team, 'B'); assert.equal(b.independent, true); assert.equal(b.sealed, true);
  assert.equal(b.information_firewall, 'team-a-conclusions-unavailable');
  assert.equal(b.revision_id, 'r1'); assert.equal(b.confidence, 0.87); assert.match(b.seal_digest, /^[a-f0-9]{64}$/);
  assert.equal(await verifyTeamBSeal(b), true); assert.equal(Object.isFrozen(b), true); assert.equal(Object.isFrozen(b.evidence), true);
});
test('Team B seal fails if its independent interpretation is altered', async () => {
  const b = await createTeamBAnalysis(base); const copy = structuredClone(b); copy.interpretation = 'changed';
  assert.equal(await verifyTeamBSeal(copy), false);
});
test('Team B rejects Team A conclusions or comparison fields before sealing', async () => {
  await assert.rejects(() => createTeamBAnalysis({ ...base, team_a:{ interpretation:'Team A says valid' } }), /team-b-independence-contaminated/);
  await assert.rejects(() => createTeamBAnalysis({ ...base, context:{ comparison:{ with_team_a:true } } }), /team-b-independence-contaminated/);
  await assert.rejects(() => createTeamBAnalysis({ ...base, convergence:{ score:1 } }), /team-b-independence-contaminated/);
});
test('Team B rejects Team A as an evidence source or provenance authority', async () => {
  await assert.rejects(() => createTeamBAnalysis({ ...base, evidence:[{ evidence_id:'x', source:'team-a', claim:'A conclusion' }] }), /team-b-independence-contaminated/);
  await assert.rejects(() => createTeamBAnalysis({ ...base, evidence:[{ evidence_id:'x', source:'cache', claim:'cached', provenance:{ teamA:{ analysis_id:'a1' } } }] }), /team-b-independence-contaminated/);
});
test('Team B requires company_id, exact revision and bounded confidence', async () => {
  await assert.rejects(() => createTeamBAnalysis({ ...base, company_id:'' }), /team-b-company-id-required/);
  await assert.rejects(() => createTeamBAnalysis({ ...base, revision_id:'' }), /team-b-revision-id-required/);
  await assert.rejects(() => createTeamBAnalysis({ ...base, confidence:-0.1 }), /team-b-confidence-invalid/);
});
