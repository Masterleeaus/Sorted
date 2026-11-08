import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CANONICAL_LENSES, LENS_TEAM_ROUTES, assignIntelligenceLenses, validateLensAssignment } from '../core/lens-assignment.mjs';

const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../core/lens-assignment.mjs', import.meta.url), 'utf8');

test('pass 11 increments BOS package version', () => assert.equal(manifest.version, '0.18.2'));
test('engine exposes the six canonical lenses in stable order', () => {
  assert.deepEqual(CANONICAL_LENSES, ['meaning-context','provenance-reality','temporal','relational','consequence','anomaly']);
});
test('low-risk ordinary event receives only baseline meaning/context', () => {
  const result = assignIntelligenceLenses({ company_id:'c1', item_id:'i1', revision_id:'r1', assigned_at:1 });
  assert.deepEqual(result.selected.map(x => x.lens), ['meaning-context']);
  assert.equal(result.model_used, false); assert.equal(result.pre_analysis, true); assert.equal(result.conclusions_consumed, false);
  assert.equal(validateLensAssignment(result), true);
});
test('structured characteristics dynamically add orthogonal lenses', () => {
  const result = assignIntelligenceLenses({
    company_id:'c1', item_id:'booking-1', revision_id:'r4', assigned_at:2,
    characteristics:{ external_source:true, sequence_sensitive:true, cross_domain:true, financial_effect:true, signature_shift:true }
  });
  assert.deepEqual(result.selected.map(x => x.lens), CANONICAL_LENSES);
  assert.deepEqual(result.team_routes.A.map(x => x.analysis_lens), ['meaning-context','temporal-causal','consequence-state-transition']);
  assert.deepEqual(result.team_routes.B.map(x => x.analysis_lens), ['provenance-reality','relational-consistency','anomaly-signature']);
});
test('medium risk guarantees provenance and consequence checks without forcing all lenses', () => {
  const result = assignIntelligenceLenses({ company_id:'c1', risk_level:'medium', assigned_at:3 });
  assert.deepEqual(result.selected.map(x => x.lens), ['meaning-context','provenance-reality','consequence']);
});
test('high and exceptional risk progressively increase lens coverage', () => {
  const high = assignIntelligenceLenses({ company_id:'c1', risk_level:'high', assigned_at:4 });
  const exceptional = assignIntelligenceLenses({ company_id:'c1', risk_level:'exceptional', assigned_at:5 });
  assert.deepEqual(high.selected.map(x => x.lens), CANONICAL_LENSES);
  assert.deepEqual(exceptional.selected.map(x => x.lens), CANONICAL_LENSES);
  assert.ok(exceptional.selected.every(x => x.reasons.includes('exceptional-risk-full-lens-coverage')));
});
test('explicit structured required lenses are validated and explainable', () => {
  const result = assignIntelligenceLenses({ company_id:'c1', required_lenses:['relational'], assigned_at:6 });
  assert.deepEqual(result.selected.map(x => x.lens), ['meaning-context','relational']);
  assert.ok(result.selected[1].reasons.includes('explicit-structured-requirement'));
  assert.throws(() => assignIntelligenceLenses({ company_id:'c1', required_lenses:['invented'] }), /required-lens-invalid/);
});
test('assignment rejects analysis conclusions and does not import Team A or Team B modules', () => {
  assert.throws(() => assignIntelligenceLenses({ company_id:'c1', team_outputs:{ teamA:{ interpretation:'valid' } } }), /analysis-contaminated/);
  assert.throws(() => assignIntelligenceLenses({ company_id:'c1', prior_analysis:{ convergence:{ score:1 } } }), /analysis-contaminated/);
  assert.doesNotMatch(source, /from\s+['"].*intelligence-team-[ab]\.mjs['"]/);
});
test('routes preserve Team A and Team B orthogonality', () => {
  assert.equal(LENS_TEAM_ROUTES['meaning-context'].team, 'A');
  assert.equal(LENS_TEAM_ROUTES.temporal.team, 'A');
  assert.equal(LENS_TEAM_ROUTES.consequence.team, 'A');
  assert.equal(LENS_TEAM_ROUTES['provenance-reality'].team, 'B');
  assert.equal(LENS_TEAM_ROUTES.relational.team, 'B');
  assert.equal(LENS_TEAM_ROUTES.anomaly.team, 'B');
});
test('company_id remains mandatory sole company boundary', () => {
  assert.throws(() => assignIntelligenceLenses({ tenant_id:'legacy' }), /company-id-required/);
});
