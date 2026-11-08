import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTitanWorkforceAgentConfiguration } from '../.lifecycle-test-dist/workforce-lifecycle/configuration.js';

const binding = Object.freeze({
  schema:'titan.workforce.agent-binding.v1', companyId:'company-a', managerId:'manager-1', supervisorId:'supervisor-1', agentKey:'booking',
  ownershipConfersExecutionAuthority:false, directInvocationConfersExecutionAuthority:false, executionRequiresAuthorityEvaluation:true, executionRequiresCapabilityResolution:true,
});

test('manager supervisor agent inheritance is deterministic and agent-most-specific', () => {
  const out = buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',manager_id:'manager-1',supervisor_id:'supervisor-1',hierarchy_binding:binding,
    manager_settings:{notifications:{enabled:true,mode:'summary'},region:'au'},
    supervisor_settings:{notifications:{mode:'urgent'}}, agent_settings:{notifications:{enabled:false}}});
  assert.deepEqual(out.effective_configuration,{notifications:{enabled:false,mode:'urgent'},region:'au'});
  assert.deepEqual(out.inherited_layers,['manager','supervisor','agent']);
  assert.equal(out.execution_permitted,false); assert.equal(out.settings_grant_authority,false);
});

test('secret-shaped settings require reference-only values and collect refs', () => {
  const out = buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',hierarchy_binding:binding,manager_id:'manager-1',supervisor_id:'supervisor-1',agent_settings:{api_key:{secret_ref:'vault://company-a/booking/api'}}});
  assert.deepEqual(out.secret_references,['vault://company-a/booking/api']);
  assert.deepEqual(out.effective_configuration.api_key,{secret_ref:'vault://company-a/booking/api'});
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',agent_settings:{password:'plain-text'}}),/secret-reference-required/);
});

test('inline authority or executable configuration is rejected', () => {
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',agent_settings:{execution_permitted:true}}),/forbidden/);
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',agent_settings:{handler:'doThing'}}),/forbidden/);
});

test('legacy tenant aliases are rejected recursively', () => {
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',agent_settings:{nested:{tenant_id:'legacy'}}}),/legacy-company-boundary/);
});

test('manager or supervisor inherited settings require verified hierarchy binding', () => {
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',manager_id:'manager-1',manager_settings:{x:1}}),/hierarchy-binding-required/);
});

test('cross-company or mismatched hierarchy binding fails closed', () => {
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-b',agent_key:'booking',hierarchy_binding:binding}),/cross-company/);
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'sales',hierarchy_binding:binding}),/agent-mismatch/);
});

test('binding authority expansion is rejected', () => {
  assert.throws(() => buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',hierarchy_binding:{...binding,ownershipConfersExecutionAuthority:true}}),/authority-contract-invalid/);
});

test('agent-only configuration is allowed without hierarchy and stays non-authoritative', () => {
  const out = buildTitanWorkforceAgentConfiguration({company_id:'company-a',agent_key:'booking',agent_settings:{locale:'en-AU'}});
  assert.deepEqual(out.effective_configuration,{locale:'en-AU'});
  assert.equal(out.manager_id,null); assert.equal(out.supervisor_id,null); assert.equal(out.configuration_only,true);
});
