export const CLEANING_SERVICE_CATALOGUE_SCHEMA = 'titan.vertical.cleaning.service-catalogue.v1' as const;

export type CleaningPricingHint = 'hourly' | 'fixed' | 'per_room' | 'per_area' | 'quote_required';
export type CleaningRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CleaningServiceVariant {
  id: string;
  label: string;
  family: 'residential' | 'commercial' | 'turnover' | 'specialist' | 'exterior';
  description: string;
  pricing_hints: readonly CleaningPricingHint[];
  default_pricing_hint: CleaningPricingHint;
  duration: Readonly<{ base_minutes: number; min_minutes: number; max_minutes: number; basis: string }>;
  default_crew_size: number;
  inclusions: readonly string[];
  exclusions: readonly string[];
  addons: readonly string[];
  required_evidence: readonly string[];
  skills: readonly string[];
  equipment: readonly string[];
  risk_level: CleaningRiskLevel;
  quote_required: boolean;
  recurring_supported: boolean;
  retained_job_type_id: string | null;
  grants_authority: false;
}

const svc = (input: Omit<CleaningServiceVariant, 'grants_authority'>): CleaningServiceVariant =>
  Object.freeze({ ...input, grants_authority: false as const });

const COMMON_ADDONS = Object.freeze([
  'oven_clean', 'fridge_clean', 'inside_cupboards', 'internal_windows', 'external_windows',
  'wall_spot_clean', 'balcony', 'garage', 'linen_change', 'bed_making'
]);

export const CLEANING_SERVICE_CATALOGUE: readonly CleaningServiceVariant[] = Object.freeze([
  svc({
    id:'regular_clean', label:'Regular clean', family:'residential',
    description:'Routine domestic cleaning for agreed rooms and surfaces, suitable for recurring or one-off visits.',
    pricing_hints:['hourly','fixed'], default_pricing_hint:'hourly',
    duration:{base_minutes:120,min_minutes:60,max_minutes:360,basis:'property size, selected rooms, condition and crew size'},
    default_crew_size:1,
    inclusions:['kitchen surfaces and sink','bathrooms and toilets','reachable dusting','vacuum agreed floors','mop suitable hard floors','general tidy/reset within scope'],
    exclusions:['heavy restoration','mould remediation','high-risk biohazard','external high-access work'],
    addons:COMMON_ADDONS, required_evidence:['completed checklist','exception evidence when issues are found'],
    skills:['general_cleaning'], equipment:['vacuum','mop','microfibre kit','approved general chemicals'], risk_level:'LOW', quote_required:false, recurring_supported:true, retained_job_type_id:'domestic_recurring'
  }),
  svc({
    id:'one_off_clean', label:'One-off clean', family:'residential',
    description:'Single-visit domestic cleaning with a scope selected for the property and customer priorities.',
    pricing_hints:['hourly','fixed','quote_required'], default_pricing_hint:'hourly',
    duration:{base_minutes:180,min_minutes:90,max_minutes:480,basis:'scope breadth, property size and condition'}, default_crew_size:1,
    inclusions:['selected rooms','kitchen and bathroom cleaning','dusting','vacuuming','mopping where suitable'],
    exclusions:['restoration work','specialist stain treatment unless selected','hazardous contamination'],
    addons:COMMON_ADDONS, required_evidence:['completed checklist'], skills:['general_cleaning'], equipment:['vacuum','mop','microfibre kit'], risk_level:'LOW', quote_required:false, recurring_supported:false, retained_job_type_id:'domestic_recurring'
  }),
  svc({
    id:'deep_clean', label:'Deep clean', family:'residential',
    description:'High-detail residential clean for accumulated soil, detail areas and expanded room-level tasks.',
    pricing_hints:['fixed','hourly','quote_required'], default_pricing_hint:'fixed',
    duration:{base_minutes:300,min_minutes:180,max_minutes:720,basis:'property size, soil level, inclusions and crew size'}, default_crew_size:2,
    inclusions:['high-detail kitchen','high-detail bathrooms','edges and skirtings','detail dusting','high-soil areas using approved methods','finishing inspection'],
    exclusions:['mould remediation','pest treatment','structural restoration','unsafe chemical treatment'],
    addons:COMMON_ADDONS, required_evidence:['scope reference','completion checklist','before/after photos for nominated high-soil areas'], skills:['general_cleaning','deep_cleaning'], equipment:['vacuum','mop','detail brushes','approved degreaser/descaler'], risk_level:'MEDIUM', quote_required:false, recurring_supported:true, retained_job_type_id:'deep_clean'
  }),
  svc({
    id:'bond_end_of_lease', label:'End-of-lease / bond clean', family:'turnover',
    description:'Property handover clean with explicit inclusions, exclusions and room-by-room completion evidence.',
    pricing_hints:['fixed','quote_required'], default_pricing_hint:'quote_required',
    duration:{base_minutes:480,min_minutes:240,max_minutes:1200,basis:'property size, condition, furnished state and required extras'}, default_crew_size:2,
    inclusions:['kitchen','bathrooms','inside cupboards where selected','windows/glass where selected','walls/marks where selected','floors','room-by-room final inspection'],
    exclusions:['guaranteed bond outcome','repairs','pest control','hazardous remediation'],
    addons:['oven_clean','carpet_cleaning','internal_windows','external_windows','wall_wash','garage','balcony'], required_evidence:['property checklist','before/after photos','pre-existing condition notes','exclusions'], skills:['bond_cleaning','detail_cleaning'], equipment:['vacuum','mop','detail kit','approved kitchen/bathroom chemicals'], risk_level:'MEDIUM', quote_required:true, recurring_supported:false, retained_job_type_id:'bond_end_of_lease'
  }),
  svc({
    id:'airbnb_turnover', label:'Airbnb / short-stay turnover', family:'turnover',
    description:'Time-windowed short-stay turnover including cleaning, linen/amenity tasks and guest-ready verification.',
    pricing_hints:['fixed','hourly'], default_pricing_hint:'fixed',
    duration:{base_minutes:150,min_minutes:60,max_minutes:360,basis:'property size, linen count, amenity scope and checkout/check-in window'}, default_crew_size:1,
    inclusions:['whole-property turnover clean','bathroom reset','kitchen reset','linen change where configured','amenity restock where configured','damage/missing-item observation','guest-ready inspection'],
    exclusions:['repair authorization','damage liability decisions','purchasing outside configured limits'],
    addons:['linen_laundry','amenity_restock','balcony','bbq_clean','urgent_turnover'], required_evidence:['turnover checklist','guest-ready photos','damage/missing-item evidence when present'], skills:['turnover_cleaning','linen_handling'], equipment:['vacuum','mop','turnover kit'], risk_level:'LOW', quote_required:false, recurring_supported:true, retained_job_type_id:'airbnb_turnover'
  }),
  svc({
    id:'commercial_clean', label:'Commercial clean', family:'commercial',
    description:'Recurring or scheduled commercial-site cleaning driven by zones, frequencies, access windows and site standards.',
    pricing_hints:['fixed','hourly','per_area','quote_required'], default_pricing_hint:'quote_required',
    duration:{base_minutes:240,min_minutes:60,max_minutes:1440,basis:'site area, zones, frequency, occupancy, service window and crew size'}, default_crew_size:2,
    inclusions:['configured site zones','restrooms','waste/recycling in scope','floors/touchpoints in scope','configured consumable replenishment','hazard/exception notes'],
    exclusions:['security services','regulated waste unless explicitly supported','repairs and maintenance work'],
    addons:['consumable_restock','periodic_deep_clean','internal_windows','external_windows','carpet_cleaning','floor_detail'], required_evidence:['site checklist','exception evidence','consumable record when replenished'], skills:['commercial_cleaning'], equipment:['commercial vacuum','mop system','site-approved chemicals'], risk_level:'MEDIUM', quote_required:true, recurring_supported:true, retained_job_type_id:'commercial'
  }),
  svc({
    id:'office_clean', label:'Office clean', family:'commercial',
    description:'Office-focused cleaning for workstations, common areas, kitchens, restrooms, bins and floors.',
    pricing_hints:['fixed','hourly','per_area'], default_pricing_hint:'fixed',
    duration:{base_minutes:180,min_minutes:60,max_minutes:720,basis:'floor area, workstation count, amenities and frequency'}, default_crew_size:1,
    inclusions:['common areas','kitchen/break areas','restrooms','bins/recycling','floors','agreed touchpoints'], exclusions:['IT equipment servicing','secure document handling outside site rules','facility repairs'],
    addons:['consumable_restock','internal_windows','carpet_cleaning','periodic_deep_clean'], required_evidence:['site checklist','issue evidence when present'], skills:['commercial_cleaning'], equipment:['commercial vacuum','mop system'], risk_level:'LOW', quote_required:false, recurring_supported:true, retained_job_type_id:'office'
  }),
  svc({
    id:'move_in_out_clean', label:'Move-in / move-out clean', family:'turnover',
    description:'Readiness cleaning for empty or partly occupied properties before or after relocation.',
    pricing_hints:['fixed','quote_required'], default_pricing_hint:'fixed',
    duration:{base_minutes:300,min_minutes:180,max_minutes:900,basis:'property size, occupancy state and selected detail items'}, default_crew_size:2,
    inclusions:['kitchen','storage interiors where selected','bathrooms','detail surfaces','floors','readiness inspection'], exclusions:['bond guarantee','removalist work','repairs'], addons:['oven_clean','internal_windows','carpet_cleaning','wall_wash','garage'], required_evidence:['completion checklist','readiness photos where requested'], skills:['detail_cleaning'], equipment:['vacuum','mop','detail kit'], risk_level:'LOW', quote_required:false, recurring_supported:false, retained_job_type_id:'move_in'
  }),
  svc({
    id:'carpet_cleaning', label:'Carpet cleaning', family:'specialist',
    description:'Carpet cleaning scoped by material, area, soil/stain condition and safe method constraints.',
    pricing_hints:['per_area','fixed','quote_required'], default_pricing_hint:'per_area',
    duration:{base_minutes:120,min_minutes:60,max_minutes:480,basis:'area, fibre/material, soil/stain level, access and drying constraints'}, default_crew_size:1,
    inclusions:['material/condition assessment','vacuum/preparation','configured carpet cleaning method','post-clean condition notes'], exclusions:['guaranteed stain removal','restoration of damaged fibres','unverified chemical treatment'], addons:['stain_treatment','deodorising','stairs','rug_cleaning'], required_evidence:['material/condition notes','method record','before/after evidence for exceptions'], skills:['carpet_cleaning'], equipment:['carpet extraction or approved carpet equipment'], risk_level:'MEDIUM', quote_required:false, recurring_supported:true, retained_job_type_id:null
  }),
  svc({
    id:'upholstery_cleaning', label:'Upholstery cleaning', family:'specialist',
    description:'Upholstery cleaning scoped by fabric/material, construction, condition and safe method constraints.',
    pricing_hints:['fixed','quote_required'], default_pricing_hint:'quote_required',
    duration:{base_minutes:90,min_minutes:45,max_minutes:360,basis:'item count, fabric, condition and method'}, default_crew_size:1,
    inclusions:['fabric/condition assessment','approved-method clean','drying guidance','condition notes'], exclusions:['guaranteed stain removal','colour restoration','unknown-fabric chemical treatment'], addons:['stain_treatment','deodorising','protective_treatment_when_approved'], required_evidence:['material/condition notes','method record'], skills:['upholstery_cleaning'], equipment:['upholstery extraction or approved equipment'], risk_level:'MEDIUM', quote_required:true, recurring_supported:false, retained_job_type_id:null
  }),
  svc({
    id:'window_cleaning', label:'Window cleaning', family:'specialist',
    description:'Internal/external glass cleaning where access and height are within configured safe operating limits.',
    pricing_hints:['fixed','per_area','quote_required'], default_pricing_hint:'fixed',
    duration:{base_minutes:120,min_minutes:60,max_minutes:600,basis:'pane count, access, height and internal/external scope'}, default_crew_size:1,
    inclusions:['agreed glass surfaces','frames/sills where selected','accessible tracks where selected'], exclusions:['unsafe high-access work','rope access unless separately qualified/configured','glass repair'], addons:['tracks_detail','screens','hard_water_treatment'], required_evidence:['scope/access notes','exception evidence for inaccessible panes'], skills:['window_cleaning'], equipment:['squeegee kit','extension equipment within safe limits'], risk_level:'MEDIUM', quote_required:false, recurring_supported:true, retained_job_type_id:null
  }),
  svc({
    id:'pressure_cleaning', label:'Pressure cleaning', family:'exterior',
    description:'Exterior pressure cleaning scoped by surface, area, drainage, access and safe treatment constraints.',
    pricing_hints:['per_area','fixed','quote_required'], default_pricing_hint:'quote_required',
    duration:{base_minutes:180,min_minutes:90,max_minutes:720,basis:'area, surface type, soil level, access, drainage and setup'}, default_crew_size:1,
    inclusions:['surface/condition assessment','configured pressure clean','runoff/area protection steps where configured','post-work condition notes'], exclusions:['roof work unless separately qualified/configured','hazardous contamination','surface restoration','chemical treatment not explicitly approved'], addons:['pre_treatment_when_approved','driveway','patio','fence','external_walls'], required_evidence:['surface/condition notes','before/after photos','exceptions'], skills:['pressure_cleaning'], equipment:['pressure cleaner','surface-appropriate attachments','PPE'], risk_level:'HIGH', quote_required:true, recurring_supported:true, retained_job_type_id:null
  }),
  svc({
    id:'post_construction_clean', label:'Post-construction clean', family:'specialist',
    description:'Detailed post-build or post-renovation cleaning after trade work is complete and the area is safe for cleaners.',
    pricing_hints:['fixed','hourly','quote_required'], default_pricing_hint:'quote_required',
    duration:{base_minutes:480,min_minutes:240,max_minutes:1440,basis:'area, dust/debris level, surfaces, access and stage of completion'}, default_crew_size:2,
    inclusions:['fine dust removal within scope','surfaces','fixtures','floors','detail inspection'], exclusions:['construction waste removal unless selected','trade defect rectification','hazardous silica/asbestos remediation'], addons:['internal_windows','external_windows','waste_removal_when_supported'], required_evidence:['scope','site readiness confirmation','completion evidence'], skills:['post_construction_cleaning'], equipment:['HEPA-capable vacuum where required','detail kit','PPE'], risk_level:'HIGH', quote_required:true, recurring_supported:false, retained_job_type_id:null
  }),
  svc({
    id:'custom_cleaning_service', label:'Custom cleaning service', family:'specialist',
    description:'Explicitly scoped cleaning service for requirements not represented by a standard catalogue variant.',
    pricing_hints:['quote_required'], default_pricing_hint:'quote_required',
    duration:{base_minutes:120,min_minutes:30,max_minutes:1440,basis:'approved custom scope'}, default_crew_size:1,
    inclusions:['only explicitly approved custom scope'], exclusions:['anything not explicitly included','regulated or hazardous work without configured capability'], addons:[], required_evidence:['approved custom scope','completion evidence defined by scope'], skills:['scope_specific'], equipment:['scope_specific'], risk_level:'MEDIUM', quote_required:true, recurring_supported:false, retained_job_type_id:null
  })
]);

export const CLEANING_SERVICE_BY_ID = Object.freeze(Object.fromEntries(CLEANING_SERVICE_CATALOGUE.map(service => [service.id, service])) as Record<string, CleaningServiceVariant>);

const LEGACY_COMPANY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacyBoundary(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((item, index) => rejectLegacyBoundary(item, `${path}[${index}]`)); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_COMPANY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacyBoundary(child, `${path}.${key}`);
  }
}

export function getCleaningServiceCatalogue(input: { company_id: string; include_ids?: readonly string[] } ) {
  rejectLegacyBoundary(input);
  const company_id = String(input?.company_id || '').trim();
  if (!company_id) throw new Error('company_id is required');
  const include = input.include_ids?.length ? new Set(input.include_ids.map(String)) : null;
  const services = include ? CLEANING_SERVICE_CATALOGUE.filter(service => include.has(service.id)) : CLEANING_SERVICE_CATALOGUE;
  if (include && services.length !== include.size) {
    const known = new Set(services.map(service => service.id));
    const missing = [...include].filter(id => !known.has(id));
    throw new Error(`unknown cleaning service ids: ${missing.sort().join(', ')}`);
  }
  return Object.freeze({
    schema: CLEANING_SERVICE_CATALOGUE_SCHEMA,
    company_id,
    services: Object.freeze([...services]),
    catalogue_is_projection: true,
    pricing_owner_unchanged: true,
    booking_owner_unchanged: true,
    scheduling_owner_unchanged: true,
    jobs_owner_unchanged: true,
    grants_authority: false,
    execution_permitted: false
  });
}
