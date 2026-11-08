import test from 'node:test';
import assert from 'node:assert/strict';
const l = await import('../.licensed-trades-test-dist/language.js');

test('Pass 9 language projection preserves one shared agent shell and emits no mutations', () => {
  const out = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'plumbing',message:'I need a quote for a leaking tap',service_key:'plumbing.fault.leak-blockage'});
  assert.equal(out.owners.chatbot, 'shared_agent_shell_and_intent_owner');
  assert.equal(out.agent_shell_replaced, false);
  assert.equal(out.quote_mutation_emitted, false);
  assert.equal(out.dispatch_mutation_emitted, false);
  assert.equal(out.grants_authority, false);
});

test('Pass 9 recognizes quote and urgent dispatch-style intents as hints only', () => {
  const q = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'electrical',message:'How much to inspect this circuit?',service_key:'electrical.fault.power-circuit'});
  assert.equal(q.intent, 'quote_request');
  assert.equal(q.intent_is_hint, true);
  const d = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'plumbing',message:'Urgent water loss, need someone now',service_key:'plumbing.emergency.water-loss'});
  assert.equal(d.intent, 'urgent_attendance');
  assert.equal(d.dispatch_permitted, false);
});

test('Pass 9 quote questions are trade and service aware', () => {
  const out = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'hvac',message:'Can I get a quote?',service_key:'hvac.installation.system',context:{known_answers:{site_type:'commercial'}}});
  assert.ok(out.quote_questions.some((q) => q.key === 'asset_context'));
  assert.ok(out.quote_questions.some((q) => q.key === 'configured_policy_reference'));
  assert.ok(out.quote_questions.some((q) => q.key === 'qualification_scope'));
});

test('Pass 9 customer summaries use correct trade terminology', () => {
  const p = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'plumbing',message:'What is included?',service_key:'plumbing.maintenance.preventive'});
  const e = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'electrical',message:'What is included?',service_key:'electrical.maintenance.preventive'});
  const h = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'hvac',message:'What is included?',service_key:'hvac.maintenance.preventive'});
  assert.match(p.customer_summary.title,/Plumbing/);
  assert.match(e.customer_summary.title,/Electrical/);
  assert.match(h.customer_summary.title,/HVAC/);
});

test('Pass 9 Titan Go summary exposes qualifications asset and evidence context without assignment authority', () => {
  const out = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'electrical',message:'job details',service_key:'electrical.installation.circuit-equipment',context:{job_ref:'job:1',site_ref:'site:1',asset_ref:'asset:1'}});
  assert.equal(out.titan_go_summary.job_ref,'job:1');
  assert.equal(out.titan_go_summary.asset_ref,'asset:1');
  assert.ok(out.titan_go_summary.qualification_tags.length>0);
  assert.ok(out.titan_go_summary.expected_evidence.length>0);
  assert.equal(out.titan_go_summary.assignment_authoritative,false);
});

test('Pass 9 recurring service language routes to shared recurrence owner', () => {
  const out = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'hvac',message:'Please remind me when the next maintenance is due',service_key:'hvac.maintenance.preventive'});
  assert.equal(out.intent,'maintenance_reminder');
  assert.equal(out.owners.recurrence,'shared_recurrence_rebooking_owner');
  assert.equal(out.reminder_sent,false);
});

test('Pass 9 rejects cross-trade service selection and legacy tenant aliases', () => {
  assert.throws(() => l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'plumbing',message:'hello',service_key:'electrical.maintenance.preventive'}),/does not belong/);
  assert.throws(() => l.buildLicensedTradeLanguageProjection({company_id:'c',tenant_id:'legacy',trade:'plumbing',message:'hello'}),/legacy tenant boundary/);
});

test('Pass 9 does not present emergency or compliance language as safety/compliance authority', () => {
  const out = l.buildLicensedTradeLanguageProjection({company_id:'c',trade:'electrical',message:'Is this safe and compliant?',service_key:'electrical.compliance.inspection'});
  assert.equal(out.safety_claim_authoritative,false);
  assert.equal(out.compliance_claim_authoritative,false);
  assert.equal(out.requires_fresh_authority_evaluation,true);
});
