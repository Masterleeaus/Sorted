import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreQualityOutcome, adaptPerformanceOutcomeSnapshot } from '../.test-dist/workforce-capacity/index.js';

test('quality score combines outcome, validation, rework, failures and customer/business signals without authority',()=>{
  const q=scoreQualityOutcome({company_id:'co-1',subject_id:'w1',task_count:10,success_count:9,failure_count:1,rework_count:1,evidence_count:10,validation_pass_count:9,validation_fail_count:1,customer_score:4.5,business_score:90,on_time_count:9});
  assert.ok(q.score>0.6); assert.equal(q.grants_authority,false); assert.equal(q.execution_permitted,false); assert.equal(q.automatic_staffing_change,false);
});

test('rework and failures trigger review reasons',()=>{
  const q=scoreQualityOutcome({company_id:'co-1',subject_id:'w1',task_count:10,success_count:5,failure_count:3,rework_count:2,evidence_count:10});
  assert.equal(q.review_required,true); assert.ok(q.review_reasons.includes('ELEVATED_FAILURE_RATE')); assert.ok(q.review_reasons.includes('ELEVATED_REWORK_RATE'));
});

test('no evidence fails to insufficient-evidence review state',()=>{
  const q=scoreQualityOutcome({company_id:'co-1',subject_id:'w1',task_count:0,evidence_count:0});
  assert.equal(q.state,'INSUFFICIENT_EVIDENCE'); assert.ok(q.review_reasons.includes('NO_EVIDENCE'));
});

test('performance snapshot adapter is company scoped and retained-source based',()=>{
  const out=adaptPerformanceOutcomeSnapshot({company_id:'co-1',snapshot:{schema:'titan.workforce.performance-outcome-evidence.v1',company_id:'co-1',worker_performance:[{worker_id:'w1',outcome_count:5,evidence_backed_count:5,correction_count:1,customer_score:.8,business_result_score:.9,on_time_rate:.8}]}});
  assert.equal(out.length,1); assert.equal(out[0].subject_id,'w1'); assert.ok(out[0].source_refs.includes('titan.workforce.performance-outcome-evidence.v1'));
});

test('quality adapter rejects cross-company performance snapshots',()=>{
  assert.throws(()=>adaptPerformanceOutcomeSnapshot({company_id:'co-1',snapshot:{schema:'titan.workforce.performance-outcome-evidence.v1',company_id:'co-2',worker_performance:[]}}),/cross-company/);
});
