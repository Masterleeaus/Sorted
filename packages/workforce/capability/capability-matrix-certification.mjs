const list=v=>Array.isArray(v)?v:[];
const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const uniq=v=>[...new Set(list(v).map(x=>clean(x)).filter(Boolean))].sort();

function issue(code,severity,detail={}){return {code,severity,...detail};}
function assertMatrix(matrix){
  if(matrix?.schema!=='titan.workforce.capability-matrix.v1')throw new Error('capability-matrix-certification-matrix-required');
  if(!clean(matrix.company_id,128))throw new Error('capability-matrix-certification-company_id-required');
  return matrix;
}

export function certifyCapabilityMatrix(matrix={},options={}){
  const m=assertMatrix(matrix),findings=[];
  if(m.read_only!==true) findings.push(issue('matrix_not_read_only','critical'));
  if(m.routing_decision!==false) findings.push(issue('routing_decision_leak','critical'));
  if(m.entitlement_decision!==false) findings.push(issue('entitlement_decision_leak','critical'));
  if(m.assignment_decision!==false) findings.push(issue('assignment_decision_leak','critical'));
  if(m.execution_permitted!==false||m.automatic_execution!==false) findings.push(issue('execution_leak','critical'));
  if(m.grants_authority!==false||m.capability_presence_confers_authority!==false||m.verification_confers_authority!==false) findings.push(issue('authority_leak','critical'));

  const capabilityIds=uniq(m.capability_ids);
  const capabilitySet=new Set(capabilityIds);
  const workerIds=new Set();
  for(const [wi,w] of list(m.workers).entries()){
    const worker_id=clean(w?.worker_id,128);
    if(!worker_id){findings.push(issue('worker_id_missing','high',{worker_index:wi}));continue;}
    if(workerIds.has(worker_id))findings.push(issue('duplicate_worker','high',{worker_id}));
    workerIds.add(worker_id);
    if(w?.grants_authority!==false||w?.worker_identity_confers_authority!==false)findings.push(issue('worker_authority_leak','critical',{worker_id}));
    const cells=list(w?.capabilities),seen=new Set();
    for(const cell of cells){
      const capability_id=clean(cell?.capability_id,128);
      if(!capability_id||!capabilitySet.has(capability_id))findings.push(issue('worker_unknown_capability','high',{worker_id,capability_id}));
      if(seen.has(capability_id))findings.push(issue('duplicate_worker_capability_cell','high',{worker_id,capability_id}));
      seen.add(capability_id);
      if(cell?.grants_authority!==false)findings.push(issue('capability_cell_authority_leak','critical',{worker_id,capability_id}));
      if(cell?.evidence_count<0||cell?.proficiency<0) findings.push(issue('invalid_capability_measure','high',{worker_id,capability_id}));
    }
  }

  const roleIds=new Set();
  for(const [ri,role] of list(m.roles).entries()){
    const role_definition_id=clean(role?.role_definition_id,128);
    if(!role_definition_id){findings.push(issue('role_definition_id_missing','high',{role_index:ri}));continue;}
    if(roleIds.has(role_definition_id))findings.push(issue('duplicate_role','high',{role_definition_id}));
    roleIds.add(role_definition_id);
    if(role?.grants_authority!==false||role?.role_identity_confers_authority!==false)findings.push(issue('role_authority_leak','critical',{role_definition_id}));
    for(const capability of list(role?.capabilities)){
      const capability_id=clean(capability?.capability_id,128);
      if(!capabilitySet.has(capability_id))findings.push(issue('role_unknown_capability','high',{role_definition_id,capability_id}));
      if(capability?.grants_authority!==false)findings.push(issue('role_capability_authority_leak','critical',{role_definition_id,capability_id}));
      for(const worker_id of list(capability?.holder_worker_ids))if(!workerIds.has(clean(worker_id,128)))findings.push(issue('role_unknown_holder','high',{role_definition_id,capability_id,worker_id:clean(worker_id,128)}));
    }
  }

  const registryGaps=uniq(m?.diagnostics?.registry_requirement_gap_capability_ids);
  const unstaffedRoles=uniq(m?.diagnostics?.roles_without_workers);
  for(const capability_id of registryGaps)findings.push(issue('registry_requirement_gap','warning',{capability_id}));
  for(const role_definition_id of unstaffedRoles)findings.push(issue('role_unstaffed','warning',{role_definition_id}));
  const roleCapabilityGaps=list(m.roles).flatMap(role=>list(role?.capabilities).filter(c=>c?.coverage_state==='gap').map(c=>({role_definition_id:clean(role.role_definition_id,128),capability_id:clean(c.capability_id,128)})));
  for(const gap of roleCapabilityGaps)findings.push(issue('role_capability_gap','warning',gap));

  const blocking=findings.filter(x=>x.severity==='critical'||x.severity==='high');
  const warnings=findings.filter(x=>x.severity==='warning');
  const requireNoCoverageGaps=options.require_no_coverage_gaps===true;
  const coverageReady=registryGaps.length===0&&unstaffedRoles.length===0&&roleCapabilityGaps.length===0;
  const dataModelReady=blocking.length===0&&(!requireNoCoverageGaps||coverageReady);
  return {
    schema:'titan.workforce.capability-matrix-certification.v1',company_id:m.company_id,
    data_model_ready:dataModelReady,coverage_ready:coverageReady,blocking_findings:blocking,warnings,
    summary:{capability_count:capabilityIds.length,worker_count:workerIds.size,role_count:roleIds.size,blocking_count:blocking.length,warning_count:warnings.length,registry_requirement_gaps:registryGaps.length,unstaffed_roles:unstaffedRoles.length,role_capability_gaps:roleCapabilityGaps.length},
    invariants:{company_boundary:'company_id only',read_only:true,routing_decision:false,entitlement_decision:false,assignment_decision:false,capability_presence_confers_authority:false,verification_confers_authority:false,automatic_execution:false,execution_permitted:false,grants_authority:false},
    visible_ui_integration_pending:true,capability_router_integration_pending:true,read_only:true,automatic_execution:false,execution_permitted:false,grants_authority:false
  };
}

export function assertCapabilityMatrixCertified(matrix={},options={}){
  const certification=certifyCapabilityMatrix(matrix,options);
  if(!certification.data_model_ready)throw new Error(`capability-matrix-not-certified:${certification.blocking_findings.map(x=>x.code).join(',')||'coverage-gaps'}`);
  return certification;
}
