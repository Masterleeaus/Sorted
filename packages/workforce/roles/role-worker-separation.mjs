const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const uniq=v=>[...new Set(list(v).map(x=>clean(x)).filter(Boolean))].sort();
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));

function assertCompany(company_id){
  const id=clean(company_id,128);
  if(!validCompany(id)) throw new Error('role-worker-separation-company_id-required');
  return id;
}
function assertRoleDefinition(role){
  if(!role || typeof role!=='object') throw new Error('invalid-role-definition');
  const id=clean(role.role_definition_id,220);
  if(!id) throw new Error('role-definition-id-required');
  if(role.company_boundary!=='company_id') throw new Error(`role-company-boundary-invalid:${id}`);
  if(role.activation_confers_authority!==false) throw new Error(`role-authority-invalid:${id}`);
  return id;
}
function workerRoleIds(worker={}){
  return uniq([
    ...list(worker.role_definition_ids),
    ...list(worker.role_ids),
    worker.role_definition_id,
    worker.role_id,
    worker.role,
  ]);
}
function assignmentRoleIds(assignment={}){
  return uniq([
    assignment.role_definition_id,
    assignment.role_id,
    ...list(assignment.role_definition_ids),
  ]);
}

export function buildRoleWorkerSeparationProjection(input={}){
  const company_id=assertCompany(input.company_id);
  const roleDefinitions=list(input.role_definitions);
  const roster=list(input.roster).filter(x=>!x?.company_id||x.company_id===company_id);
  const assignments=list(input.assignments).filter(x=>!x?.company_id||x.company_id===company_id);

  const roleMap=new Map();
  for(const role of roleDefinitions){
    const role_definition_id=assertRoleDefinition(role);
    if(roleMap.has(role_definition_id)) throw new Error(`duplicate-role-definition:${role_definition_id}`);
    roleMap.set(role_definition_id,{
      role_definition_id,
      name:clean(role.name,180)||role_definition_id,
      purpose:clean(role.purpose,600)||null,
      division_key:clean(role.division_key,120)||null,
      operational_domains:uniq(role.operational_domains),
      verticals:uniq(role.verticals),
      risk_ceiling:clean(role.risk_ceiling,80)||null,
      min_business_tier:clean(role.min_business_tier,80)||null,
      definition_source:clean(role.source,160)||null,
      company_boundary:'company_id',
      activation_confers_authority:false,
      worker_ids:[],
      assignment_ids:[],
      grants_authority:false,
    });
  }

  const workerMap=new Map();
  for(const member of roster){
    const worker_id=clean(member.worker_id||member.actor_id||member.agent_id||member.id,220);
    if(!worker_id) continue;
    const role_definition_ids=workerRoleIds(member);
    for(const roleId of role_definition_ids){
      if(!roleMap.has(roleId)) throw new Error(`worker-references-unknown-role:${worker_id}:${roleId}`);
      roleMap.get(roleId).worker_ids.push(worker_id);
    }
    workerMap.set(worker_id,{
      worker_id,
      company_id,
      name:clean(member.name||member.display_name,180)||worker_id,
      actor_type:clean(member.actor_type||member.worker_type||member.type,80)||null,
      status:clean(member.status||member.state,80)||null,
      role_definition_ids,
      provider_bindings:list(member.provider_bindings).map(x=>structuredClone(x)),
      effective_authority_ref:clean(member.effective_authority_ref,220)||null,
      instance_data_only:true,
      role_definition_data_embedded:false,
      may_self_promote:false,
      may_self_hire:false,
      role_assignment_confers_authority:false,
      grants_authority:false,
    });
  }

  const assignmentLinks=[];
  for(const assignment of assignments){
    const assignment_id=clean(assignment.assignment_id||assignment.id||assignment.work_item_id,220);
    if(!assignment_id) continue;
    const worker_id=clean(assignment.worker_id||assignment.assignee_worker_id||assignment.actor_id,220)||null;
    const roleIds=assignmentRoleIds(assignment);
    if(worker_id && !workerMap.has(worker_id)) throw new Error(`assignment-references-unknown-worker:${assignment_id}:${worker_id}`);
    for(const roleId of roleIds){
      if(!roleMap.has(roleId)) throw new Error(`assignment-references-unknown-role:${assignment_id}:${roleId}`);
      roleMap.get(roleId).assignment_ids.push(assignment_id);
      if(worker_id && !workerMap.get(worker_id).role_definition_ids.includes(roleId)){
        throw new Error(`assignment-role-not-held-by-worker:${assignment_id}:${worker_id}:${roleId}`);
      }
    }
    assignmentLinks.push({
      assignment_id,
      company_id,
      worker_id,
      role_definition_ids:roleIds,
      relationship_only:true,
      grants_authority:false,
    });
  }

  const roles=[...roleMap.values()].map(role=>({
    ...role,
    worker_ids:uniq(role.worker_ids),
    assignment_ids:uniq(role.assignment_ids),
    active_worker_count:uniq(role.worker_ids).length,
  })).sort((a,b)=>a.role_definition_id.localeCompare(b.role_definition_id));
  const workers=[...workerMap.values()].sort((a,b)=>a.worker_id.localeCompare(b.worker_id));
  assignmentLinks.sort((a,b)=>a.assignment_id.localeCompare(b.assignment_id));

  const unstaffed_role_definition_ids=roles.filter(r=>r.worker_ids.length===0).map(r=>r.role_definition_id);
  const multi_worker_role_definition_ids=roles.filter(r=>r.worker_ids.length>1).map(r=>r.role_definition_id);
  const multi_role_worker_ids=workers.filter(w=>w.role_definition_ids.length>1).map(w=>w.worker_id);

  return {
    schema:'titan.workforce.role-worker-separation.v1',
    company_id,
    roles,
    workers,
    assignment_links:assignmentLinks,
    counts:{
      role_definitions:roles.length,
      worker_instances:workers.length,
      assignment_links:assignmentLinks.length,
      unstaffed_roles:unstaffed_role_definition_ids.length,
      multi_worker_roles:multi_worker_role_definition_ids.length,
      multi_role_workers:multi_role_worker_ids.length,
    },
    diagnostics:{unstaffed_role_definition_ids,multi_worker_role_definition_ids,multi_role_worker_ids},
    invariants:{
      role_definition_is_not_worker_instance:true,
      role_definition_metadata_immutable_in_projection:true,
      worker_instance_references_roles_by_id:true,
      one_role_may_have_many_workers:true,
      one_worker_may_hold_many_roles:true,
      assignment_links_do_not_mutate_roles_or_workers:true,
      company_boundary:'company_id',
      role_identity_confers_authority:false,
      worker_identity_confers_authority:false,
      role_assignment_confers_authority:false,
    },
    read_only:true,
    derived:true,
    automatic_execution:false,
    grants_authority:false,
  };
}

export function summarizeRoleWorkerSeparation(projection={}){
  if(projection?.schema!=='titan.workforce.role-worker-separation.v1') throw new Error('invalid-role-worker-separation-projection');
  return {
    company_id:projection.company_id,
    ...projection.counts,
    unstaffed_role_definition_ids:[...(projection.diagnostics?.unstaffed_role_definition_ids||[])],
    multi_worker_role_definition_ids:[...(projection.diagnostics?.multi_worker_role_definition_ids||[])],
    multi_role_worker_ids:[...(projection.diagnostics?.multi_role_worker_ids||[])],
    read_only:true,
    grants_authority:false,
  };
}
