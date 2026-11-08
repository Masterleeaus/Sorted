const list=v=>Array.isArray(v)?v:[];
const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const uniq=v=>[...new Set(list(v).map(x=>clean(x)).filter(Boolean))].sort();
const diff=(before=[],after=[])=>({added:uniq(after).filter(x=>!new Set(uniq(before)).has(x)),removed:uniq(before).filter(x=>!new Set(uniq(after)).has(x))});
function assertProjection(p,label){
  if(p?.schema!=='titan.workforce.role-worker-staffing-projection.v1') throw new Error(`invalid-${label}-role-worker-staffing-projection`);
  if(!clean(p.company_id,128)) throw new Error(`${label}-company_id-required`);
  return p;
}
function mapBy(rows,key){return new Map(list(rows).map(row=>[clean(row?.[key]),row]).filter(([id])=>id));}

export function buildRoleWorkerChangeSet(before={},after={}){
  const a=assertProjection(before,'before'),b=assertProjection(after,'after');
  if(a.company_id!==b.company_id) throw new Error('role-worker-change-set-company-mismatch');
  const beforeRoles=mapBy(a.roles,'role_definition_id'),afterRoles=mapBy(b.roles,'role_definition_id');
  const beforeWorkers=mapBy(a.workers,'worker_id'),afterWorkers=mapBy(b.workers,'worker_id');
  const roleIds=uniq([...beforeRoles.keys(),...afterRoles.keys()]);
  const workerIds=uniq([...beforeWorkers.keys(),...afterWorkers.keys()]);
  const role_changes=[];
  for(const id of roleIds){
    const x=beforeRoles.get(id),y=afterRoles.get(id);
    if(!x&&y){role_changes.push({role_definition_id:id,change_type:'role-added',before:null,after:{staffing_state:y.staffing_state,staffed_worker_ids:uniq(y.staffed_worker_ids),assignment_ids:uniq(y.assignment_ids)},grants_authority:false});continue;}
    if(x&&!y){role_changes.push({role_definition_id:id,change_type:'role-removed',before:{staffing_state:x.staffing_state,staffed_worker_ids:uniq(x.staffed_worker_ids),assignment_ids:uniq(x.assignment_ids)},after:null,grants_authority:false});continue;}
    const workers=diff(x.staffed_worker_ids,y.staffed_worker_ids),assignments=diff(x.assignment_ids,y.assignment_ids);
    const integrity_changed=x.integrity_status!==y.integrity_status||JSON.stringify(uniq(x.integrity_issue_codes))!==JSON.stringify(uniq(y.integrity_issue_codes));
    const staffing_changed=x.staffing_state!==y.staffing_state||workers.added.length||workers.removed.length;
    if(staffing_changed||assignments.added.length||assignments.removed.length||integrity_changed){
      role_changes.push({role_definition_id:id,change_type:'role-state-changed',staffing_state:{before:x.staffing_state,after:y.staffing_state},worker_delta:workers,assignment_delta:assignments,integrity:{before:x.integrity_status,after:y.integrity_status,issue_codes_before:uniq(x.integrity_issue_codes),issue_codes_after:uniq(y.integrity_issue_codes)},grants_authority:false});
    }
  }
  const worker_changes=[];
  for(const id of workerIds){
    const x=beforeWorkers.get(id),y=afterWorkers.get(id);
    if(!x&&y){worker_changes.push({worker_id:id,change_type:'worker-added',before:null,after:{role_definition_ids:uniq(y.role_definition_ids),assignment_ids:uniq(y.assignment_ids),status:y.status||null},grants_authority:false});continue;}
    if(x&&!y){worker_changes.push({worker_id:id,change_type:'worker-removed',before:{role_definition_ids:uniq(x.role_definition_ids),assignment_ids:uniq(x.assignment_ids),status:x.status||null},after:null,grants_authority:false});continue;}
    const roles=diff(x.role_definition_ids,y.role_definition_ids),assignments=diff(x.assignment_ids,y.assignment_ids);
    const status_changed=(x.status||null)!==(y.status||null),integrity_changed=x.integrity_status!==y.integrity_status||JSON.stringify(uniq(x.integrity_issue_codes))!==JSON.stringify(uniq(y.integrity_issue_codes));
    if(roles.added.length||roles.removed.length||assignments.added.length||assignments.removed.length||status_changed||integrity_changed){
      worker_changes.push({worker_id:id,change_type:'worker-state-changed',role_delta:roles,assignment_delta:assignments,status:{before:x.status||null,after:y.status||null},integrity:{before:x.integrity_status,after:y.integrity_status,issue_codes_before:uniq(x.integrity_issue_codes),issue_codes_after:uniq(y.integrity_issue_codes)},grants_authority:false});
    }
  }
  const beforeCritical=new Set(list(a.roles).filter(r=>r.critical&&r.staffed_worker_count===0).map(r=>r.role_definition_id));
  const afterCritical=new Set(list(b.roles).filter(r=>r.critical&&r.staffed_worker_count===0).map(r=>r.role_definition_id));
  const critical_unstaffed_delta={added:[...afterCritical].filter(x=>!beforeCritical.has(x)).sort(),resolved:[...beforeCritical].filter(x=>!afterCritical.has(x)).sort()};
  return {
    schema:'titan.workforce.role-worker-change-set.v1',company_id:a.company_id,role_changes,worker_changes,critical_unstaffed_delta,
    summary:{role_changes:role_changes.length,worker_changes:worker_changes.length,new_critical_unstaffed_roles:critical_unstaffed_delta.added.length,resolved_critical_unstaffed_roles:critical_unstaffed_delta.resolved.length,changed:role_changes.length>0||worker_changes.length>0||critical_unstaffed_delta.added.length>0||critical_unstaffed_delta.resolved.length>0},
    source_schema:a.schema,read_only:true,derived:true,applies_mutations:false,creates_assignments:false,automatic_execution:false,grants_authority:false
  };
}

export function summarizeRoleWorkerChangeSet(changeSet={}){
  if(changeSet?.schema!=='titan.workforce.role-worker-change-set.v1') throw new Error('invalid-role-worker-change-set');
  return {company_id:changeSet.company_id,...changeSet.summary,critical_unstaffed_delta:structuredClone(changeSet.critical_unstaffed_delta),read_only:true,grants_authority:false};
}
