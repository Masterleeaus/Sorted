import { CLEANING_SERVICE_BY_ID } from './catalogue.js';

export const CLEANING_EXECUTION_PACK_SCHEMA = 'titan.vertical.cleaning.execution-pack.v1' as const;

export interface CleaningExecutionAreaInput {
  area_ref: string;
  label: string;
  selected_inclusions?: readonly string[];
  checklist_items?: readonly string[];
  evidence_required?: readonly ('before_photo'|'after_photo'|'completion_photo'|'exception_photo'|'note')[];
}

export interface CleaningExecutionPackInput {
  company_id: string;
  job_ref: string;
  booking_ref?: string;
  site_ref: string;
  service_id: string;
  areas: readonly CleaningExecutionAreaInput[];
  equipment_available?: readonly string[];
  supplies_available?: readonly string[];
  supply_requirements?: readonly string[];
  exception_notes?: readonly { area_ref?: string; code: string; note_ref: string; evidence_refs?: readonly string[] }[];
  completion?: {
    completed_checklist_item_refs?: readonly string[];
    evidence_refs?: readonly string[];
    completed_at_local?: string;
    device_ref?: string;
    offline_sequence?: number;
    sync_state?: 'LOCAL_ONLY'|'QUEUED'|'SYNCED'|'CONFLICT';
  };
}

const LEGACY_COMPANY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacy(value: unknown, path='input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`)); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_COMPANY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacy(child, `${path}.${key}`);
  }
}
function clean(value: unknown, label: string): string { const v=String(value??'').trim(); if(!v) throw new Error(`${label} is required`); return v; }
function optional(value: unknown): string|null { const v=String(value??'').trim(); return v||null; }
function uniq(values: readonly string[]|undefined): readonly string[] { return Object.freeze([...new Set((values??[]).map(v=>String(v).trim()).filter(Boolean))]); }
function nonNegativeInt(value: unknown, label:string, fallback=0): number { if(value==null) return fallback; const n=Number(value); if(!Number.isInteger(n)||n<0) throw new Error(`${label} must be a non-negative integer`); return n; }

export function buildCleaningExecutionPack(input: CleaningExecutionPackInput) {
  rejectLegacy(input);
  const company_id=clean(input.company_id,'company_id');
  const job_ref=clean(input.job_ref,'job_ref');
  const site_ref=clean(input.site_ref,'site_ref');
  const service_id=clean(input.service_id,'service_id');
  const service=CLEANING_SERVICE_BY_ID[service_id];
  if(!service) throw new Error(`unknown cleaning service id: ${service_id}`);
  const areas=(input.areas??[]).map((raw,index)=>{
    const area_ref=clean(raw.area_ref,`areas[${index}].area_ref`);
    const label=clean(raw.label,`areas[${index}].label`);
    const selected_inclusions=uniq(raw.selected_inclusions?.length ? raw.selected_inclusions : service.inclusions);
    const checklist_items=uniq(raw.checklist_items?.length ? raw.checklist_items : selected_inclusions);
    const evidence_required=Object.freeze([...(raw.evidence_required??['completion_photo'])]);
    return Object.freeze({area_ref,label,selected_inclusions,checklist_items,evidence_required});
  });
  if(!areas.length) throw new Error('at least one cleaning area is required');
  if(new Set(areas.map(x=>x.area_ref)).size!==areas.length) throw new Error('duplicate cleaning area_ref');

  const equipment_available=uniq(input.equipment_available);
  const supplies_available=uniq(input.supplies_available);
  const equipment_required=uniq(service.equipment);
  const supply_requirements=uniq(input.supply_requirements);
  const equipment_missing=Object.freeze(equipment_required.filter(item=>!equipment_available.includes(item)));
  const supplies_missing=Object.freeze(supply_requirements.filter(item=>!supplies_available.includes(item)));

  const exceptions=Object.freeze((input.exception_notes??[]).map((raw,index)=>Object.freeze({
    area_ref: optional(raw.area_ref),
    code: clean(raw.code,`exception_notes[${index}].code`),
    note_ref: clean(raw.note_ref,`exception_notes[${index}].note_ref`),
    evidence_refs: uniq(raw.evidence_refs)
  })));
  for(const exception of exceptions){ if(exception.area_ref && !areas.some(x=>x.area_ref===exception.area_ref)) throw new Error(`exception references unknown cleaning area: ${exception.area_ref}`); }

  const completedChecklist=uniq(input.completion?.completed_checklist_item_refs);
  const evidenceRefs=uniq(input.completion?.evidence_refs);
  const requiredChecklist=uniq(areas.flatMap(area=>[...area.checklist_items]));
  const missingChecklist=Object.freeze(requiredChecklist.filter(item=>!completedChecklist.includes(item)));
  const evidenceRequiredCount=areas.reduce((n,area)=>n+area.evidence_required.filter(kind=>kind!=='note').length,0);
  const evidence_shortage=Math.max(0,evidenceRequiredCount-evidenceRefs.length);
  const sync_state=input.completion?.sync_state??'LOCAL_ONLY';
  if(!['LOCAL_ONLY','QUEUED','SYNCED','CONFLICT'].includes(sync_state)) throw new Error(`unsupported cleaning completion sync_state: ${sync_state}`);
  const blockers=Object.freeze([
    ...equipment_missing.map(x=>`EQUIPMENT_MISSING:${x}`),
    ...supplies_missing.map(x=>`SUPPLY_MISSING:${x}`),
    ...missingChecklist.map(x=>`CHECKLIST_INCOMPLETE:${x}`),
    ...(evidence_shortage?['EVIDENCE_INCOMPLETE']:[]),
    ...(sync_state==='CONFLICT'?['OFFLINE_SYNC_CONFLICT']:[])
  ]);
  const completion_ready=blockers.length===0;

  return Object.freeze({
    schema:CLEANING_EXECUTION_PACK_SCHEMA, company_id, job_ref, booking_ref:optional(input.booking_ref), site_ref, service_id,
    areas:Object.freeze(areas), equipment:Object.freeze({required:equipment_required,available:equipment_available,missing:equipment_missing}),
    supplies:Object.freeze({required:supply_requirements,available:supplies_available,missing:supplies_missing}), exceptions,
    completion:Object.freeze({
      completed_checklist_item_refs:completedChecklist,evidence_refs:evidenceRefs,completed_at_local:optional(input.completion?.completed_at_local),
      device_ref:optional(input.completion?.device_ref),offline_sequence:nonNegativeInt(input.completion?.offline_sequence,'completion.offline_sequence'),sync_state,
      missing_checklist_item_refs:missingChecklist,evidence_shortage,completion_ready,blockers
    }),
    owners:Object.freeze({job:'shared_jobs_owner',evidence:'shared_evidence_owner',customer_care:'shared_customer_care_owner',offline_sync:'shared_offline_sync_owner'}),
    device_first:true, offline_safe:true, job_mutation_emitted:false, completion_mutation_emitted:false,
    proposal_only:true, grants_authority:false, execution_permitted:false
  });
}
