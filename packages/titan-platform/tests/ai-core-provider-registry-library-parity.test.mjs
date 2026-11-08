import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderRegistry, AI_PROVIDER_ROUTING_POLICY } from '../.test-dist/ported/titan-ai-core/provider-registry.js';

test('AI provider routing is local-first and company scoped',()=>{
  const registry=new AIProviderRegistry();
  registry.register({id:'cloud',locality:'byo-cloud'});
  registry.register({id:'local',locality:'device'});
  registry.register({id:'private',locality:'customer-hosted',company_id:'company-1'});
  assert.deepEqual(registry.route('company-1').map(p=>p.id),['local','private','cloud']);
  assert.deepEqual(registry.route('company-2').map(p=>p.id),['local','cloud']);
});

test('AI provider registry rejects blank company scope and never grants authority',()=>{
  const registry=new AIProviderRegistry();
  assert.throws(()=>registry.register({id:'local',locality:'device',company_id:'   '}),/company_id-required/);
  assert.equal(AI_PROVIDER_ROUTING_POLICY.tenant_boundary,'company_id');
  assert.equal(AI_PROVIDER_ROUTING_POLICY.activation_confers_authority,false);
  assert.equal(AI_PROVIDER_ROUTING_POLICY.execution_authority,false);
});
