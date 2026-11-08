const LEGACY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId','workspace_tenant_id']);
const list=v=>Array.isArray(v)?v:[];
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
const ms=v=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?n:null};
function rejectLegacy(value,path='cleaning-scheduling'){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));return;}
 for(const[k,v]of Object.entries(value)){if(LEGACY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(v,`${path}.${k}`);}
}
function assertCompany(record,company_id,label){if(!record||typeof record!=='object'||String(record.company_id??'')!==company_id)throw new Error(`cross-company-${label}-denied`);}
function normalizeCapabilities(value){return list(value).map(v=>typeof v==='string'?{capability_id:v,min_proficiency:0,require_verified:false}:{capability_id:v?.capability_id??v?.id??v?.name,min_proficiency:Number(v?.min_proficiency??v?.proficiency??v?.level??0)||0,require_verified:v?.require_verified===true}).map(v=>({...v,capability_id:String(v.capability_id??'').trim()})).filter(v=>v.capability_id).sort((a,b)=>a.capability_id.localeCompare(b.capability_id));}
function workerSatisfies(worker_id,requirements,registry){
 const rows=list(registry?.worker_capabilities).filter(r=>String(r?.worker_id??'')===worker_id);
 return requirements.every(req=>rows.some(r=>String(r?.capability_id??'')===req.capability_id&&Number(r?.proficiency??0)>=req.min_proficiency&&(!req.require_verified||String(r?.verification_state??'')==='VERIFIED')));
}
function validWindow(value){const starts=ms(value?.starts_at),ends=ms(value?.ends_at);return starts!==null&&ends!==null&&ends>starts?{starts,ends}:null;}
function covers(window,target){return window&&target&&window.starts<=target.starts&&window.ends>=target.ends;}
function equipmentAvailable(row,requested){const state=String(row?.state??row?.status??'').trim().toUpperCase();if(!['AVAILABLE','READY','IDLE'].includes(state))return false;const window=validWindow(row?.available_window);return window?covers(window,requested):true;}

/**
 * Builds a recommendation from explicit cleaning-service requirements plus existing Workforce
 * capacity/capability truth and supplied equipment evidence. It never reserves, assigns, purchases,
 * mutates inventory, or grants authority.
 */
export function buildCleaningSchedulingRecommendation(input={},matchResult={},capacitySnapshot={},skillRegistry={},equipmentEvidence=[]){
 rejectLegacy(input);rejectLegacy(matchResult,'match-result');rejectLegacy(capacitySnapshot,'capacity');rejectLegacy(skillRegistry,'skills');rejectLegacy(equipmentEvidence,'equipment');
 const company_id=text(input.company_id,'company-id');
 assertCompany(matchResult,company_id,'match-result');assertCompany(capacitySnapshot,company_id,'capacity');assertCompany(skillRegistry,company_id,'capability-registry');
 if(matchResult.schema!=='titan.scheduling.match-result.v1')throw new Error('scheduling-match-result-required');
 if(capacitySnapshot.schema!=='titan.workforce.workload-capacity.v1')throw new Error('workload-capacity-snapshot-required');
 if(skillRegistry.schema!=='titan.workforce.skill-capability-registry.v1')throw new Error('skill-capability-registry-required');
 if(String(matchResult.schedule_intent_id??'')!==text(input.schedule_intent_id,'schedule-intent-id')||String(matchResult.work_item_id??'')!==text(input.work_item_id,'work-item-id'))throw new Error('scheduling-context-mismatch');
 for(const row of list(equipmentEvidence)){if(row?.company_id&&String(row.company_id)!==company_id)throw new Error('cross-company-equipment-denied');}
 const duration_minutes=Math.max(1,Math.floor(Number(input.duration_minutes??0)||0));
 const crew_size=Math.max(1,Math.floor(Number(input.crew_size??1)||1));
 const requested=validWindow(matchResult.requested_window??input.requested_window);if(!requested)throw new Error('valid-requested-window-required');
 const required_capabilities=normalizeCapabilities(input.required_capabilities);
 const capacityBy=new Map(list(capacitySnapshot.worker_capacity).map(r=>[String(r?.worker_id??''),r]));
 const candidates=list(matchResult.eligible_workers).map(r=>({worker_id:String(r?.worker_id??''),match:r,capacity:capacityBy.get(String(r?.worker_id??''))})).filter(r=>r.worker_id&&r.capacity&&String(r.capacity.state??'')!=='OVERLOADED'&&workerSatisfies(r.worker_id,required_capabilities,skillRegistry)).sort((a,b)=>Number(a.match.utilization??a.capacity.utilization??0)-Number(b.match.utilization??b.capacity.utilization??0)||Number(b.match.available_units??b.capacity.available_units??0)-Number(a.match.available_units??a.capacity.available_units??0)||a.worker_id.localeCompare(b.worker_id));
 const recommended_worker_ids=Object.freeze(candidates.slice(0,crew_size).map(r=>r.worker_id));
 const equipment_requirements=list(input.equipment_requirements).map(r=>({equipment_type:text(r?.equipment_type,'equipment-type'),quantity:Math.max(1,Math.floor(Number(r?.quantity??1)||1))})).sort((a,b)=>a.equipment_type.localeCompare(b.equipment_type));
 const reserved_equipment=[];const unmet_requirements=[];
 const used=new Set();
 for(const req of equipment_requirements){
  const matches=list(equipmentEvidence).filter(row=>!used.has(String(row?.equipment_id??''))&&String(row?.equipment_type??row?.type??'')===req.equipment_type&&equipmentAvailable(row,requested)).sort((a,b)=>String(a?.equipment_id??'').localeCompare(String(b?.equipment_id??'')));
  for(const row of matches.slice(0,req.quantity)){const equipment_id=text(row?.equipment_id,'equipment-id');used.add(equipment_id);reserved_equipment.push(Object.freeze({equipment_id,equipment_type:req.equipment_type,source:'SUPPLIED_EQUIPMENT_EVIDENCE',reservation_performed:false,grants_authority:false}));}
  if(matches.length<req.quantity)unmet_requirements.push(Object.freeze({code:'EQUIPMENT_SHORTFALL',equipment_type:req.equipment_type,required_quantity:req.quantity,available_quantity:matches.length}));
 }
 if(recommended_worker_ids.length<crew_size)unmet_requirements.push(Object.freeze({code:'CREW_SIZE_SHORTFALL',required_crew_size:crew_size,eligible_worker_count:recommended_worker_ids.length}));
 const requestedMinutes=(requested.ends-requested.starts)/60000;
 if(requestedMinutes<duration_minutes)unmet_requirements.push(Object.freeze({code:'DURATION_WINDOW_TOO_SHORT',duration_minutes,requested_window_minutes:requestedMinutes}));
 reserved_equipment.sort((a,b)=>a.equipment_type.localeCompare(b.equipment_type)||a.equipment_id.localeCompare(b.equipment_id));
 unmet_requirements.sort((a,b)=>a.code.localeCompare(b.code)||String(a.equipment_type??'').localeCompare(String(b.equipment_type??'')));
 return Object.freeze({
  schema:'titan.scheduling.cleaning-recommendation.v1',company_id,schedule_intent_id:String(matchResult.schedule_intent_id),work_item_id:String(matchResult.work_item_id),service_type:String(input.service_type??'cleaning').trim()||'cleaning',duration_minutes,crew_size,required_capabilities:Object.freeze(required_capabilities),recommended_worker_ids,reserved_equipment:Object.freeze(reserved_equipment),equipment_requirements:Object.freeze(equipment_requirements),unmet_requirements:Object.freeze(unmet_requirements),status:unmet_requirements.length?'REQUIREMENTS_UNMET':'READY_FOR_GOVERNED_ASSIGNMENT',requirements_source:'EXPLICIT_CLEANING_SERVICE_REQUIREMENTS',capacity_source:'TITAN_WORKFORCE_WORKLOAD_CAPACITY',capability_source:'TITAN_WORKFORCE_SKILL_CAPABILITY_REGISTRY',equipment_source:'SUPPLIED_EQUIPMENT_EVIDENCE_ONLY',synthetic_equipment_truth:false,reservation_performed:false,requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,automatic_reschedule:false,automatic_purchase:false,direct_mutation:false,execution_permitted:false,grants_authority:false
 });
}
