import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelCouncilRecommendation, MODEL_COUNCIL_POLICY } from '../.test-dist/ported/titan-intelligence/model-council/index.js';

test('Model Council deterministically aggregates company-scoped votes without authority',()=>{
 const result=buildModelCouncilRecommendation({company_id:'company-1',votes:[
  {provider_id:'b',recommendation:'review',confidence:.7,company_id:'company-1'},
  {provider_id:'a',recommendation:'review',confidence:.8,company_id:'company-1'},
  {provider_id:'c',recommendation:'hold',confidence:.99,company_id:'company-1'}
 ]});
 assert.equal(result.consensus,'review');
 assert.equal(result.authority_neutral,true);
 assert.equal(result.execution_authority,false);
 assert.equal(result.consensus_is_authority,false);
 assert.equal(result.recommendation_is_authority,false);
 assert.equal(MODEL_COUNCIL_POLICY.tenant_boundary,'company_id');
});

test('Model Council rejects cross-company evidence votes',()=>{
 assert.throws(()=>buildModelCouncilRecommendation({company_id:'company-1',votes:[
  {provider_id:'foreign',recommendation:'execute',confidence:1,company_id:'company-2'}
 ]}),/model-council-company-mismatch/);
});
