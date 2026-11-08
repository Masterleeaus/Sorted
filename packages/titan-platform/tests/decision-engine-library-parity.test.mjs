import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionEngineEnvelope } from '../.test-dist/ported/titan-runtime/decision-engine/index.js';

test('Decision Engine recommendations never become execution authority',()=>{
  const envelope=createDecisionEngineEnvelope({company_id:'company-1',decision_id:'decision-1'});
  assert.equal(envelope.company_id,'company-1');
  assert.equal(envelope.authority_neutral,true);
  assert.equal(envelope.execution_authority,false);
  assert.equal(envelope.recommendation_is_authority,false);
  assert.equal(envelope.authority_conferred_by_activation,false);
});
