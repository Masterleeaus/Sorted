import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyRisk, riskRequiresElevatedAuthorisation } from '../core/risk-classification.mjs';

const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));

test('pass 8 increments BOS package version', () => assert.equal(manifest.version, '0.18.2'));

test('low risk remains deterministic and model-free', () => {
  const a = classifyRisk({ company_id:'c1', item_id:'i1', revision_id:'r1', classified_at:1, evidence:{} });
  assert.equal(a.level, 'low'); assert.equal(a.deterministic, true); assert.equal(a.model_used, false);
  assert.equal(a.topology_constraints.adversarial_review_required, false);
});

test('medium risk is produced from accumulated deterministic evidence', () => {
  const a = classifyRisk({ company_id:'c1', evidence:{ cross_domain:true, external_propagation:true } });
  assert.equal(a.level, 'medium');
  assert.equal(a.score, 26);
  assert.equal(a.topology_constraints.minimum_independent_paths, 2);
});

test('hard high-risk evidence cannot be diluted by a low score', () => {
  const a = classifyRisk({ company_id:'c1', evidence:{ privileged_change:true } });
  assert.equal(a.level, 'high');
  assert.equal(riskRequiresElevatedAuthorisation(a), true);
  assert.equal(a.topology_constraints.specialist_review_required, true);
});

test('exceptional risk is forced for cross-company authority attempts', () => {
  const a = classifyRisk({ company_id:'c1', evidence:{ cross_company_boundary_attempt:true } });
  assert.equal(a.level, 'exceptional');
  assert.deepEqual(a.exceptional_reasons, ['cross-company-boundary-attempt']);
  assert.equal(a.topology_constraints.sovereign_isolation_eligible, true);
});

test('sovereign authenticity uncertainty becomes exceptional', () => {
  const a = classifyRisk({ company_id:'c1', evidence:{ sovereign_authority_affected:true, critical_authenticity_unresolved:true } });
  assert.equal(a.level, 'exceptional');
});

test('financial thresholds are deterministic and monotonic', () => {
  const low = classifyRisk({ company_id:'c1', evidence:{ financial_amount:500 } });
  const med = classifyRisk({ company_id:'c1', evidence:{ financial_amount:10000 } });
  const high = classifyRisk({ company_id:'c1', evidence:{ financial_amount:100000 } });
  assert.equal(low.level, 'low'); assert.equal(med.level, 'low'); assert.equal(high.level, 'high');
  assert.ok(low.score < med.score && med.score < high.score);
});

test('company_id is mandatory and no legacy tenant boundary is accepted', () => {
  assert.throws(() => classifyRisk({ tenant_id:'legacy', evidence:{} }), /risk-company-id-required/);
});
