import { assertTitanWorkforceLifecycleCompany } from './contracts.js';

const LEGACY_SCOPE_KEYS = new Set(['tenant_id','tenant_company_id','tenant','tenantCompanyId','organisation_id','organization_id']);
const EXECUTABLE_KEYS = new Set(['script','scripturl','javascript','code','handler','execute','entry','execution_permitted','grants_authority','authority_granted','identity_grants_authority']);
const SECRET_KEY_RE = /(secret|password|token|api[_-]?key|credential|private[_-]?key)/i;
const ID_RE = /^[A-Za-z0-9._:-]{1,180}$/;

export const TITAN_WORKFORCE_CONFIGURATION_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle-configuration.contract.v1',
  companyBoundary: 'company_id' as const,
  inheritanceOrder: Object.freeze(['manager','supervisor','agent'] as const),
  secretValuesStoredInline: false as const,
  secretsUseReferencesOnly: true as const,
  hierarchyBindingRequiredForSupervisorInheritance: true as const,
  settingsGrantAuthority: false as const,
  settingsEnableExecution: false as const,
  configurationOnly: true as const,
});

export type TitanWorkforceSecretReference = Readonly<{
  secret_ref: string;
}>;

export type TitanWorkforceHierarchyBindingEvidence = Readonly<{
  schema: 'titan.workforce.agent-binding.v1';
  companyId: string;
  managerId: string;
  supervisorId: string;
  agentKey: string;
  ownershipConfersExecutionAuthority: false;
  directInvocationConfersExecutionAuthority: false;
  executionRequiresAuthorityEvaluation: true;
  executionRequiresCapabilityResolution: true;
}>;

export type TitanWorkforceConfigurationProjection = Readonly<{
  schema: 'titan.workforce.lifecycle-configuration.v1';
  company_id: string;
  agent_key: string;
  manager_id: string | null;
  supervisor_id: string | null;
  hierarchy_binding_schema: 'titan.workforce.agent-binding.v1' | null;
  effective_configuration: Readonly<Record<string, unknown>>;
  inherited_layers: readonly ('manager'|'supervisor'|'agent')[];
  secret_references: readonly string[];
  configuration_only: true;
  execution_permitted: false;
  settings_grant_authority: false;
  identity_grants_authority: false;
}>;

function cleanId(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim().slice(0,180);
  if (!ID_RE.test(normalized)) throw new Error(`${field}-invalid`);
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSecretRef(value: unknown, path: string): TitanWorkforceSecretReference {
  if (!isPlainObject(value)) throw new Error(`secret-reference-required:${path}`);
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'secret_ref') throw new Error(`secret-reference-only:${path}`);
  const secret_ref = String(value.secret_ref ?? '').trim();
  if (!/^[A-Za-z0-9._:/-]{3,240}$/.test(secret_ref)) throw new Error(`secret-reference-invalid:${path}`);
  return Object.freeze({secret_ref});
}

function normalizeJson(value: unknown, path: string, refs: Set<string>): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error(`configuration-json-required:${path}`);
  if (Array.isArray(value)) return Object.freeze(value.map((item,index) => normalizeJson(item, `${path}[${index}]`, refs)));
  if (!isPlainObject(value)) throw new Error(`configuration-json-required:${path}`);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_SCOPE_KEYS.has(key)) throw new Error(`legacy-company-boundary:${path}.${key}`);
    const lower = key.toLowerCase();
    if (EXECUTABLE_KEYS.has(lower)) throw new Error(`configuration-authority-or-executable-key-forbidden:${path}.${key}`);
    if (SECRET_KEY_RE.test(key)) {
      const normalized = normalizeSecretRef(child, `${path}.${key}`);
      refs.add(normalized.secret_ref);
      output[key] = normalized;
      continue;
    }
    if (key === 'secret_ref') throw new Error(`secret-reference-must-be-under-secret-field:${path}.${key}`);
    output[key] = normalizeJson(child, `${path}.${key}`, refs);
  }
  return Object.freeze(output);
}

function deepMerge(base: Readonly<Record<string, unknown>>, override: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {...base};
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value) && !Object.hasOwn(value, 'secret_ref')) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

function normalizeLayer(value: unknown, label: string, refs: Set<string>): Readonly<Record<string, unknown>> {
  if (value == null) return Object.freeze({});
  if (!isPlainObject(value)) throw new Error(`${label}-configuration-object-required`);
  return normalizeJson(value, label, refs) as Readonly<Record<string, unknown>>;
}

function validateBinding(input: {
  company_id: string;
  agent_key: string;
  manager_id?: string | null;
  supervisor_id?: string | null;
  hierarchy_binding?: TitanWorkforceHierarchyBindingEvidence | null;
}): {manager_id:string|null; supervisor_id:string|null; hierarchy_binding_schema:'titan.workforce.agent-binding.v1'|null} {
  const managerWanted = input.manager_id == null ? null : cleanId(input.manager_id, 'manager_id');
  const supervisorWanted = input.supervisor_id == null ? null : cleanId(input.supervisor_id, 'supervisor_id');
  const binding = input.hierarchy_binding ?? null;
  if (!binding) {
    if (managerWanted || supervisorWanted) throw new Error('hierarchy-binding-required-for-inherited-settings');
    return {manager_id:null, supervisor_id:null, hierarchy_binding_schema:null};
  }
  if (binding.schema !== 'titan.workforce.agent-binding.v1') throw new Error('hierarchy-binding-schema-invalid');
  if (binding.companyId !== input.company_id) throw new Error('cross-company-hierarchy-binding');
  if (binding.agentKey !== input.agent_key) throw new Error('hierarchy-binding-agent-mismatch');
  if (managerWanted && binding.managerId !== managerWanted) throw new Error('hierarchy-binding-manager-mismatch');
  if (supervisorWanted && binding.supervisorId !== supervisorWanted) throw new Error('hierarchy-binding-supervisor-mismatch');
  if (binding.ownershipConfersExecutionAuthority !== false || binding.directInvocationConfersExecutionAuthority !== false || binding.executionRequiresAuthorityEvaluation !== true || binding.executionRequiresCapabilityResolution !== true) {
    throw new Error('hierarchy-binding-authority-contract-invalid');
  }
  return {manager_id:binding.managerId, supervisor_id:binding.supervisorId, hierarchy_binding_schema:binding.schema};
}

export function buildTitanWorkforceAgentConfiguration(input: {
  company_id: string;
  agent_key: string;
  manager_id?: string | null;
  supervisor_id?: string | null;
  hierarchy_binding?: TitanWorkforceHierarchyBindingEvidence | null;
  manager_settings?: Record<string, unknown> | null;
  supervisor_settings?: Record<string, unknown> | null;
  agent_settings?: Record<string, unknown> | null;
}): TitanWorkforceConfigurationProjection {
  const company_id = assertTitanWorkforceLifecycleCompany(input.company_id);
  const agent_key = cleanId(input.agent_key, 'agent_key');
  const binding = validateBinding({...input, company_id, agent_key});
  if ((input.manager_settings && !binding.manager_id) || (input.supervisor_settings && !binding.supervisor_id)) {
    throw new Error('verified-hierarchy-binding-required-for-inherited-settings');
  }
  const refs = new Set<string>();
  const manager = normalizeLayer(input.manager_settings, 'manager_settings', refs);
  const supervisor = normalizeLayer(input.supervisor_settings, 'supervisor_settings', refs);
  const agent = normalizeLayer(input.agent_settings, 'agent_settings', refs);
  const layers: ('manager'|'supervisor'|'agent')[] = [];
  let effective: Readonly<Record<string, unknown>> = Object.freeze({});
  if (Object.keys(manager).length) { effective = deepMerge(effective, manager); layers.push('manager'); }
  if (Object.keys(supervisor).length) { effective = deepMerge(effective, supervisor); layers.push('supervisor'); }
  if (Object.keys(agent).length) { effective = deepMerge(effective, agent); layers.push('agent'); }
  return Object.freeze({
    schema: 'titan.workforce.lifecycle-configuration.v1',
    company_id,
    agent_key,
    manager_id: binding.manager_id,
    supervisor_id: binding.supervisor_id,
    hierarchy_binding_schema: binding.hierarchy_binding_schema,
    effective_configuration: effective,
    inherited_layers: Object.freeze(layers),
    secret_references: Object.freeze([...refs].sort()),
    configuration_only: true,
    execution_permitted: false,
    settings_grant_authority: false,
    identity_grants_authority: false,
  });
}
