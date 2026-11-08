// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/analytics/cleaning-kpi-definitions.mjs

export const CLEANING_KPI_REGISTRY_SCHEMA='titan-zero-cleaning-kpi-registry/v1';

function requireString(name,value){
  if(typeof value!=='string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
export function validateCleaningMetric(definition, allowedSourceIds=[]){
  if(!definition || typeof definition!=='object') throw new Error('cleaning metric definition required');
  requireString('metric_id',definition.metric_id);
  if(!definition.metric_id.startsWith('cleaning.')) throw new Error('cleaning metric_id must use cleaning. namespace');
  requireString('domain',definition.domain);
  requireString('unit',definition.unit);
  requireString('aggregation',definition.aggregation);
  if(!Array.isArray(definition.source_ids) || definition.source_ids.length===0) throw new Error('source_ids required');
  const allowed=new Set(allowedSourceIds);
  for(const sourceId of definition.source_ids){
    requireString('source_id',sourceId);
    if(allowed.size && !allowed.has(sourceId)) throw new Error(`Unknown KPI source_id: ${sourceId}`);
  }
  return true;
}
export function mergeCleaningMetrics(baseRegistry, cleaningRegistry, allowedSourceIds=[]){
  if(!baseRegistry || baseRegistry.schema!=='titan-zero-kpi-registry/v1') throw new Error('base KPI registry required');
  if(!cleaningRegistry || cleaningRegistry.schema!==CLEANING_KPI_REGISTRY_SCHEMA) throw new Error('cleaning KPI registry required');
  const seen=new Set((baseRegistry.metrics||[]).map(m=>m.metric_id));
  const additions=[];
  for(const metric of cleaningRegistry.metrics||[]){
    validateCleaningMetric(metric,allowedSourceIds);
    if(seen.has(metric.metric_id)) throw new Error(`Duplicate KPI metric_id: ${metric.metric_id}`);
    seen.add(metric.metric_id);
    additions.push(Object.freeze({...metric}));
  }
  return Object.freeze({
    schema:'titan-zero-kpi-registry-view/v1',
    company_boundary:'company_id',
    analytics_grants_authority:false,
    source_modules_remain_canonical:true,
    metrics:Object.freeze([...(baseRegistry.metrics||[]),...additions])
  });
}
