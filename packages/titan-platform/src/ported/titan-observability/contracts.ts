// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-observability/contracts.mjs
export const OBSERVABILITY_PROTOCOL='titan.observability.v1';
export const OBSERVABILITY_MODULE_ID='titan.observability';
export const OBSERVABILITY_COLLECTION='events';

const LEGACY_COMPANY_KEYS=new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const SEVERITIES=new Set(['debug','info','warn','error','critical']);
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const text=(value,field)=>{const out=String(value??'').trim();if(!out)throw new TypeError(`${field}-required`);return out};
const optional=value=>{const out=String(value??'').trim();return out||null};

function rejectLegacy(value,path='observation'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((item,index)=>rejectLegacy(item,`${path}[${index}]`));return;}
  for(const [key,nested] of Object.entries(value)){
    if(LEGACY_COMPANY_KEYS.has(key))throw new Error(`legacy-company-boundary:${path}.${key}`);
    rejectLegacy(nested,`${path}.${key}`);
  }
}

function normalizeCompany(raw,expected){
  const supplied=String(raw?.company_id??'').trim();
  const required=String(expected??'').trim();
  if(!supplied&&!required)throw new Error('company_id-required');
  if(supplied&&required&&supplied!==required)throw new Error('cross-company-observation');
  return supplied||required;
}

function defaultEventId(){
  const suffix=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  return `obs-${suffix}`;
}

export function normalizeObservation(raw,{company_id:expectedCompanyId=null,clock=Date.now}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('observation-required');
  rejectLegacy(raw);
  const severity=String(raw.severity??'info').trim().toLowerCase();
  if(!SEVERITIES.has(severity))throw new TypeError(`unsupported-observability-severity:${severity}`);
  const company_id=normalizeCompany(raw,expectedCompanyId);
  return Object.freeze({
    schema:OBSERVABILITY_PROTOCOL,
    event_id:optional(raw.event_id)||defaultEventId(),
    company_id,
    observed_at:Number.isFinite(Number(raw.observed_at))?Number(raw.observed_at):Number(clock()),
    event_type:text(raw.event_type??raw.type,'event_type'),
    component:text(raw.component??raw.source,'component').toLowerCase(),
    severity,
    source:optional(raw.source)||'titan-zero',
    correlation_id:optional(raw.correlation_id),
    operation_id:optional(raw.operation_id),
    causation_id:optional(raw.causation_id),
    actor_id:optional(raw.actor_id),
    payload:Object.freeze(clone(raw.payload??raw.detail??{})),
    tags:Object.freeze([...new Set((Array.isArray(raw.tags)?raw.tags:[]).map(x=>String(x??'').trim()).filter(Boolean))]),
    observability_not_authority:true,
    grants_authority:false,
    authority_effect:false,
    direct_mutation_authority:false,
  });
}
