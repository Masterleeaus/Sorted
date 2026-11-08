// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/analytics/kpi-evidence-drilldown.mjs

function rejectLegacyBoundary(input = {}) {
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new Error('Legacy tenant boundary aliases are not permitted; use company_id');
  }
}
function req(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function normalizeLinkableProvenance(item = {}) {
  const source_id = typeof item.source_id === 'string' ? item.source_id.trim() : '';
  const source_ref = typeof item.source_ref === 'string' ? item.source_ref.trim() : '';
  if (!source_ref) return null; // backwards-compatible: provenance may be summary-only
  if (!source_id) throw new Error('source_id is required when source_ref is present');
  return Object.freeze({source_id, source_ref, observed_at:item.observed_at ?? null});
}
export function buildEvidenceLinks(input = {}) {
  rejectLegacyBoundary(input);
  const company_id=req('company_id',input.company_id);
  const metric_id=req('metric_id',input.metric_id);
  const allowed=new Set(Array.isArray(input.allowed_source_ids)?input.allowed_source_ids:[]);
  const raw=Array.isArray(input.provenance)?input.provenance:[];
  const provenance=raw.map(normalizeLinkableProvenance).filter(Boolean);
  const seen=new Set();
  const links=[];
  for(const p of provenance){
    if(allowed.size && !allowed.has(p.source_id)) throw new Error(`Unknown provenance source_id: ${p.source_id}`);
    const key=`${p.source_id}|${p.source_ref}`;
    if(seen.has(key)) continue;
    seen.add(key);
    links.push(Object.freeze({
      schema:'titan-zero-evidence-link/v1',
      company_id,
      metric_id,
      source_id:p.source_id,
      source_ref:p.source_ref,
      observed_at:p.observed_at,
      action:'inspect_source',
      locator:Object.freeze({kind:'source_ref',source_id:p.source_id,ref:p.source_ref}),
      read_only:true,
      execution_authority:false,
      analytics_grants_authority:false
    }));
  }
  links.sort((a,b)=>a.source_id.localeCompare(b.source_id)||a.source_ref.localeCompare(b.source_ref));
  return Object.freeze(links);
}
export function buildMetricDrillDown(input = {}) {
  rejectLegacyBoundary(input);
  const company_id=req('company_id',input.company_id);
  const metric=input.metric||{};
  const metric_id=req('metric_id',metric.metric_id);
  const links=buildEvidenceLinks({
    company_id,metric_id,provenance:metric.provenance||[],
    allowed_source_ids:input.allowed_source_ids||[]
  });
  return Object.freeze({
    schema:'titan-zero-kpi-drilldown/v1',
    company_id,
    metric_id,
    status:links.length?'available':'missing',
    evidence_links:links,
    missing_reason:links.length?null:'no provenance-backed evidence links available',
    read_only:true,
    source_of_truth:false,
    execution_authority:false,
    analytics_grants_authority:false
  });
}
