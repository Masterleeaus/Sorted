import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITAN_WORKFORCE_AGENT_REGISTRATION_CONTRACT,
  createTitanWorkforceAgentRegistry,
  declareTitanWorkforceAgent,
  declarationFromStarterAgent,
  registerTitanWorkforceAgent,
} from '../.lifecycle-test-dist/workforce-lifecycle/index.js';

const capability = (id='booking.prepare') => ({capability_id:id, version:'1.0.0', operations:['read','propose']});
const declaration = (overrides={}) => declareTitanWorkforceAgent({
  company_id:'company-1', agent_key:'booking', agent_version:'1.0.0', name:'Booking Agent',
  role_definition_id:'titan.customer.booking_coordinator', operational_domains:['booking','crm'],
  capabilities:[capability()], configuration:{mode:'proposal'}, ...overrides,
});

test('registration contract is declaration-only and authority neutral', () => {
  assert.equal(TITAN_WORKFORCE_AGENT_REGISTRATION_CONTRACT.companyBoundary, 'company_id');
  assert.equal(TITAN_WORKFORCE_AGENT_REGISTRATION_CONTRACT.registrationGrantsAuthority, false);
  assert.equal(TITAN_WORKFORCE_AGENT_REGISTRATION_CONTRACT.registrationEnablesAgent, false);
  const item=declaration();
  assert.equal(item.lifecycle_state,'REGISTERED');
  assert.equal(item.enabled,false);
  assert.equal(item.execution_permitted,false);
  assert.equal(item.registration_grants_authority,false);
});

test('agent and capability declarations require versioned contracts', () => {
  assert.throws(() => declaration({agent_version:'v1'}), /semver-required/);
  assert.throws(() => declaration({capabilities:[{capability_id:'booking.prepare',version:'v1'}]}), /semver-required/);
  assert.throws(() => declaration({capabilities:[capability(),capability()]}), /duplicate-capability/);
});

test('company-scoped configuration rejects tenant aliases and executable fields', () => {
  assert.throws(() => declaration({configuration:{tenant_id:'bad'}}), /legacy-company-boundary/);
  assert.throws(() => declaration({configuration:{nested:{handler:'run'}}}), /executable-configuration-forbidden/);
  const item=declaration({configuration:{locale:'en-AU',limits:{max_parallel:2}}});
  assert.deepEqual(item.configuration,{locale:'en-AU',limits:{max_parallel:2}});
});

test('registry is company scoped, immutable and duplicate replay is idempotent', () => {
  const item=declaration();
  const empty=createTitanWorkforceAgentRegistry({company_id:'company-1'});
  const once=registerTitanWorkforceAgent(empty,item);
  assert.equal(once.registrations.length,1);
  assert.equal(registerTitanWorkforceAgent(once,item),once);
  assert.equal(once.current_versions.booking,'1.0.0');
  assert.throws(() => registerTitanWorkforceAgent(createTitanWorkforceAgentRegistry({company_id:'company-2'}),item), /cross-company/);
});

test('same agent/version cannot be silently redefined', () => {
  const first=declaration();
  const registry=registerTitanWorkforceAgent(createTitanWorkforceAgentRegistry({company_id:'company-1'}),first);
  const conflict=declaration({name:'Different Booking Agent'});
  assert.throws(() => registerTitanWorkforceAgent(registry,conflict), /registration-version-conflict/);
});

test('registry retains version history and points at latest semantic version', () => {
  let registry=createTitanWorkforceAgentRegistry({company_id:'company-1'});
  registry=registerTitanWorkforceAgent(registry,declaration({agent_version:'1.2.0'}));
  registry=registerTitanWorkforceAgent(registry,declaration({agent_version:'2.0.0', capabilities:[capability('booking.confirm')]}));
  assert.equal(registry.registrations.length,2);
  assert.equal(registry.current_versions.booking,'2.0.0');
});

test('retained starter registry can seed standalone lifecycle declarations without inheriting authority', () => {
  const item=declarationFromStarterAgent({company_id:'company-1',agent_key:'booking',agent_version:'1.0.0',capabilities:[capability()]});
  assert.equal(item.agent_key,'booking');
  assert.equal(item.role_definition_id,'titan.customer.booking_coordinator');
  assert.equal(item.identity_grants_authority,false);
  assert.equal(item.execution_permitted,false);
});
