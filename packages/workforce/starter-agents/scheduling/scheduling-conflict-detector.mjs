const legacyKeys=new Set(['tenant_id','tenant_company_id','tenant','workspace_tenant_id']);
const list=v=>Array.isArray(v)?v:[];
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
const ms=v=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?n:null};
function rejectLegacy(value,path='scheduling'){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach((item,index)=>rejectLegacy(item,`${path}[${index}]`));return;}
 for(const[key,item]of Object.entries(value)){if(legacyKeys.has(key))throw new Error(`legacy-company-boundary:${path}.${key}`);rejectLegacy(item,`${path}.${key}`);}
}
function validWindow(window){const starts=ms(window?.starts_at),ends=ms(window?.ends_at);return starts!==null&&ends!==null&&ends>starts?{starts,ends}:null;}
function overlaps(a,b){return a.starts<b.ends&&b.starts<a.ends;}
function contains(container,target){return container.starts<=target.starts&&container.ends>=target.ends;}
function freezeConflict(conflict){return Object.freeze({...conflict,grants_authority:false,execution_permitted:false,automatic_assignment:false,automatic_reschedule:false,direct_mutation:false});}
function travelLookup(rows,company_id,from,to){
 if(!from||!to||from===to)return {minutes:0,matched:true,source:'SAME_SITE'};
 const row=rows.find(item=>String(item?.company_id??company_id)===company_id&&String(item?.from_site_id??'')===from&&String(item?.to_site_id??'')===to&&Number.isFinite(Number(item?.duration_minutes))&&Number(item.duration_minutes)>=0);
 return row?{minutes:Number(row.duration_minutes),matched:true,source:String(row.source??'SUPPLIED_TRAVEL_EVIDENCE')}:{minutes:null,matched:false,source:null};
}
export function detectSchedulingConflicts(input={},existingAssignments=[],availability=[],travelEvidence=[]){
 rejectLegacy(input);rejectLegacy(existingAssignments,'assignments');rejectLegacy(availability,'availability');rejectLegacy(travelEvidence,'travel-evidence');
 const company_id=text(input.company_id,'company-id');
 const schedule_intent_id=text(input.schedule_intent_id,'schedule-intent-id');
 const work_item_id=text(input.work_item_id,'work-item-id');
 const worker_id=text(input.worker_id,'worker-id');
 const requested=validWindow(input.requested_window);if(!requested)throw new Error('valid-requested-window-required');
 const site_id=input.site_id==null?null:String(input.site_id);
 for(const row of list(existingAssignments)){if(row?.company_id&&String(row.company_id)!==company_id)throw new Error('cross-company-assignment-denied');}
 for(const row of list(availability)){if(row?.company_id&&String(row.company_id)!==company_id)throw new Error('cross-company-availability-denied');}
 for(const row of list(travelEvidence)){if(row?.company_id&&String(row.company_id)!==company_id)throw new Error('cross-company-travel-evidence-denied');}
 const workerAssignments=list(existingAssignments).filter(row=>String(row?.worker_id??'')===worker_id&&String(row?.work_item_id??'')!==work_item_id).map(row=>({row,window:validWindow(row)})).filter(x=>x.window).sort((a,b)=>a.window.starts-b.window.starts||a.window.ends-b.window.ends||String(a.row.assignment_id??'').localeCompare(String(b.row.assignment_id??'')));
 const conflicts=[];
 for(const item of workerAssignments){if(overlaps(requested,item.window)){conflicts.push(freezeConflict({schema:'titan.scheduling.operational-conflict.v1',code:'DOUBLE_BOOKING',worker_id,work_item_id,conflicting_assignment_id:String(item.row.assignment_id??''),conflicting_work_item_id:String(item.row.work_item_id??''),message:'Requested window overlaps an existing worker assignment.'}));}}
 const availabilityRow=list(availability).find(row=>String(row?.worker_id??'')===worker_id);
 const availabilityWindows=list(availabilityRow?.windows).map(validWindow).filter(Boolean);
 const workerAvailable=availabilityWindows.some(window=>contains(window,requested));
 if(!workerAvailable){conflicts.push(freezeConflict({schema:'titan.scheduling.operational-conflict.v1',code:'WORKER_UNAVAILABLE',worker_id,work_item_id,message:'Requested window is not fully covered by explicit worker availability.'}));}
 let travelChecks=0,travelMatches=0;
 if(site_id){
  const previous=[...workerAssignments].filter(x=>x.window.ends<=requested.starts).sort((a,b)=>b.window.ends-a.window.ends)[0]??null;
  const next=[...workerAssignments].filter(x=>x.window.starts>=requested.ends).sort((a,b)=>a.window.starts-b.window.starts)[0]??null;
  if(previous?.row?.site_id){travelChecks++;const evidence=travelLookup(list(travelEvidence),company_id,String(previous.row.site_id),site_id);if(evidence.matched)travelMatches++;if(evidence.matched&&evidence.minutes>0){const gap=(requested.starts-previous.window.ends)/60000;if(gap<evidence.minutes){conflicts.push(freezeConflict({schema:'titan.scheduling.operational-conflict.v1',code:'TRAVEL_OVERLAP',worker_id,work_item_id,direction:'BEFORE_REQUESTED_WINDOW',conflicting_assignment_id:String(previous.row.assignment_id??''),from_site_id:String(previous.row.site_id),to_site_id:site_id,required_travel_minutes:evidence.minutes,available_gap_minutes:gap,travel_source:evidence.source,message:'Insufficient travel time from the previous assignment.'}));}}}
  if(next?.row?.site_id){travelChecks++;const evidence=travelLookup(list(travelEvidence),company_id,site_id,String(next.row.site_id));if(evidence.matched)travelMatches++;if(evidence.matched&&evidence.minutes>0){const gap=(next.window.starts-requested.ends)/60000;if(gap<evidence.minutes){conflicts.push(freezeConflict({schema:'titan.scheduling.operational-conflict.v1',code:'TRAVEL_OVERLAP',worker_id,work_item_id,direction:'AFTER_REQUESTED_WINDOW',conflicting_assignment_id:String(next.row.assignment_id??''),from_site_id:site_id,to_site_id:String(next.row.site_id),required_travel_minutes:evidence.minutes,available_gap_minutes:gap,travel_source:evidence.source,message:'Insufficient travel time to the next assignment.'}));}}}
 }
 const order={DOUBLE_BOOKING:0,WORKER_UNAVAILABLE:1,TRAVEL_OVERLAP:2};
 conflicts.sort((a,b)=>(order[a.code]??99)-(order[b.code]??99)||String(a.conflicting_assignment_id??'').localeCompare(String(b.conflicting_assignment_id??''))||String(a.direction??'').localeCompare(String(b.direction??'')));
 return Object.freeze({schema:'titan.scheduling.operational-conflict-result.v1',company_id,schedule_intent_id,work_item_id,worker_id,requested_window:Object.freeze({starts_at:new Date(requested.starts).toISOString(),ends_at:new Date(requested.ends).toISOString()}),has_conflict:conflicts.length>0,conflicts:Object.freeze(conflicts),travel_evidence_complete:travelChecks===0?false:travelMatches===travelChecks,source_semantics:'EVALUATION_OVER_SUPPLIED_SCHEDULE_AVAILABILITY_AND_TRAVEL_EVIDENCE',requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,automatic_reschedule:false,direct_mutation:false,execution_permitted:false,grants_authority:false});
}
