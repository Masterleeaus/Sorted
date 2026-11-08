// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/analytics/analytics-ui-contributions.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { buildMetricDrillDown } from './kpi-evidence-drilldown.js';

function rejectLegacyBoundary(input = {}) {
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new Error('Legacy tenant boundary aliases are not permitted; use company_id');
  }
}
function req(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function safeMetricView(metric = {}, company_id, allowed_source_ids = []) {
  const metric_id=req('metric_id', metric.metric_id);
  const drill_down=buildMetricDrillDown({
    company_id,
    metric:{...metric,metric_id},
    allowed_source_ids
  });
  return Object.freeze({
    metric_id,
    label: String(metric.label ?? metric_id),
    domain: String(metric.domain ?? 'unknown'),
    unit: String(metric.unit ?? ''),
    status: String(metric.status ?? 'missing'),
    value: metric.value ?? null,
    trend: metric.trend ?? null,
    variance: metric.variance ?? null,
    provenance_count: Array.isArray(metric.provenance) ? metric.provenance.length : 0,
    drill_down
  });
}
export function buildAnalyticsSurfaceModel(input = {}) {
  rejectLegacyBoundary(input);
  const company_id = req('company_id', input.company_id);
  const metrics = Array.isArray(input.metrics) ? input.metrics.map(metric=>safeMetricView(metric, company_id, input.allowed_source_ids || [])) : [];
  const groups = {};
  for (const metric of metrics) {
    (groups[metric.domain] ||= []).push(metric);
  }
  for (const key of Object.keys(groups)) groups[key] = Object.freeze(groups[key]);
  return Object.freeze({
    schema: 'titan-zero-analytics-surface-model/v1',
    company_id,
    surface_id: 'analytics.business-kpis',
    title: 'Business Analytics',
    summary: 'Derived KPI projections with provenance-backed status and trend context.',
    groups: Object.freeze(groups),
    metrics: Object.freeze(metrics),
    read_only: true,
    source_of_truth: false,
    execution_authority: false,
    analytics_grants_authority: false
  });
}
export function createAnalyticsUiContributions(input = {}) {
  rejectLegacyBoundary(input);
  const company_id = req('company_id', input.company_id);
  const model = buildAnalyticsSurfaceModel({company_id, metrics: input.metrics || [], allowed_source_ids: input.allowed_source_ids || []});
  return Object.freeze([
    Object.freeze({
      company_id,
      kind: 'projection',
      id: 'analytics.business-kpis.projection',
      provider_id: 'titan.analytics',
      priority: 50,
      operations: ['read','inspect','drill_down'],
      capabilities: ['analytics.kpi.read','analytics.trend.read','analytics.provenance.read'],
      permissions: [],
      offline_support: true,
      metadata: {
        title: 'Business Analytics KPI projection',
        surface: 'business-analytics',
        placement: ['dashboard','daily-operations'],
        replaces_existing_page: false,
        read_only: true
      },
      payload: {surface_model: model}
    }),
    Object.freeze({
      company_id,
      kind: 'presentation',
      id: 'analytics.business-kpis.cards',
      provider_id: 'titan.analytics',
      priority: 45,
      operations: ['render'],
      capabilities: ['analytics.kpi.cards'],
      permissions: [],
      offline_support: true,
      metadata: {
        title: 'Analytics KPI cards',
        surface: 'business-analytics',
        placement: ['dashboard'],
        replaces_existing_page: false,
        presentation_only: true
      },
      payload: {
        component: 'kpi-card-grid',
        model_ref: 'analytics.business-kpis.projection',
        empty_state: 'No KPI data is available for this company and selected window.'
      }
    })
  ]);
}
export function installAnalyticsUiContributions(registry, input = {}) {
  if (!registry || typeof registry.registerMany !== 'function') throw new Error('ContributionRegistry-compatible instance required');
  const contributions = createAnalyticsUiContributions(input);
  return registry.registerMany(contributions);
}
