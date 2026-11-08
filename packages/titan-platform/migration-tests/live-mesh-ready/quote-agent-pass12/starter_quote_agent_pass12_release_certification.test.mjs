import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runAllQuoteGoldenEvals } from '../titan-workforce/starter-agents/quote/quote-golden-evals.mjs';

const root=new URL('../titan-workforce/starter-agents/quote/',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));

test('final Quote release contract preserves Titan authority boundaries',()=>{
  const c=read('QuoteAgentReleaseContract.json');
  assert.equal(c.schema,'titan.zero.quote-agent-release-contract.v1');
  assert.equal(c.company_boundary,'company_id');
  assert.equal(c.quote_truth_owner,'Titan CRM');
  assert.equal(c.execution_permitted,false);
  assert.equal(c.identity_grants_authority,false);
  assert.equal(c.approval_authority,false);
  assert.equal(c.send_authority,false);
  assert.equal(c.booking_creation_authority,false);
  assert.equal(c.customer_contact_authority,false);
  assert.deepEqual(c.lifecycle,['draft','reviewed','approval_required','approved','sent','viewed','accepted','declined','expired']);
});

test('reviewer release evaluation remains independent and authority-neutral',()=>{
  const r=read('QuoteReviewerEvaluation.json');
  assert.equal(r.status,'CERTIFIED_FOR_MANAGER_CONVERGENCE');
  assert.equal(r.pricing_authority,false);
  assert.equal(r.approval_authority,false);
  assert.equal(r.execution_authority,false);
  assert.equal(r.customer_send_authority,false);
  assert.deepEqual(r.allowed_outcomes,['reviewed','approval_required','rejected','escalated']);
  assert.equal(r.golden_eval_cases.length,9);
});

test('final reviewer/golden certification is executable and passes all required cases',async()=>{
  const report=await runAllQuoteGoldenEvals();
  assert.equal(report.summary.total,9);
  assert.equal(report.summary.passed,9);
  assert.equal(report.summary.failed,0);
  assert.equal(report.authority.certification_only,true);
  assert.equal(report.authority.execution_permitted,false);
});
