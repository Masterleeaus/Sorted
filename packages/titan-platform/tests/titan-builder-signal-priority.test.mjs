import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeBuilderWorkspace } from '../.test-dist/titan-builder/signal-priority.js';
import { planBuilderWorkspace, applyBuilderWorkspacePlan } from '../.test-dist/titan-builder/workspace-planner.js';

const now = '2026-10-02T00:00:00Z';
const section = (intent) => ({ role: 'supporting', intent, node: { type: 'card', props: { id: intent } } });
const plan = { purpose: 'test', surface: 'zero', max_visible_cards: 3, chat_first: true,
  authority_granted: false, sections: [section('generic'), section('review'), section('schedule')] };
const signal = (id, intent, overrides = {}) => ({ id, intent, company_id: 'company-a',
  surface: 'zero', severity: 'warning', observed_at: now, ...overrides });
const prioritize = (signals, overrides = {}) => prioritizeBuilderWorkspace(plan,
  { company_id: 'company-a', now, signals, ...overrides });

test('signal priority normalizes company scope while excluding foreign company and surface inputs', () => {
  const result = prioritize([
    signal('foreign-company', 'generic', { company_id: 'company-b', severity: 'critical' }),
    signal('foreign-surface', 'generic', { surface: 'hub', severity: 'critical' }),
    signal('local', 'review', { company_id: ' company-a ' }),
  ], { company_id: ' company-a ' });
  assert.equal(result.sections[0].intent, 'review');
  assert.equal(result.sections[0].node.props.signal_priority.id, 'local');
  assert.equal(result.sections.find(s => s.intent === 'generic').node.props.signal_priority, undefined);
  assert.throws(() => prioritize([], { company_id: '  ' }), /company_id-required/);
});

test('signal priority uses severity freshness and bounded impact without granting authority or adding actions', () => {
  const signals = [signal('old', 'generic', { observed_at: '2026-09-01T00:00:00Z' }),
    signal('fresh', 'review'), signal('critical', 'schedule', { severity: 'critical', impact: 999 })];
  const before = structuredClone(plan);
  const result = prioritize(signals);
  assert.deepEqual(result.sections.map(s => s.intent), ['schedule', 'review', 'generic']);
  assert.deepEqual(result.sections.map(s => s.node.props.signal_priority.score), [150, 85, 55]);
  for (const s of result.sections) {
    assert.equal(s.node.props.signal_priority.advisory_only, true);
    assert.equal(s.node.props.signal_priority.authority_granted, false);
    assert.equal(s.role, 'attention');
    assert.equal(s.node.actions, undefined);
  }
  assert.equal(result.authority_granted, false);
  assert.deepEqual(plan, before);
});

test('signal priority preserves stable ties and card limit and rejects malformed observation timestamps', () => {
  const signals = plan.sections.map(s => signal(s.intent, s.intent));
  const result = prioritizeBuilderWorkspace({ ...plan, max_visible_cards: 2 },
    { company_id: 'company-a', now, signals });
  assert.deepEqual(result.sections.map(s => s.intent), ['generic', 'review']);
  assert.equal(prioritize([signal('invalid', 'review', { observed_at: 'invalid' })]), plan);
  const tied = prioritize([signal('z', 'review'), signal('a', 'review')]);
  assert.equal(tied.sections[0].node.props.signal_priority.id, 'a');
});

test('workspace planner applies supplied priority context', () => {
  const base = planBuilderWorkspace('zero', 'Review schedule');
  assert.ok(base.sections.length > 1);
  const intent = base.sections.at(-1).intent;
  const document = { surface: 'zero', root: { type: 'workspace', children: [] } };
  const result = applyBuilderWorkspacePlan(document, 'Review schedule', {
    company_id: 'company-a', now, signals: [signal('planner', intent, { severity: 'critical' })],
  });
  assert.equal(result.root.children[0].props.signal_priority.id, 'planner');
  assert.deepEqual(result.root.children[0].actions, base.sections.at(-1).node.actions);
  const authored = { ...document, root: { ...document.root, children: [section('generic').node] } };
  assert.equal(applyBuilderWorkspacePlan(authored, 'Review schedule', { company_id: 'company-a', now, signals: [] }), authored);
});
