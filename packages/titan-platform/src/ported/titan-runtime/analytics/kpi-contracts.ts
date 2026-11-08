// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/analytics/kpi-contracts.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const REGISTRY_SCHEMA = 'titan-zero-kpi-registry/v1';
const KPI_VALUE_SCHEMA = 'titan-zero-kpi-value/v1';
const STATUS = new Set(['available','missing','partial','stale','invalid']);

function rejectLegacyBoundary(input = {}) {
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new Error('Legacy tenant boundary aliases are not permitted; use company_id');
  }
}
function requireString(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
export function validateMetricDefinition(definition, sourceIds = []) {
  if (!definition || typeof definition !== 'object') throw new Error('metric definition required');
  requireString('metric_id', definition.metric_id);
  requireString('domain', definition.domain);
  requireString('unit', definition.unit);
  requireString('aggregation', definition.aggregation);
  if (!Array.isArray(definition.source_ids) || definition.source_ids.length === 0) throw new Error('source_ids required');
  const allowed = new Set(sourceIds);
  for (const id of definition.source_ids) {
    requireString('source_id', id);
    if (allowed.size && !allowed.has(id)) throw new Error(`Unknown KPI source_id: ${id}`);
  }
  return true;
}
export function createKpiValue(input = {}) {
  rejectLegacyBoundary(input);
  requireString('metric_id', input.metric_id);
  const company_id = requireString('company_id', input.company_id);
  if (!input.window || typeof input.window !== 'object') throw new Error('window required');
  const window = {
    start: requireString('window.start', input.window.start),
    end: requireString('window.end', input.window.end),
    timezone: requireString('window.timezone', input.window.timezone)
  };
  if (!STATUS.has(input.status)) throw new Error('invalid KPI status');
  if (!Array.isArray(input.provenance) || input.provenance.length === 0) throw new Error('provenance required');
  const provenance = input.provenance.map((item) => ({
    ...item,
    source_id: requireString('provenance.source_id', item?.source_id),
    source_ref: requireString('provenance.source_ref', item?.source_ref)
  }));
  const isMissing = input.status === 'missing';
  if (isMissing && input.value !== null) throw new Error('missing KPI must use value=null');
  if (isMissing && (typeof input.missing_reason !== 'string' || !input.missing_reason.trim())) {
    throw new Error('missing KPI requires missing_reason');
  }
  return Object.freeze({
    schema: KPI_VALUE_SCHEMA,
    metric_id: input.metric_id,
    company_id,
    window: Object.freeze(window),
    status: input.status,
    value: isMissing ? null : (input.value ?? null),
    unit: input.unit ?? null,
    provenance: Object.freeze(provenance.map(Object.freeze)),
    missing_reason: isMissing ? input.missing_reason : (input.missing_reason ?? null),
    generated_at: input.generated_at ?? null,
    analytics_granted_authority: false,
    execution_authority: false
  });
}
export function createMissingKpiValue(input = {}) {
  return createKpiValue({...input, status:'missing', value:null});
}
export function registryDescriptor(registry) {
  if (!registry || registry.schema !== REGISTRY_SCHEMA) throw new Error('invalid KPI registry');
  return Object.freeze({
    schema: REGISTRY_SCHEMA,
    metric_count: registry.metrics?.length ?? 0,
    company_boundary: 'company_id',
    analytics_is_source_of_truth: false,
    analytics_grants_authority: false
  });
}
export { REGISTRY_SCHEMA, KPI_VALUE_SCHEMA };
