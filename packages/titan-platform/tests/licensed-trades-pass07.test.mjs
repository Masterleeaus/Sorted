import test from 'node:test';
import assert from 'node:assert/strict';
const e = await import('../.licensed-trades-test-dist/execution.js');

function base(overrides={}) { return {company_id:'c1',job_ref:'job:1',trade:'plumbing',service_key:'plumbing.maintenance.preventive',configured_policy_reference:'policy:p',customer_completion_summary:'Completed configured maintenance visit.',...overrides}; }

test('Pass 7 execution contract is projection-only and does not complete or mutate shared owners', () => {
  const first = e.buildLicensedTradeExecutionPack(base());
  assert.equal(first.vertical_execution_is_projection, true);
  for (const key of ['marks_job_complete','mutates_job','mutates_asset_history','mutates_inventory','creates_follow_up_job','issues_compliance_certificate','declares_safe_state','grants_authority','execution_permitted']) assert.equal(first[key], false);
});

test('Pass 7 produces deterministic checklist keys from service scope', () => {
  const first = e.buildLicensedTradeExecutionPack(base());
  const completed = first.checklist.map(x=>x.checklist_key);
  const second = e.buildLicensedTradeExecutionPack(base({checklist_completed_keys:completed}));
  assert.ok(first.checklist.length >= 2);
  assert.equal(second.checklist.every(x=>x.completed), true);
});

test('Pass 7 electrical work requires safe-state/test evidence placeholders without declaring safety', () => {
  const probe = e.buildLicensedTradeExecutionPack({company_id:'c1',job_ref:'j',trade:'electrical',service_key:'electrical.installation.circuit-equipment',configured_policy_reference:'policy:e',customer_completion_summary:'Installed configured equipment.'});
  assert.ok(probe.required_evidence_kinds.includes('ISOLATION_SAFE_STATE'));
  assert.ok(probe.required_evidence_kinds.includes('TEST_RESULT'));
  assert.ok(probe.required_evidence_kinds.includes('COMMISSIONING'));
  assert.equal(probe.declares_safe_state, false);
});

test('Pass 7 compliance service requires qualified sign-off evidence and configured policy reference', () => {
  const out = e.buildLicensedTradeExecutionPack({company_id:'c1',job_ref:'j',trade:'plumbing',service_key:'plumbing.compliance.inspection',customer_completion_summary:'Inspection recorded.'});
  assert.ok(out.required_evidence_kinds.includes('QUALIFIED_SIGN_OFF'));
  assert.ok(out.blockers.includes('CONFIGURED_POLICY_REFERENCE_REQUIRED'));
  assert.ok(out.blockers.includes('REQUIRED_EVIDENCE_MISSING:QUALIFIED_SIGN_OFF'));
});

test('Pass 7 materials and follow-up work stay references owned by shared domains', () => {
  const out = e.buildLicensedTradeExecutionPack(base({materials_used:[{material_ref:'stock:valve',quantity:2,unit:'ea',evidence_ref:'ev:m'}],follow_up_work:[{follow_up_ref:'fu:1',summary:'Quote replacement asset',owner_hint:'QUOTE'}]}));
  assert.deepEqual(out.materials_used[0], {material_ref:'stock:valve',quantity:2,unit:'ea',evidence_ref:'ev:m'});
  assert.equal(out.follow_up_work[0].owner_hint,'QUOTE');
  assert.equal(out.materials_owner,'shared_assets_inventory_owner');
  assert.equal(out.creates_follow_up_job,false);
});

test('Pass 7 urgent follow-up needs exception note', () => {
  const out = e.buildLicensedTradeExecutionPack(base({follow_up_work:[{follow_up_ref:'fu:urgent',summary:'Escalate unexpected condition',priority:'URGENT_REVIEW'}]}));
  assert.ok(out.blockers.includes('URGENT_FOLLOW_UP_EXCEPTION_NOTE_REQUIRED'));
});

test('Pass 7 reaches evidence review readiness only when checklist and required evidence are satisfied', () => {
  const probe = e.buildLicensedTradeExecutionPack(base());
  const evidence = probe.required_evidence_kinds.map((kind,i)=>({evidence_kind:kind,evidence_ref:`ev:${i}`,status:'CAPTURED'}));
  const out = e.buildLicensedTradeExecutionPack(base({checklist_completed_keys:probe.checklist.map(x=>x.checklist_key),evidence}));
  assert.deepEqual(out.blockers, []);
  assert.equal(out.ready_for_shared_jobs_evidence_review,true);
  assert.equal(out.marks_job_complete,false);
});

test('Pass 7 rejects cross-trade service, tenant aliases and invalid material quantity', () => {
  assert.throws(()=>e.buildLicensedTradeExecutionPack(base({trade:'hvac'})),/does not belong/);
  assert.throws(()=>e.buildLicensedTradeExecutionPack({...base(),tenant_id:'legacy'}),/legacy tenant boundary/);
  assert.throws(()=>e.buildLicensedTradeExecutionPack(base({materials_used:[{material_ref:'m',quantity:0}]})),/must be > 0/);
});
