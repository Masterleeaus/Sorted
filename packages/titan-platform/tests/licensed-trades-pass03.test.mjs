import test from 'node:test';
import assert from 'node:assert/strict';
const t = await import('../.licensed-trades-test-dist/triage.js');

test('Pass 3 emits trade-aware intake prompts without safety instructions', () => {
  const p = t.buildLicensedTradeIntakeQuestions('plumbing', 'plumbing.fault.leak-blockage');
  const e = t.buildLicensedTradeIntakeQuestions('electrical', 'electrical.fault.power-circuit');
  const h = t.buildLicensedTradeIntakeQuestions('hvac', 'hvac.fault.no-cooling-heating');
  assert.ok(p.questions.some((q) => q.includes('water flow')));
  assert.ok(e.questions.some((q) => q.includes('switchboard')));
  assert.ok(h.questions.some((q) => q.includes('airflow')));
  assert.equal(p.questions_are_safety_instructions, false);
  assert.equal(e.questions_grant_authority, false);
});

test('Pass 3 explicit danger report fails closed to emergency attendance', () => {
  const out = t.evaluateLicensedTradeTriage({
    company_id: 'company_demo', trade: 'electrical', service_key: 'electrical.fault.power-circuit',
    risk_signals: ['IMMEDIATE_DANGER_REPORTED'], configured_policy_reference: 'policy/electrical/current'
  });
  assert.equal(out.urgency, 'EMERGENCY');
  assert.equal(out.decision, 'ATTENDANCE_REQUIRED');
  assert.ok(out.reasons.includes('immediate_danger_reported'));
  assert.equal(out.vertical_dispatches_automatically, false);
});

test('Pass 3 emergency catalogue rows require attendance even without extra signals', () => {
  const out = t.evaluateLicensedTradeTriage({
    company_id: 'company_demo', trade: 'plumbing', service_key: 'plumbing.emergency.water-loss',
    configured_policy_reference: 'policy/plumbing/current'
  });
  assert.equal(out.urgency, 'EMERGENCY');
  assert.equal(out.decision, 'ATTENDANCE_REQUIRED');
});

test('Pass 3 active damage or essential service loss raises urgency without auto-dispatch', () => {
  const out = t.evaluateLicensedTradeTriage({
    company_id: 'company_demo', trade: 'hvac', service_key: 'hvac.fault.no-cooling-heating',
    risk_signals: ['ESSENTIAL_SERVICE_LOSS','VULNERABLE_SITE'], configured_policy_reference: 'policy/hvac/current'
  });
  assert.equal(out.urgency, 'URGENT');
  assert.equal(out.decision, 'ATTENDANCE_REQUIRED');
  assert.equal(out.vertical_dispatches_automatically, false);
  assert.equal(out.vertical_books_automatically, false);
});

test('Pass 3 high-risk/compliance work stays manual-review and policy dependent', () => {
  const out = t.evaluateLicensedTradeTriage({
    company_id: 'company_demo', trade: 'electrical', service_key: 'electrical.compliance.inspection',
    requested_outcome: 'QUOTE'
  });
  assert.equal(out.decision, 'MANUAL_REVIEW');
  assert.ok(out.reasons.includes('configured_policy_reference_missing'));
  assert.equal(out.vertical_certifies_compliance, false);
});

test('Pass 3 standard maintenance can remain quote eligible when scope/policy are present', () => {
  const out = t.evaluateLicensedTradeTriage({
    company_id: 'company_demo', trade: 'hvac', service_key: 'hvac.maintenance.preventive',
    configured_policy_reference: 'policy/hvac/current', scope_confirmed: true, asset_context_available: true,
    requested_outcome: 'QUOTE'
  });
  assert.equal(out.urgency, 'ROUTINE');
  assert.equal(out.decision, 'QUOTE_ALLOWED');
  assert.equal(out.vertical_quotes_automatically, false);
});

test('Pass 3 unknown condition forces review instead of optimistic quote', () => {
  const out = t.evaluateLicensedTradeTriage({
    company_id: 'company_demo', trade: 'plumbing', service_key: 'plumbing.maintenance.preventive',
    configured_policy_reference: 'policy/plumbing/current', risk_signals: ['UNKNOWN_CONDITION']
  });
  assert.equal(out.decision, 'MANUAL_REVIEW');
  assert.ok(out.reasons.includes('unknown_condition'));
});

test('Pass 3 rejects cross-trade service keys and legacy tenant boundaries', () => {
  assert.throws(() => t.evaluateLicensedTradeTriage({ company_id:'c', trade:'plumbing', service_key:'electrical.fault.power-circuit' }), /does not belong/);
  assert.throws(() => t.evaluateLicensedTradeTriage({ company_id:'c', tenant_id:'legacy', trade:'plumbing', service_key:'plumbing.maintenance.preventive' }), /legacy tenant boundary/);
});

test('Pass 3 output keeps all shared authority owners explicit and authority neutral', () => {
  const out = t.evaluateLicensedTradeTriage({
    company_id:'c', trade:'plumbing', service_key:'plumbing.maintenance.preventive', configured_policy_reference:'policy/current'
  });
  assert.equal(out.quote_owner, 'shared_pricing_quote_owner');
  assert.equal(out.booking_owner, 'shared_booking_owner');
  assert.equal(out.scheduling_owner, 'shared_scheduling_owner');
  assert.equal(out.dispatch_assignment_owner, 'shared_workforce_assignment_owner');
  assert.equal(out.qualification_owner, 'shared_workforce_qualification_owner');
  assert.equal(out.vertical_grants_authority, false);
  assert.equal(out.requires_fresh_authority_evaluation, true);
});
