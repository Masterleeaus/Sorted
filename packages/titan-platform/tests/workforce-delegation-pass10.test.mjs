import test from 'node:test';
import assert from 'node:assert/strict';
import { runTitanDelegationWorkloadCertification } from '../.test-dist/workforce-delegation/index.js';

test('workload-scale certification passes across 500 isolated delegations', async () => {
  const result = await runTitanDelegationWorkloadCertification({ workload_count: 500, company_count: 25 });
  assert.equal(result.passed, true);
  assert.equal(result.workload_count, 500);
  assert.equal(result.company_count, 25);
  assert.equal(result.route_selections, 500);
  assert.equal(result.route_failures, 0);
  assert.equal(result.simulation_failures, 0);
  assert.equal(result.authority_violations, 0);
  assert.equal(result.execution_permission_leaks, 0);
  assert.equal(result.cross_company_leaks, 0);
  assert.equal(Object.values(result.scenario_counts).reduce((sum, n) => sum + n, 0), 500);
  assert.equal(result.grants_authority, false);
  assert.equal(result.authority_effect, false);
  assert.equal(result.execution_permitted, false);
});

test('workload certification is deterministic across repeated runs', async () => {
  const a = await runTitanDelegationWorkloadCertification({ workload_count: 125, company_count: 5 });
  const b = await runTitanDelegationWorkloadCertification({ workload_count: 125, company_count: 5 });
  assert.deepEqual(a, b);
});

test('seam audit retains canonical owners and removes nothing without proof', async () => {
  const result = await runTitanDelegationWorkloadCertification({ workload_count: 10, company_count: 2 });
  assert.equal(result.removal_assessment, 'NO_SAFE_REDUNDANT_ROUTING_SEAM_FOUND');
  assert.deepEqual(result.removed_redundant_seams, []);
  assert.deepEqual(result.canonical_seams.map((entry) => entry.disposition), ['RETAIN','RETAIN','RETAIN','RETAIN','RETAIN']);
  assert.ok(result.canonical_seams.some((entry) => entry.owner === 'titan-runtime/authority'));
  assert.ok(result.canonical_seams.some((entry) => entry.owner === 'titan-modules/workflow-runtime'));
});

test('certification bounds workload inputs to prevent accidental stress misuse', async () => {
  await assert.rejects(() => runTitanDelegationWorkloadCertification({ workload_count: 5001 }), /workload-count-invalid/);
  await assert.rejects(() => runTitanDelegationWorkloadCertification({ workload_count: 10, company_count: 11 }), /company-count-invalid/);
});
