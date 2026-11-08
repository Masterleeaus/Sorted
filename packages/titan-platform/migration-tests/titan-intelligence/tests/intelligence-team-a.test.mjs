import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTeamAAnalysis, verifyTeamASeal } from '../core/intelligence-team-a.mjs';

const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
const base = { company_id:'c1', item_id:'i1', revision_id:'r1', analysis_id:'a1', lens:'meaning-context', evidence:[{ evidence_id:'e1', kind:'observation', source:'local-event', claim:'Booking contains a valid customer request.', confidence:0.9 }], interpretation:'The event means a customer booking request should enter source-domain processing.', confidence:0.84, unresolved:['customer-preference-not-confirmed'], sealed_at:123 };

test('pass 9 increments BOS package version', () => assert.equal(manifest.version, '0.18.2'));
test('Team A produces a sealed independent exact-revision analysis', async () => {
  const a = await createTeamAAnalysis(base);
  assert.equal(a.team, 'A'); assert.equal(a.independent, true); assert.equal(a.sealed, true);
  assert.equal(a.revision_id, 'r1'); assert.equal(a.confidence, 0.84); assert.match(a.seal_digest, /^[a-f0-9]{64}$/);
  assert.equal(await verifyTeamASeal(a), true); assert.equal(Object.isFrozen(a), true); assert.equal(Object.isFrozen(a.evidence), true);
});
test('Team A seal fails if interpretation is altered', async () => {
  const a = await createTeamAAnalysis(base); const copy = structuredClone(a); copy.interpretation = 'changed';
  assert.equal(await verifyTeamASeal(copy), false);
});
test('Team A rejects Team B or C contamination before sealing', async () => {
  await assert.rejects(() => createTeamAAnalysis({ ...base, team_b:{ result:'agree' } }), /team-a-independence-contaminated/);
  await assert.rejects(() => createTeamAAnalysis({ ...base, convergence:{ score:1 } }), /team-a-independence-contaminated/);
});
test('Team A requires company_id and exact revision', async () => {
  await assert.rejects(() => createTeamAAnalysis({ ...base, company_id:'' }), /team-a-company-id-required/);
  await assert.rejects(() => createTeamAAnalysis({ ...base, revision_id:'' }), /team-a-revision-id-required/);
});
test('Team A confidence is bounded rather than averaged or guessed', async () => {
  await assert.rejects(() => createTeamAAnalysis({ ...base, confidence:1.1 }), /team-a-confidence-invalid/);
});
