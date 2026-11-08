import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITAN_WORKFORCE_LIFECYCLE_STATES,
  TITAN_WORKFORCE_LIFECYCLE_INVENTORY,
  TITAN_WORKFORCE_LIFECYCLE_CONTRACT,
  assertTitanWorkforceLifecycleCompany,
  isTitanWorkforceAssignableState,
} from '../.lifecycle-test-dist/workforce-lifecycle/index.js';

test('lifecycle state model is explicit and retains retirement history', () => {
  assert.deepEqual([...TITAN_WORKFORCE_LIFECYCLE_STATES], ['REGISTERED','ENABLED','PAUSED','DRAINING','DISABLED','DEGRADED','RETIRED']);
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.retiredStateRetainsHistory, true);
});

test('lifecycle inventory reuses existing Titan registry/config/install seams', () => {
  const ids = new Set(TITAN_WORKFORCE_LIFECYCLE_INVENTORY.map((entry) => entry.id));
  for (const required of ['module-registry','lifecycle-access','lifecycle-history','starter-agent-registry','settings-defaults','settings-overrides','installation-planner','migration-safety']) assert.equal(ids.has(required), true, required);
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_INVENTORY.some((entry) => entry.reuse === 'REUSE'), true);
});

test('lifecycle is company_id only and identity never grants authority', () => {
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.companyBoundary, 'company_id');
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.identityGrantsAuthority, false);
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.automaticAuthorityChange, false);
  assert.equal(assertTitanWorkforceLifecycleCompany('company-1'), 'company-1');
  assert.throws(() => assertTitanWorkforceLifecycleCompany(''), /company_id-required/);
});

test('agents cannot self-install, self-upgrade or self-retire', () => {
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.lifecycleAuthority, 'platform_manager');
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.agentMaySelfInstall, false);
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.agentMaySelfUpgrade, false);
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_CONTRACT.agentMaySelfRetire, false);
});

test('only enabled and ready agents are assignable', () => {
  assert.equal(isTitanWorkforceAssignableState('ENABLED','READY'), true);
  assert.equal(isTitanWorkforceAssignableState('PAUSED','READY'), false);
  assert.equal(isTitanWorkforceAssignableState('ENABLED','DEGRADED'), false);
  assert.equal(isTitanWorkforceAssignableState('DRAINING','READY'), false);
  assert.equal(isTitanWorkforceAssignableState('RETIRED','READY'), false);
});
