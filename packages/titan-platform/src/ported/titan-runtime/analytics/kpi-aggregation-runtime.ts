// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/analytics/kpi-aggregation-runtime.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.

import { createKpiValue, createMissingKpiValue } from './kpi-contracts.js';

function rejectLegacyBoundary(input = {}) {
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new Error('Legacy tenant boundary aliases are not permitted; use company_id');
  }
}
function req(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function toMs(name, value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${name} must be a valid date/time`);
  return ms;
}
export function normalizeWindow(window = {}) {
  const start=req('window.start',window.start);
  const end=req('window.end',window.end);
  const timezone=req('window.timezone',window.timezone);
  const start_ms=toMs('window.start',start);
  const end_ms=toMs('window.end',end);
  if (end_ms <= start_ms) throw new Error('window.end must be after window.start');
  return Object.freeze({start,end,timezone,start_ms,end_ms});
}
export function normalizeObservation(input = {}) {
  rejectLegacyBoundary(input);
  const company_id=req('company_id',input.company_id);
  const source_id=req('source_id',input.source_id);
  const source_ref=req('source_ref',input.source_ref);
  const event_id=req('event_id',input.event_id);
  const occurred_at=req('occurred_at',input.occurred_at);
  const occurred_at_ms=toMs('occurred_at',occurred_at);
  return Object.freeze({
    company_id, source_id, source_ref, event_id, occurred_at, occurred_at_ms,
    value: input.value ?? null,
    fields: input.fields && typeof input.fields === 'object' ? Object.freeze({...input.fields}) : Object.freeze({})
  });
}
export function filterWindowObservations(input = {}) {
  rejectLegacyBoundary(input);
  const {company_id, window, observations=[]} = input;
  req('company_id',company_id);
  const w=normalizeWindow(window);
  const seen=new Set();
  const accepted=[];
  const rejected=[];
  for(const raw of observations){
    const obs=normalizeObservation(raw);
    if(obs.company_id !== company_id){
      rejected.push(Object.freeze({event_id:obs.event_id,reason:'cross_company'}));
      continue;
    }
    if(obs.occurred_at_ms < w.start_ms || obs.occurred_at_ms >= w.end_ms){
      rejected.push(Object.freeze({event_id:obs.event_id,reason:'outside_window'}));
      continue;
    }
    const dedupeKey=`${obs.company_id}|${obs.source_id}|${obs.event_id}`;
    if(seen.has(dedupeKey)){
      rejected.push(Object.freeze({event_id:obs.event_id,reason:'duplicate_event'}));
      continue;
    }
    seen.add(dedupeKey);
    accepted.push(obs);
  }
  accepted.sort((a,b)=>a.occurred_at_ms-b.occurred_at_ms || a.source_id.localeCompare(b.source_id) || a.event_id.localeCompare(b.event_id));
  return Object.freeze({window:w,accepted:Object.freeze(accepted),rejected:Object.freeze(rejected)});
}
function numericValues(observations){
  const vals=[];
  for(const o of observations){
    const n=typeof o.value === 'number' ? o.value : Number(o.value);
    if(Number.isFinite(n)) vals.push(n);
  }
  return vals;
}
export function aggregateMetric(input = {}) {
  rejectLegacyBoundary(input);
  const {definition,company_id,window,observations=[],generated_at=null} = input;
  if(!definition || typeof definition!=='object') throw new Error('metric definition required');
  req('metric_id',definition.metric_id);
  req('aggregation',definition.aggregation);
  req('unit',definition.unit);
  const filtered=filterWindowObservations({company_id,window,observations});
  const allowedSources=new Set(definition.source_ids || []);
  const relevant=filtered.accepted.filter(o=>allowedSources.has(o.source_id));
  const provenance=relevant.map(o=>({source_id:o.source_id,source_ref:o.source_ref,observed_at:o.occurred_at}));
  if(relevant.length===0){
    return createMissingKpiValue({
      metric_id:definition.metric_id,company_id,window:{start:filtered.window.start,end:filtered.window.end,timezone:filtered.window.timezone},
      unit:definition.unit,missing_reason:'no qualifying source observations in window',
      provenance:[{source_id:(definition.source_ids||[])[0] || 'unknown',source_ref:'source:no-data'}],
      generated_at
    });
  }
  let value=null;
  const aggregation=definition.aggregation;
  if(aggregation==='count') value=relevant.length;
  else if(aggregation==='distinct_count'){
    const keys=relevant.map(o=>String(o.fields?.distinct_key ?? o.fields?.worker_id ?? o.fields?.customer_id ?? o.source_ref));
    value=new Set(keys).size;
  } else if(aggregation==='sum'){
    const vals=numericValues(relevant);
    if(vals.length!==relevant.length) return createMissingKpiValue({
      metric_id:definition.metric_id,company_id,window:{start:filtered.window.start,end:filtered.window.end,timezone:filtered.window.timezone},
      unit:definition.unit,missing_reason:'non-numeric source observations prevent deterministic sum',
      provenance,generated_at
    });
    value=vals.reduce((a,b)=>a+b,0);
  } else if(aggregation==='average'){
    const vals=numericValues(relevant);
    if(vals.length===0) return createMissingKpiValue({
      metric_id:definition.metric_id,company_id,window:{start:filtered.window.start,end:filtered.window.end,timezone:filtered.window.timezone},
      unit:definition.unit,missing_reason:'no numeric source observations for average',
      provenance,generated_at
    });
    value=vals.reduce((a,b)=>a+b,0)/vals.length;
  } else if(aggregation==='age'){
    const newest=Math.max(...relevant.map(o=>o.occurred_at_ms));
    const generatedMs=generated_at ? toMs('generated_at',generated_at) : filtered.window.end_ms;
    value=Math.max(0,generatedMs-newest);
  } else if(aggregation==='ratio'){
    const numerator=relevant.filter(o=>o.fields?.role==='numerator').reduce((a,o)=>a+(Number(o.value)||0),0);
    const denominator=relevant.filter(o=>o.fields?.role==='denominator').reduce((a,o)=>a+(Number(o.value)||0),0);
    if(!(denominator>0)) return createMissingKpiValue({
      metric_id:definition.metric_id,company_id,window:{start:filtered.window.start,end:filtered.window.end,timezone:filtered.window.timezone},
      unit:definition.unit,missing_reason:'ratio denominator unavailable or zero',
      provenance,generated_at
    });
    value=numerator/denominator;
  } else throw new Error(`unsupported aggregation: ${aggregation}`);
  return createKpiValue({
    metric_id:definition.metric_id,company_id,
    window:{start:filtered.window.start,end:filtered.window.end,timezone:filtered.window.timezone},
    status:'available',value,unit:definition.unit,provenance,generated_at
  });
}
export const AGGREGATION_RUNTIME_SCHEMA='titan-zero-kpi-aggregation-runtime/v1';
