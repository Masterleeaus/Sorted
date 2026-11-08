import { CLEANING_SERVICE_BY_ID } from './catalogue.js';

export const CLEANING_SCHEDULING_SCHEMA = 'titan.vertical.cleaning.booking-scheduling.v1' as const;

export type CleaningCadence = 'one_off'|'weekly'|'fortnightly'|'monthly'|'custom';

export interface CleaningSiteScheduleInput {
  site_ref: string;
  service_id: string;
  requested_date?: string;
  arrival_window?: { start: string; end: string };
  estimated_minutes?: number;
  crew_size?: number;
  travel_buffer_before_minutes?: number;
  travel_buffer_after_minutes?: number;
  access?: {
    instructions_ref?: string;
    key_access_ref?: string;
    alarm_ref?: string;
    pet_notes?: string;
    parking_notes?: string;
  };
}

export interface CleaningBookingSchedulingInput {
  company_id: string;
  booking_ref: string;
  customer_ref: string;
  cadence?: CleaningCadence;
  cadence_source_ref?: string;
  sites: readonly CleaningSiteScheduleInput[];
  reschedule?: {
    requested?: boolean;
    reason_ref?: string;
    preserve_team_preference?: boolean;
    minimum_notice_minutes?: number;
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
function optionalClean(value: unknown): string|null { const v=String(value??'').trim(); return v || null; }
function nonNegativeInt(value: unknown, label:string, fallback=0): number { if(value==null) return fallback; const n=Number(value); if(!Number.isInteger(n)||n<0) throw new Error(`${label} must be a non-negative integer`); return n; }
function positiveInt(value: unknown, label:string, fallback:number): number { if(value==null) return fallback; const n=Number(value); if(!Number.isInteger(n)||n<1) throw new Error(`${label} must be a positive integer`); return n; }
function hhmm(value: unknown, label:string): string { const v=String(value??'').trim(); if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`${label} must be HH:MM`); return v; }
function isoDate(value: unknown, label:string): string|null { if(value==null||value==='') return null; const v=String(value).trim(); if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} must be YYYY-MM-DD`); return v; }

export function buildCleaningBookingSchedulingProjection(input: CleaningBookingSchedulingInput) {
  rejectLegacy(input);
  const company_id=clean(input.company_id,'company_id');
  const booking_ref=clean(input.booking_ref,'booking_ref');
  const customer_ref=clean(input.customer_ref,'customer_ref');
  const cadence=input.cadence ?? 'one_off';
  if(!['one_off','weekly','fortnightly','monthly','custom'].includes(cadence)) throw new Error(`unsupported cleaning cadence: ${cadence}`);
  if(cadence!=='one_off' && !optionalClean(input.cadence_source_ref)) throw new Error('cadence_source_ref is required for recurring cleaning');
  const sites=(input.sites||[]).map((raw,index)=>{
    const site_ref=clean(raw.site_ref,`sites[${index}].site_ref`);
    const service_id=clean(raw.service_id,`sites[${index}].service_id`);
    const service=CLEANING_SERVICE_BY_ID[service_id]; if(!service) throw new Error(`unknown cleaning service id: ${service_id}`);
    if(cadence!=='one_off' && !service.recurring_supported) throw new Error(`${service_id} does not support recurring service`);
    const requested_date=isoDate(raw.requested_date,`sites[${index}].requested_date`);
    let arrival_window:null|Readonly<{start:string;end:string}>=null;
    if(raw.arrival_window){ const start=hhmm(raw.arrival_window.start,`sites[${index}].arrival_window.start`); const end=hhmm(raw.arrival_window.end,`sites[${index}].arrival_window.end`); if(start>=end) throw new Error(`sites[${index}] arrival window end must be after start`); arrival_window=Object.freeze({start,end}); }
    const estimated_minutes=positiveInt(raw.estimated_minutes,`sites[${index}].estimated_minutes`,service.duration.base_minutes);
    const crew_size=positiveInt(raw.crew_size,`sites[${index}].crew_size`,service.default_crew_size);
    const travel_buffer_before_minutes=nonNegativeInt(raw.travel_buffer_before_minutes,`sites[${index}].travel_buffer_before_minutes`);
    const travel_buffer_after_minutes=nonNegativeInt(raw.travel_buffer_after_minutes,`sites[${index}].travel_buffer_after_minutes`);
    const access=Object.freeze({
      instructions_ref:optionalClean(raw.access?.instructions_ref),
      key_access_ref:optionalClean(raw.access?.key_access_ref),
      alarm_ref:optionalClean(raw.access?.alarm_ref),
      pet_notes:optionalClean(raw.access?.pet_notes),
      parking_notes:optionalClean(raw.access?.parking_notes)
    });
    return Object.freeze({site_ref,service_id,requested_date,arrival_window,estimated_minutes,crew_size,travel_buffer_before_minutes,travel_buffer_after_minutes,access,
      assignment_requirements:Object.freeze({service_id,duration_minutes:estimated_minutes,crew_size,source_ref:`${booking_ref}:${site_ref}:${service_id}`}),
      retained_assignment_requirement_owner:'titan.workforce.cleaning-assignment-requirement-suggestions.v1' as const});
  });
  if(!sites.length) throw new Error('at least one cleaning site is required');
  if(new Set(sites.map(x=>x.site_ref)).size!==sites.length) throw new Error('duplicate cleaning site_ref');

  const rescheduleRequested=input.reschedule?.requested===true;
  const reschedule=Object.freeze({
    requested:rescheduleRequested,
    reason_ref:optionalClean(input.reschedule?.reason_ref),
    preserve_team_preference:input.reschedule?.preserve_team_preference!==false,
    minimum_notice_minutes:nonNegativeInt(input.reschedule?.minimum_notice_minutes,'reschedule.minimum_notice_minutes',0),
    requires_shared_booking_policy_review:rescheduleRequested
  });
  if(rescheduleRequested && !reschedule.reason_ref) throw new Error('reschedule.reason_ref is required when reschedule is requested');

  return Object.freeze({
    schema:CLEANING_SCHEDULING_SCHEMA, company_id, booking_ref, customer_ref, cadence,
    cadence_source_ref:optionalClean(input.cadence_source_ref), sites:Object.freeze(sites), reschedule,
    multi_site:sites.length>1,
    owners:Object.freeze({booking:'shared_booking_owner', scheduling:'shared_scheduling_owner', assignment:'shared_workforce_assignment_owner', recurring:'shared_recurring_work_owner'}),
    booking_mutation_emitted:false, schedule_mutation_emitted:false, automatic_assignment:false, automatic_reassignment:false,
    proposal_only:true, requires_fresh_assignment_authority:true, grants_authority:false, execution_permitted:false
  });
}
