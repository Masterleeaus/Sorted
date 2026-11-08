// Synthetic test-only context. Never production certification evidence.
const revision = 'a'.repeat(40);
export const inputs = () => ({
  schema:'titan.certification-inputs/v1', policy:'cross-host-required/v1',
  candidate_revision:revision, artifact_hash:`sha256:${'b'.repeat(64)}`,
  registry_revision:revision, scope_revision:revision,
  registry:{version:'1.0.0', entries:[{registry_id:'titan.native:capability:jobs.read'}]},
  compatibility:{schema:'titan.compatibility-manifest.v1',core_version:'1',registry_version:'1.0.0',contract_version:'v1',source_revision:revision,generated_at:'2026-10-01T00:00:00Z'},
  projections:[{foundation_product:'fsm',vertical_profile:'field',entitlement_profile:'team',platform_adapter:'web',contract_version:'v1'}],
});
