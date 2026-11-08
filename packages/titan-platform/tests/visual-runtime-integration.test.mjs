import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planVisualRuntime,
  planVisualStateTransition,
  resolveVisualContribution,
  resolveVisualResource,
  VISUAL_RUNTIME_ID,
  createVisualRuntimeEnvelope,
} from '../.test-dist/runtime.js';

test('visual runtime is exposed through canonical TypeScript runtime', () => {
  assert.equal(VISUAL_RUNTIME_ID, 'visual-runtime');
  const plan = planVisualRuntime(
    { company_id: 'company-1', visualCapabilityRequirements: ['canvas'], motionPreset: 'standard' },
    { surface: 'zero', company_id: 'company-1', width: 480, lowPower: false },
    {},
    { canvas: true },
  );
  assert.equal(plan.density, 'compact');
  assert.equal(plan.strategy, 'preferred');
  assert.equal(plan.authorizes_actions, false);
  assert.equal(plan.business_meaning_unchanged, true);
  assert.equal(plan.tenant_boundary, 'company_id');
});

test('visual runtime deterministically degrades without increasing authority', () => {
  const plan = planVisualRuntime(
    { visualCapabilityRequirements: ['video'] },
    { surface: 'go', width: 390, connectivity: 'offline', lowPower: false },
    { reducedMotion: true },
    { video: true },
  );
  assert.equal(plan.motionPreset, 'none');
  assert.equal(plan.strategy, 'fallback');
  assert.equal(plan.fallback.reason, 'reduced-motion');
});

test('visual runtime rejects cross-company requests', () => {
  assert.throws(() => planVisualRuntime(
    { company_id: 'company-a' },
    { surface: 'hub', company_id: 'company-b' },
  ), /company_id boundary mismatch/);
});

test('visual state transitions preserve business meaning', () => {
  assert.deepEqual(planVisualStateTransition('loading', 'success'), {
    from: 'loading', to: 'success', motionPreset: 'state-change', durationMs: 180, businessMeaningChanged: false,
  });
  assert.equal(planVisualStateTransition('loading', 'success', { reducedMotion: true }).durationMs, 0);
});

test('visual contributions and resources resolve deterministically', () => {
  assert.equal(resolveVisualContribution('hero', [
    { slot: 'hero', provider: 'b', priority: 5 },
    { slot: 'hero', provider: 'a', priority: 10 },
  ])?.provider, 'a');
  assert.equal(resolveVisualResource('logo', 'asset', { surface: 'zero', company_id: '1' }, [
    { role: 'logo', kind: 'asset', uri: '/global.svg', priority: 1 },
    { role: 'logo', kind: 'asset', uri: '/company.svg', company_id: '1', priority: 5 },
  ])?.uri, '/company.svg');
});


test('visual runtime envelope is explicitly authority neutral', () => {
  const envelope = createVisualRuntimeEnvelope({ company_id: 'company-1' });
  assert.equal(envelope.authority_neutral, true);
  assert.equal(envelope.execution_authority, false);
  assert.equal(envelope.authority_conferred_by_activation, false);
});
