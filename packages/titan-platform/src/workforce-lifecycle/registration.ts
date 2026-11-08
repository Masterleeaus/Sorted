import { getStarterAgent } from '../ported/titan-workforce/starter-agents/starter-agent-registry.js';
import { assertTitanWorkforceLifecycleCompany } from './contracts.js';

const ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FORBIDDEN_SCOPE_KEYS = new Set(['tenant_id', 'tenant_company_id', 'tenant', 'tenantCompanyId', 'organisation_id', 'organization_id']);
const EXECUTABLE_KEYS = new Set(['script', 'scripturl', 'javascript', 'code', 'handler', 'execute', 'entry']);

export const TITAN_WORKFORCE_AGENT_REGISTRATION_CONTRACT = Object.freeze({
  schema: 'titan.workforce.agent-registration.contract.v1',
  contractVersion: '1.0.0',
  companyBoundary: 'company_id' as const,
  identityGrantsAuthority: false as const,
  registrationGrantsAuthority: false as const,
  registrationEnablesAgent: false as const,
  registrationInstallsAgent: false as const,
  declarationOnly: true as const,
});

export type TitanWorkforceCapabilityDeclaration = Readonly<{
  capability_id: string;
  version: string;
  description: string;
  operations: readonly string[];
}>;

export type TitanWorkforceAgentRegistration = Readonly<{
  schema: 'titan.workforce.agent-registration.v1';
  contract_version: '1.0.0';
  company_id: string;
  agent_key: string;
  agent_version: string;
  name: string;
  role_definition_id: string;
  operational_domains: readonly string[];
  capabilities: readonly TitanWorkforceCapabilityDeclaration[];
  configuration: Readonly<Record<string, unknown>>;
  lifecycle_state: 'REGISTERED';
  identity_grants_authority: false;
  registration_grants_authority: false;
  enabled: false;
  execution_permitted: false;
}>;

export type TitanWorkforceAgentRegistry = Readonly<{
  schema: 'titan.workforce.agent-registry.v1';
  company_id: string;
  registrations: readonly TitanWorkforceAgentRegistration[];
  current_versions: Readonly<Record<string, string>>;
  identity_grants_authority: false;
  registration_grants_authority: false;
}>;

function clean(value: unknown, max = 180): string {
  return String(value ?? '').trim().slice(0, max);
}

function requiredId(value: unknown, field: string): string {
  const id = clean(value, 128).toLowerCase();
  if (!ID_RE.test(id)) throw new Error(`${field}-invalid`);
  return id;
}

function requiredVersion(value: unknown, field: string): string {
  const version = clean(value, 80);
  if (!SEMVER_RE.test(version)) throw new Error(`${field}-semver-required`);
  return version;
}

function cloneJson(value: unknown, path = 'configuration'): unknown {
  if (value == null) return value;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error(`${path}-must-be-json`);
  if (Array.isArray(value)) return value.map((item, index) => cloneJson(item, `${path}[${index}]`));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SCOPE_KEYS.has(key)) throw new Error(`legacy-company-boundary:${path}.${key}`);
    if (EXECUTABLE_KEYS.has(key.toLowerCase())) throw new Error(`executable-configuration-forbidden:${path}.${key}`);
    out[key] = cloneJson(child, `${path}.${key}`);
  }
  return out;
}

function uniqueStrings(value: unknown, field: string): readonly string[] {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error(`${field}-array-required`);
  const normalized = value.map((item) => requiredId(item, field));
  return Object.freeze([...new Set(normalized)].sort());
}

function normalizeCapabilities(value: unknown): readonly TitanWorkforceCapabilityDeclaration[] {
  if (!Array.isArray(value) || !value.length) throw new Error('capabilities-required');
  const seen = new Set<string>();
  const capabilities = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`capabilities[${index}]-object-required`);
    const raw = item as Record<string, unknown>;
    const capability_id = requiredId(raw.capability_id ?? raw.id, `capabilities[${index}].capability_id`);
    if (seen.has(capability_id)) throw new Error(`duplicate-capability:${capability_id}`);
    seen.add(capability_id);
    return Object.freeze({
      capability_id,
      version: requiredVersion(raw.version, `capabilities[${index}].version`),
      description: clean(raw.description, 500),
      operations: uniqueStrings(raw.operations, `capabilities[${index}].operations`),
    });
  });
  return Object.freeze(capabilities.sort((a, b) => a.capability_id.localeCompare(b.capability_id)));
}

export function declareTitanWorkforceAgent(input: Record<string, unknown> = {}): TitanWorkforceAgentRegistration {
  const company_id = assertTitanWorkforceLifecycleCompany(clean(input.company_id, 128));
  const agent_key = requiredId(input.agent_key, 'agent_key');
  const agent_version = requiredVersion(input.agent_version ?? input.version, 'agent_version');
  const name = clean(input.name, 180);
  if (!name) throw new Error('agent-name-required');
  const role_definition_id = requiredId(input.role_definition_id, 'role_definition_id');
  const configurationRaw = input.configuration == null ? {} : input.configuration;
  if (!configurationRaw || typeof configurationRaw !== 'object' || Array.isArray(configurationRaw)) throw new Error('configuration-object-required');
  const configuration = Object.freeze(cloneJson(configurationRaw) as Record<string, unknown>);
  return Object.freeze({
    schema: 'titan.workforce.agent-registration.v1',
    contract_version: '1.0.0',
    company_id,
    agent_key,
    agent_version,
    name,
    role_definition_id,
    operational_domains: uniqueStrings(input.operational_domains, 'operational_domains'),
    capabilities: normalizeCapabilities(input.capabilities),
    configuration,
    lifecycle_state: 'REGISTERED',
    identity_grants_authority: false,
    registration_grants_authority: false,
    enabled: false,
    execution_permitted: false,
  });
}

function semverParts(version: string): readonly number[] {
  const core = version.split(/[+-]/, 1)[0];
  return core.split('.').map(Number);
}

function compareVersions(a: string, b: string): number {
  const aa = semverParts(a), bb = semverParts(b);
  for (let index = 0; index < 3; index += 1) {
    if (aa[index] !== bb[index]) return aa[index] - bb[index];
  }
  return a.localeCompare(b);
}

export function createTitanWorkforceAgentRegistry(input: {company_id: string; registrations?: readonly TitanWorkforceAgentRegistration[]}): TitanWorkforceAgentRegistry {
  const company_id = assertTitanWorkforceLifecycleCompany(input.company_id);
  const registrations = [...(input.registrations ?? [])];
  for (const entry of registrations) if (entry.company_id !== company_id) throw new Error('cross-company-registration');
  const current_versions: Record<string, string> = {};
  for (const entry of registrations) {
    const existing = current_versions[entry.agent_key];
    if (!existing || compareVersions(entry.agent_version, existing) > 0) current_versions[entry.agent_key] = entry.agent_version;
  }
  return Object.freeze({
    schema: 'titan.workforce.agent-registry.v1',
    company_id,
    registrations: Object.freeze(registrations.slice().sort((a, b) => a.agent_key.localeCompare(b.agent_key) || compareVersions(a.agent_version, b.agent_version))),
    current_versions: Object.freeze({...current_versions}),
    identity_grants_authority: false,
    registration_grants_authority: false,
  });
}

export function registerTitanWorkforceAgent(registry: TitanWorkforceAgentRegistry, declaration: TitanWorkforceAgentRegistration): TitanWorkforceAgentRegistry {
  if (registry.company_id !== declaration.company_id) throw new Error('cross-company-registration');
  const existing = registry.registrations.find((entry) => entry.agent_key === declaration.agent_key && entry.agent_version === declaration.agent_version);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(declaration)) throw new Error(`registration-version-conflict:${declaration.agent_key}@${declaration.agent_version}`);
    return registry;
  }
  return createTitanWorkforceAgentRegistry({company_id: registry.company_id, registrations: [...registry.registrations, declaration]});
}

export function declarationFromStarterAgent(input: {company_id: string; agent_key: string; agent_version: string; capabilities: readonly Record<string, unknown>[]; configuration?: Record<string, unknown>}): TitanWorkforceAgentRegistration {
  const starter = getStarterAgent(input.agent_key);
  if (!starter) throw new Error(`starter-agent-not-found:${clean(input.agent_key)}`);
  if (starter.company_boundary !== 'company_id' || starter.identity_grants_authority !== false) throw new Error('starter-agent-boundary-contract-invalid');
  return declareTitanWorkforceAgent({
    company_id: input.company_id,
    agent_key: starter.agent_key,
    agent_version: input.agent_version,
    name: starter.name,
    role_definition_id: starter.role_definition_id,
    operational_domains: starter.operational_domains,
    capabilities: input.capabilities,
    configuration: input.configuration ?? {},
  });
}
