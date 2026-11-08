// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/analytics/kpi-trend-variance.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.

function rejectLegacyBoundary(input = {}) {
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new Error('Legacy tenant boundary aliases are not permitted; use company_id');
  }
}
function req(name,value){
  if(typeof value!=='string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function finiteOrNull(value){
  return typeof value==='number' && Number.isFinite(value) ? value : null;
}
function normalizePoint(point={}){
  rejectLegacyBoundary(point);
  return Object.freeze({
    metric_id:req('metric_id',point.metric_id),
    company_id:req('company_id',point.company_id),
    status:req('status',point.status),
    value:finiteOrNull(point.value),
    window:point.window || null,
    provenance:Array.isArray(point.provenance)?point.provenance:[]
  });
}
export function compareMetricWindows(input={}){
  rejectLegacyBoundary(input);
  const company_id=req('company_id',input.company_id);
  const current=normalizePoint(input.current||{});
  const previous=normalizePoint(input.previous||{});
  if(current.company_id!==company_id || previous.company_id!==company_id) throw new Error('cross-company trend comparison rejected');
  if(current.metric_id!==previous.metric_id) throw new Error('metric_id mismatch');
  const missingStatuses=new Set(['missing','invalid']);
  if(missingStatuses.has(current.status) || missingStatuses.has(previous.status) || current.value===null || previous.value===null){
    return Object.freeze({
      schema:'titan-zero-kpi-trend/v1',metric_id:current.metric_id,company_id,
      status:'missing',delta:null,percent_change:null,direction:'unknown',
      missing_reason:'current or previous metric unavailable',
      provenance:Object.freeze([...(previous.provenance||[]),...(current.provenance||[])]),
      analytics_grants_authority:false
    });
  }
  const delta=current.value-previous.value;
  let percent_change=null;
  let status=(current.status==='partial'||previous.status==='partial')?'partial':'available';
  let missing_reason=null;
  if(previous.value===0){
    percent_change=null;
    status='partial';
    missing_reason='percent change undefined because previous value is zero';
  } else {
    percent_change=delta/Math.abs(previous.value);
  }
  const direction=delta>0?'up':delta<0?'down':'flat';
  return Object.freeze({
    schema:'titan-zero-kpi-trend/v1',metric_id:current.metric_id,company_id,
    status,delta,percent_change,direction,missing_reason,
    previous_window:previous.window,current_window:current.window,
    provenance:Object.freeze([...(previous.provenance||[]),...(current.provenance||[])]),
    analytics_grants_authority:false
  });
}
export function varianceFromTarget(input={}){
  rejectLegacyBoundary(input);
  const company_id=req('company_id',input.company_id);
  const point=normalizePoint(input.metric||{});
  if(point.company_id!==company_id) throw new Error('cross-company variance rejected');
  const target=finiteOrNull(input.target);
  if(target===null || point.value===null || point.status==='missing' || point.status==='invalid'){
    return Object.freeze({
      schema:'titan-zero-kpi-variance/v1',metric_id:point.metric_id,company_id,
      status:'missing',variance:null,percent_variance:null,direction:'unknown',
      missing_reason:target===null?'target unavailable':'metric unavailable',
      provenance:Object.freeze(point.provenance||[]),
      analytics_grants_authority:false
    });
  }
  const variance=point.value-target;
  let percent_variance=null;
  let status=point.status==='partial'?'partial':'available';
  let missing_reason=null;
  if(target===0){
    status='partial';
    missing_reason='percent variance undefined because target is zero';
  } else percent_variance=variance/Math.abs(target);
  return Object.freeze({
    schema:'titan-zero-kpi-variance/v1',metric_id:point.metric_id,company_id,
    status,variance,percent_variance,direction:variance>0?'above':variance<0?'below':'on_target',
    missing_reason,provenance:Object.freeze(point.provenance||[]),
    analytics_grants_authority:false
  });
}
