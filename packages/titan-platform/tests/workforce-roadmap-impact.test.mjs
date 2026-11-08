import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
import { defineRoadmapWorkforceImpact, assertRoadmapWorkforceImpactCoverage } from '../.test-dist/workforce-lifecycle/roadmap-impact.js';

const base = {company_id:'company-1', goal_id:'tz-roadmap-41', subgoal_id:'tz-roadmap-41-sg-02'};

test('requires explicit reuse/extend/create ownership and matching registry delta', () => {
  const impact = defineRoadmapWorkforceImpact({...base, mode:'EXTEND_EXISTING_AGENT', owning_agent_ids:['reception.manager'], registry_deltas:[{agent_id:'reception.manager', operation:'EXTEND', capability_ids:['workforce.impact']}]});
  assert.equal(impact.mode, 'EXTEND_EXISTING_AGENT');
  assert.equal(impact.identity_grants_authority, false);
  assert.throws(() => defineRoadmapWorkforceImpact({...base, mode:'CREATE_NEW_AGENT', owning_agent_ids:['x'], registry_deltas:[{agent_id:'x', operation:'REUSE'}]}), /operation-mismatch/);
});

test('infrastructure-only requires justification and forbids agent ownership', () => {
  const impact = defineRoadmapWorkforceImpact({...base, mode:'NO_AGENT_INFRASTRUCTURE_ONLY', owning_agent_ids:[], registry_deltas:[], infrastructure_only_justification:'Pure infrastructure with no distinct business outcome ownership.'});
  assert.equal(impact.owning_agent_ids.length, 0);
  assert.throws(() => defineRoadmapWorkforceImpact({...base, mode:'NO_AGENT_INFRASTRUCTURE_ONLY', owning_agent_ids:['x'], registry_deltas:[], infrastructure_only_justification:'Pure infrastructure with no distinct business outcome ownership.'}), /must-not-own-agent/);
});

test('rejects legacy tenant boundaries and detects missing subgoal declarations', () => {
  assert.throws(() => defineRoadmapWorkforceImpact({...base, tenant_id:'legacy', mode:'REUSE_EXISTING_AGENT', owning_agent_ids:['x'], registry_deltas:[{agent_id:'x', operation:'REUSE'}]}), /legacy-company-boundary/);
  const impact = defineRoadmapWorkforceImpact({...base, mode:'REUSE_EXISTING_AGENT', owning_agent_ids:['x'], registry_deltas:[{agent_id:'x', operation:'REUSE'}]});
  assert.throws(() => assertRoadmapWorkforceImpactCoverage([impact], ['tz-roadmap-41-sg-02','tz-roadmap-41-sg-03']), /missing-workforce-impact/);
});

test('roadmap projection requires justification for infrastructure-only work', async () => {
  const { validateRoadmapAgentModelProjection } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  assert.deepEqual(validateRoadmapAgentModelProjection({ agent_model: {
    workforce_impact: 'NO_AGENT_INFRASTRUCTURE_ONLY', owning_agent_ids: [],
    no_agent_reason: 'This is control-plane infrastructure and does not represent a business workforce role.'
  }}), { valid: true, mode: 'NO_AGENT_INFRASTRUCTURE_ONLY' });
  assert.throws(() => validateRoadmapAgentModelProjection({ agent_model: {
    workforce_impact: 'NO_AGENT_INFRASTRUCTURE_ONLY', owning_agent_ids: [], no_agent_reason: 'infra'
  }}), /reason-required/);
});

test('roadmap projection requires canonical owners and registry delta for agent work', async () => {
  const { validateRoadmapAgentModelProjection } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  assert.throws(() => validateRoadmapAgentModelProjection({ agent_model: {
    workforce_impact: 'EXTEND_EXISTING_AGENT', owning_agent_ids: [], registry_delta: {}
  }}), /owning-agent-ids-required/);
  assert.throws(() => validateRoadmapAgentModelProjection({ agent_model: {
    workforce_impact: 'EXTEND_EXISTING_AGENT', owning_agent_ids: ['agent.customer-care'], registry_delta: null
  }}), /registry-delta-required/);
});

test('roadmap coverage rejects duplicate subgoal identity', async () => {
  const { validateRoadmapWorkforceCoverage } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  const sg = { subgoal_id: 'tz-roadmap-41-sg-02', agent_model: {
    workforce_impact: 'NO_AGENT_INFRASTRUCTURE_ONLY', owning_agent_ids: [],
    no_agent_reason: 'Canonical registry governance is infrastructure rather than a workforce role.'
  }};
  assert.throws(() => validateRoadmapWorkforceCoverage([sg, sg]), /duplicate-roadmap-subgoal/);
});

test('reconciles reuse and extend against canonical agent identities', async () => {
  const { reconcileRoadmapWorkforceImpact } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  const registry = { company_id:'company-1', agents:[{agent_id:'reception.manager', capability_ids:['booking','crm']}] };
  const reuse = defineRoadmapWorkforceImpact({...base, mode:'REUSE_EXISTING_AGENT', owning_agent_ids:['reception.manager'], registry_deltas:[{agent_id:'reception.manager', operation:'REUSE', capability_ids:['crm']}]});
  assert.equal(reconcileRoadmapWorkforceImpact(reuse, registry).valid, true);
  const missing = defineRoadmapWorkforceImpact({...base, mode:'EXTEND_EXISTING_AGENT', owning_agent_ids:['missing.manager'], registry_deltas:[{agent_id:'missing.manager', operation:'EXTEND', capability_ids:['new-cap']}]});
  assert.throws(() => reconcileRoadmapWorkforceImpact(missing, registry), /canonical-agent-missing/);
});

test('create rejects duplicate canonical identity and reuse rejects unknown capability', async () => {
  const { reconcileRoadmapWorkforceImpact } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  const registry = { company_id:'company-1', agents:[{agent_id:'reception.manager', capability_ids:['crm']}] };
  const create = defineRoadmapWorkforceImpact({...base, mode:'CREATE_NEW_AGENT', owning_agent_ids:['reception.manager'], registry_deltas:[{agent_id:'reception.manager', operation:'CREATE', capability_ids:['x']}]});
  assert.throws(() => reconcileRoadmapWorkforceImpact(create, registry), /already-exists/);
  const reuse = defineRoadmapWorkforceImpact({...base, mode:'REUSE_EXISTING_AGENT', owning_agent_ids:['reception.manager'], registry_deltas:[{agent_id:'reception.manager', operation:'REUSE', capability_ids:['unknown']}]});
  assert.throws(() => reconcileRoadmapWorkforceImpact(reuse, registry), /reuse-capability-missing/);
});

test('starter registry adapter preserves company boundary and never grants authority', async () => {
  const { starterAgentRegistrySnapshot } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  const snapshot = starterAgentRegistrySnapshot('company-1', {agents:[{agent_key:'reception', role_definition_id:'titan.customer.receptionist', operational_domains:['reception','crm']}]});
  assert.equal(snapshot.company_id, 'company-1');
  assert.equal(snapshot.agents[0].agent_id, 'titan.customer.receptionist');
  assert.deepEqual(snapshot.agents[0].capability_ids, ['crm','reception']);
});

// Pass 5 whole-roadmap coverage audit source-contract checks.
{
  const source = readFileSync(join(root, 'src/workforce-lifecycle/roadmap-impact.ts'), 'utf8');
  assert.match(source, /auditRoadmapWorkforceCoverage/);
  assert.match(source, /MISSING_OWNER/);
  assert.match(source, /MISSING_CANONICAL_AGENT/);
  assert.match(source, /CONFLICTING_OUTCOME_OWNERS/);
  assert.match(source, /NO_AGENT_INFRASTRUCTURE_ONLY/);
}

// Pass 6 closure recommendation source-contract checks.
{
  const source = readFileSync(join(root, 'src/workforce-lifecycle/roadmap-impact.ts'), 'utf8');
  assert.match(source, /recommendWorkforceCoverageClosures/);
  assert.match(source, /REUSE_EXISTING_AGENT/);
  assert.match(source, /EXTEND_EXISTING_AGENT/);
  assert.match(source, /CREATE_NEW_AGENT/);
  assert.match(source, /NO_AGENT_INFRASTRUCTURE_ONLY/);
  assert.match(source, /MANUAL_REVIEW/);
  assert.match(source, /identity_grants_authority: false/);
}


test('surface binding reuses existing canonical identities', () => {
  const impact = defineRoadmapWorkforceImpact({...base, mode:'SURFACE_BINDING_EXISTING_AGENTS', owning_agent_ids:['reception.manager'], registry_deltas:[{agent_id:'reception.manager', operation:'REUSE', capability_ids:['crm']}]});
  assert.equal(impact.mode, 'SURFACE_BINDING_EXISTING_AGENTS');
});

test('ownership classifier permits canonical definition reuse and blocks ambiguous multi-owner cases', async () => {
  const { classifyAuthoritativeRoadmapOutcomeOwnership } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  const shared = {goals:[{subgoals:[
    {subgoal_id:'g-sg-1',agent_model:{workforce_impact:'EXTEND_EXISTING_AGENT',owning_agent_ids:['agent.a','agent.b'],outcome_ids:['outcome.x'],pain_point_ids:[],registry_delta:{type:'CANONICAL_AGENT_SEED',definition_home:'g-sg-1',canonical_definition_homes:[]}}},
    {subgoal_id:'g-sg-2',agent_model:{workforce_impact:'REUSE_EXISTING_AGENT',owning_agent_ids:['agent.a','agent.b'],outcome_ids:['outcome.x'],pain_point_ids:[],registry_delta:{type:'REFERENCE_CANONICAL_AGENT',canonical_definition_homes:['g-sg-1']}}}
  ]}]};
  assert.equal(classifyAuthoritativeRoadmapOutcomeOwnership(shared)[0].classification, 'SHARED_COLLABORATIVE');
  const ambiguous = {goals:[{subgoals:[{subgoal_id:'g-sg-1',agent_model:{workforce_impact:'EXTEND_EXISTING_AGENT',owning_agent_ids:['agent.a','agent.b'],outcome_ids:['outcome.x'],pain_point_ids:[],registry_delta:{type:'OTHER'}}}]}]};
  assert.equal(classifyAuthoritativeRoadmapOutcomeOwnership(ambiguous)[0].blocking, true);
});

test('completion gate fails closed on unresolved multi-owner ownership', async () => {
  const { validateAuthoritativeRoadmapWorkforceCompletion } = await import('../.test-dist/workforce-lifecycle/roadmap-impact.js');
  const roadmap = {goals:[{subgoals:[{subgoal_id:'g-sg-1',agent_model:{workforce_impact:'EXTEND_EXISTING_AGENT',owning_agent_ids:['agent.a','agent.b'],outcome_ids:['outcome.x'],pain_point_ids:['pain.x'],registry_delta:{type:'OTHER'}}}]}]};
  const result = validateAuthoritativeRoadmapWorkforceCompletion(roadmap);
  assert.equal(result.valid, false);
  assert.equal(result.blockers[0].code, 'AMBIGUOUS_MULTI_OWNER');
  assert.equal(result.identity_grants_authority, false);
});
