import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const sdk = await tsImport('../src/directadmin-plugin.ts', { parentURL: import.meta.url, tsconfig: false });
const { DirectAdminCockpitSession } = sdk;
const nonce = 'N'.repeat(43);
const csrf = 'C'.repeat(43);
const context = Object.freeze({ schema: 'titan.directadmin.session/v1', actor_id: 'actor-a', company_id: 'company-a',
  company_ids: ['company-a'], context_revision: 'session-revision-a', session_revision: 1,
  expires_at: Date.now() + 60_000, da_role: 'user', authority: 'not-carried' });

function availableSkills(overrides = {}) {
  const skill = { worker_id: 'worker-a', capability_id: 'work.site.schedule', proficiency: 4,
    proficiency_level: 'PROFICIENT', verification_state: 'VERIFIED', proof_state: 'verified', proof_strength: 0.92,
    evidence_count: 1, evidence_refs: ['proof-a'], contextual_performance_support: null,
    contextual_performance_is_not_capability_verification: true, meets_registry_requirement: null,
    required_min_proficiency: null, require_verified: null, expired_or_revoked: false,
    capability_presence_confers_authority: false, verification_confers_authority: false,
    performance_confers_authority: false, grants_authority: false };
  const proof = { schema: 'titan.workforce.evidence-backed-skill-proof.v1', company_id: 'company-a',
    workers: [{ worker_id: 'worker-a', skills: [skill], summary: { skill_count: 1, verified: 1, evidenced: 0,
      unverified: 0, expired_or_revoked: 0, requirement_gaps: 0 },
      worker_identity_confers_authority: false, grants_authority: false }], skill_proofs: [skill],
    summary: { worker_count: 1, skill_proof_count: 1, verified_skill_proofs: 1, evidenced_skill_proofs: 0,
      unverified_skill_proofs: 0, invalid_skill_proofs: 0, requirement_gaps: 0, workers_with_contextual_performance: 0 },
    read_only: true, derived: true, performance_is_context_only: true, routing_decision: false,
    entitlement_decision: false, assignment_decision: false, automatic_execution: false,
    execution_permitted: false, grants_authority: false };
  return { schema: 'titan.directadmin.workforce-skills.v1', company_id: 'company-a', context_revision: context.context_revision,
    status: 'available', source: 'canonical-workforce-skill-capability-registry', freshness: new Date().toISOString(),
    source_revision: 7, evidence_refs: ['proof-a'], read_only: true, capability_presence_confers_authority: false,
    verification_confers_authority: false, assignment_decision: false, routing_decision: false,
    entitlement_decision: false, execution_permitted: false, grants_authority: false, projection: proof, ...overrides };
}

function oldCompatibleProjection(skills) {
  return { company_id: 'company-a', source: 'canonical-workforce-runtime', freshness: null, evidence_refs: [],
    data: { schema: 'titan.workforce-cockpit.v1', company_id: 'company-a',
      discovery: { company_id: 'company-a', workers: [{ company_id: 'company-a', worker_id: 'worker-a' }], controls: [], ...(skills ? { skills } : {}) },
      status: { company_id: 'company-a', work: [] } } };
}

async function openSession(t, projection) {
  const paths = [];
  const session = new DirectAdminCockpitSession(() => nonce, async (path) => {
    paths.push(path);
    if (path === '/v1/directadmin/bootstrap') return new Response(JSON.stringify({ csrf_token: csrf }), { status: 200 });
    if (path === '/v1/directadmin/context') return new Response(JSON.stringify(context), { status: 200 });
    if (path === '/v1/directadmin/titan_workforce/projection') {
      return new Response(JSON.stringify({ context, projection }), { status: 200 });
    }
    throw new Error('unexpected-directadmin-path');
  });
  t.after(() => session.dispose());
  await session.connect();
  return { session, paths };
}

test('SDK accepts older Workforce projection hosts while validating a present canonical skills contract', async t => {
  const old = await openSession(t, oldCompatibleProjection());
  const legacy = await old.session.projection('titan_workforce');
  assert.equal(Object.hasOwn(legacy.data.discovery, 'skills'), false);
  assert.ok(old.paths.includes('/v1/directadmin/bootstrap'));

  const current = await openSession(t, oldCompatibleProjection(availableSkills()));
  const projection = await current.session.projection('titan_workforce');
  assert.equal(projection.data.discovery.skills.status, 'available');
  assert.deepEqual(projection.data.discovery.skills.evidence_refs, ['proof-a']);
});

test('SDK rejects stale, cross-company, foreign-roster and authority-bearing skill projections', async t => {
  const invalid = [
    availableSkills({ context_revision: 'old-session-revision' }),
    availableSkills({ company_id: 'company-b' }),
    availableSkills({ projection: { ...availableSkills().projection, company_id: 'company-b' } }),
    availableSkills({ projection: { ...availableSkills().projection,
      workers: [{ ...availableSkills().projection.workers[0], worker_id: 'worker-b' }] } }),
    availableSkills({ grants_authority: true }),
  ];
  for (const skills of invalid) {
    const fixture = await openSession(t, oldCompatibleProjection(skills));
    await assert.rejects(fixture.session.projection('titan_workforce'), /directadmin-workforce-skills-projection-invalid/);
  }
});

test('SDK rejects an unavailable contract that contains source diagnostics or credentials', async t => {
  const unavailable = { schema: 'titan.directadmin.workforce-skills.v1', status: 'unavailable',
    company_id: 'company-a', context_revision: context.context_revision, reason: 'canonical-skill-projection-unavailable',
    source: null, freshness: null, source_revision: null, evidence_refs: [], read_only: true,
    capability_presence_confers_authority: false, verification_confers_authority: false,
    assignment_decision: false, routing_decision: false, entitlement_decision: false,
    execution_permitted: false, grants_authority: false, diagnostics: 'secret-provider-token' };
  const fixture = await openSession(t, oldCompatibleProjection(unavailable));
  await assert.rejects(fixture.session.projection('titan_workforce'), /directadmin-workforce-skills-projection-invalid/);
});
