export const TITAN_WORKFORCE_LIFECYCLE_STATES = Object.freeze([
  'REGISTERED',
  'ENABLED',
  'PAUSED',
  'DRAINING',
  'DISABLED',
  'DEGRADED',
  'RETIRED',
] as const);

export type TitanWorkforceLifecycleState = (typeof TITAN_WORKFORCE_LIFECYCLE_STATES)[number];

export const TITAN_WORKFORCE_HEALTH_STATES = Object.freeze([
  'READY',
  'DEGRADED',
  'UNAVAILABLE',
] as const);

export type TitanWorkforceHealthState = (typeof TITAN_WORKFORCE_HEALTH_STATES)[number];

export type TitanWorkforceLifecycleInventoryEntry = Readonly<{
  id: string;
  path: string;
  role: string;
  reuse: 'REUSE' | 'ADAPT' | 'REFERENCE';
}>;

export const TITAN_WORKFORCE_LIFECYCLE_INVENTORY: readonly TitanWorkforceLifecycleInventoryEntry[] = Object.freeze([
  Object.freeze({ id: 'module-registry', path: 'ported/titan-modules/module-registry.ts', role: 'canonical module identity, version, contributions and enabled/status filtering', reuse: 'REUSE' }),
  Object.freeze({ id: 'lifecycle-access', path: 'ported/titan-modules/lifecycle-access.ts', role: 'governed install/enable/disable/uninstall access boundaries', reuse: 'REUSE' }),
  Object.freeze({ id: 'lifecycle-history', path: 'ported/titan-modules/lifecycle-history.ts', role: 'auditable lifecycle transition history', reuse: 'REUSE' }),
  Object.freeze({ id: 'starter-agent-registry', path: 'ported/titan-workforce/starter-agents/starter-agent-registry.ts', role: 'existing standalone workforce agent identity registry', reuse: 'ADAPT' }),
  Object.freeze({ id: 'settings-defaults', path: 'ported/titan-settings/control-plane/workforce-global-defaults.ts', role: 'existing workforce global settings inheritance seam', reuse: 'REUSE' }),
  Object.freeze({ id: 'settings-overrides', path: 'ported/titan-settings/control-plane/workforce-agent-overrides.ts', role: 'existing per-agent company-scoped configuration seam', reuse: 'REUSE' }),
  Object.freeze({ id: 'installation-planner', path: 'ported/titan-workforce/installation/installation-planner.ts', role: 'existing install/dependency planning evidence', reuse: 'REFERENCE' }),
  Object.freeze({ id: 'migration-safety', path: 'ported/titan-workforce/migration/migration-upgrade-safety.ts', role: 'existing rollback-safe version migration evidence', reuse: 'REFERENCE' }),
  Object.freeze({ id: 'agent-ui-persistence', path: 'ported/titan-workforce-agents-persistence.ts', role: 'existing device-first company-scoped UI persistence seam', reuse: 'REFERENCE' }),
]);

export const TITAN_WORKFORCE_LIFECYCLE_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle.contract.v1',
  companyBoundary: 'company_id' as const,
  identityGrantsAuthority: false as const,
  lifecycleAuthority: 'platform_manager' as const,
  agentMaySelfInstall: false as const,
  agentMaySelfUpgrade: false as const,
  agentMaySelfRetire: false as const,
  historyRequired: true as const,
  retiredStateRetainsHistory: true as const,
  deviceFirstConfiguration: true as const,
  automaticAuthorityChange: false as const,
});

export function assertTitanWorkforceLifecycleCompany(companyId: string): string {
  const value = String(companyId || '').trim();
  if (!value) throw new Error('company_id-required');
  return value;
}

export function isTitanWorkforceLifecycleState(value: unknown): value is TitanWorkforceLifecycleState {
  return TITAN_WORKFORCE_LIFECYCLE_STATES.includes(value as TitanWorkforceLifecycleState);
}

export function isTitanWorkforceAssignableState(state: TitanWorkforceLifecycleState, health: TitanWorkforceHealthState): boolean {
  return state === 'ENABLED' && health === 'READY';
}
