// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/analytics/analytics-summary-snapshots.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.

function rejectLegacyBoundary(input = {}) {
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new Error('Legacy tenant boundary aliases are not permitted; use company_id');
  }
}
function req(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function normalizeCadence(value) {
  const cadence = req('cadence', value).toLowerCase();
  if (!['daily','weekly','monthly'].includes(cadence)) {
    throw new Error('cadence must be daily, weekly or monthly');
  }
  return cadence;
}
function normalizeWindow(window) {
  if (!window || typeof window !== 'object') throw new Error('window required');
  const start=req('window.start',window.start);
  const end=req('window.end',window.end);
  const timezone=req('window.timezone',window.timezone);
  if (!(Date.parse(start) < Date.parse(end))) throw new Error('window start must be before end');
  return Object.freeze({start,end,timezone});
}
function normalizeMetric(metric = {}) {
  return Object.freeze({
    metric_id:req('metric_id',metric.metric_id),
    label:String(metric.label ?? metric.metric_id),
    domain:String(metric.domain ?? 'unknown'),
    unit:String(metric.unit ?? ''),
    status:String(metric.status ?? 'missing'),
    value:metric.value ?? null,
    trend:metric.trend ?? null,
    variance:metric.variance ?? null,
    provenance:Array.isArray(metric.provenance)?metric.provenance:[]
  });
}
function stableMetricSort(a,b) {
  return a.domain.localeCompare(b.domain) || a.metric_id.localeCompare(b.metric_id);
}
export function buildAnalyticsSummary(input = {}) {
  rejectLegacyBoundary(input);
  const company_id=req('company_id',input.company_id);
  const cadence=normalizeCadence(input.cadence);
  const window=normalizeWindow(input.window);
  const generated_at=req('generated_at',input.generated_at);
  const metrics=(Array.isArray(input.metrics)?input.metrics:[]).map(normalizeMetric).sort(stableMetricSort);

  const counts={available:0,partial:0,missing:0,stale:0,invalid:0,other:0};
  for (const metric of metrics) {
    if (metric.status in counts) counts[metric.status] += 1;
    else counts.other += 1;
  }

  return Object.freeze({
    schema:'titan-zero-analytics-summary/v1',
    company_id,
    cadence,
    window,
    generated_at,
    metrics:Object.freeze(metrics),
    metric_count:metrics.length,
    status_counts:Object.freeze(counts),
    exportable:true,
    read_only:true,
    source_of_truth:false,
    execution_authority:false,
    analytics_grants_authority:false
  });
}
export function exportAnalyticsSummary(input = {}) {
  rejectLegacyBoundary(input);
  const summary=buildAnalyticsSummary(input);
  const format=(input.format ?? 'json').toLowerCase();
  if (!['json','csv'].includes(format)) throw new Error('format must be json or csv');

  if (format === 'json') {
    return Object.freeze({
      schema:'titan-zero-analytics-export/v1',
      company_id:summary.company_id,
      cadence:summary.cadence,
      format,
      mime_type:'application/json',
      file_name:`analytics-${summary.company_id}-${summary.cadence}-${summary.window.start.slice(0,10)}.json`,
      content:JSON.stringify(summary,null,2),
      read_only:true,
      execution_authority:false
    });
  }

  const headers=['metric_id','label','domain','unit','status','value'];
  const esc=(v)=>{
    const s=v===null||v===undefined?'':String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
  };
  const rows=[headers.join(',')];
  for (const metric of summary.metrics) {
    rows.push([
      metric.metric_id,metric.label,metric.domain,metric.unit,metric.status,metric.value
    ].map(esc).join(','));
  }
  return Object.freeze({
    schema:'titan-zero-analytics-export/v1',
    company_id:summary.company_id,
    cadence:summary.cadence,
    format,
    mime_type:'text/csv',
    file_name:`analytics-${summary.company_id}-${summary.cadence}-${summary.window.start.slice(0,10)}.csv`,
    content:rows.join('\n')+'\n',
    read_only:true,
    execution_authority:false
  });
}
export function createAnalyticsSnapshot(input = {}) {
  rejectLegacyBoundary(input);
  const summary=buildAnalyticsSummary(input);
  const snapshot_key=[
    'analytics',summary.company_id,summary.cadence,summary.window.timezone,
    summary.window.start,summary.window.end
  ].join('|');
  return Object.freeze({
    schema:'titan-zero-analytics-snapshot/v1',
    snapshot_key,
    company_id:summary.company_id,
    cadence:summary.cadence,
    window:summary.window,
    generated_at:summary.generated_at,
    summary,
    cache_policy:Object.freeze({
      local_first:true,
      network_required:false,
      immutable_window:true,
      replace_only_same_key:true
    }),
    read_only:true,
    source_of_truth:false,
    execution_authority:false,
    analytics_grants_authority:false
  });
}
export function createLocalSnapshotStore(input = {}) {
  rejectLegacyBoundary(input);
  const company_id=req('company_id',input.company_id);
  const state=new Map();

  function validate(snapshot) {
    if (!snapshot || snapshot.schema!=='titan-zero-analytics-snapshot/v1') throw new Error('analytics snapshot required');
    if (snapshot.company_id!==company_id) throw new Error('cross-company snapshot rejected');
  }

  return Object.freeze({
    company_id,
    put(snapshot) {
      validate(snapshot);
      state.set(snapshot.snapshot_key,snapshot);
      return snapshot;
    },
    get(snapshot_key) {
      req('snapshot_key',snapshot_key);
      return state.get(snapshot_key) ?? null;
    },
    list() {
      return Object.freeze([...state.values()].sort((a,b)=>a.snapshot_key.localeCompare(b.snapshot_key)));
    },
    remove(snapshot_key) {
      req('snapshot_key',snapshot_key);
      return state.delete(snapshot_key);
    },
    clear() {
      state.clear();
    },
    size() {
      return state.size;
    },
    execution_authority:false,
    source_of_truth:false
  });
}
