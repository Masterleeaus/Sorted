import assert from 'node:assert/strict';
import { listContracts, getContract, createContractEnvelope } from '../contracts/index.mjs';

const names = new Set(listContracts().map((x) => x.name));
for (const required of ['DecisionPacket.schema','PlatformServiceEnvelope.schema','ProviderContribution.schema','CapabilityContribution.schema','TitanEventEnvelope.schema','PrimeMissionEnvelope.schema','AuthorityDecision.schema','PresentationIntent.schema']) {
  assert(names.has(required), `missing contract ${required}`);
}
assert(getContract('DecisionPacket.schema'));
const envelope = createContractEnvelope('TitanEventEnvelope.schema', { company_id:'company-1', event_id:'e1', event_type:'test', occurred_at:new Date().toISOString(), source:'test', payload:{} });
assert.equal(envelope.company_id, 'company-1');
assert.throws(() => createContractEnvelope('TitanEventEnvelope.schema', { company_id:'company-1', tenant_id:'legacy' }), /authority boundary/);
assert.throws(() => createContractEnvelope('Unknown', { company_id:'company-1' }), /unknown-contract/);
console.log('shared-contract-registry: PASS');
