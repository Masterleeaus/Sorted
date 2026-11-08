const list=v=>Array.isArray(v)?v:[];
const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const uniq=v=>[...new Set(list(v).map(x=>clean(x)).filter(Boolean))].sort();

function assertProjection(projection){
  if(projection?.schema!=='titan.workforce.role-worker-separation.v1') throw new Error('invalid-role-worker-separation-projection');
  if(!clean(projection.company_id,128)) throw new Error('role-worker-integrity-company_id-required');
  return projection;
}

export function validateRoleWorkerIntegrity(projection={},input={}){
  const p=assertProjection(projection);
  const criticalRoleIds=new Set(uniq(input.critical_role_definition_ids));
  const issues=[];
  const roleMap=new Map(list(p.roles).map(r=>[r.role_definition_id,r]));
  const workerMap=new Map(list(p.workers).map(w=>[w.worker_id,w]));
  const seenAssignments=new Set();

  for(const worker of p.workers){
    const roles=uniq(worker.role_definition_ids);
    if(!roles.length){
      issues.push({code:'WORKER_WITHOUT_ROLE',severity:'high',worker_id:worker.worker_id,role_definition_id:null});
      continue;
    }
    for(const roleId of roles){
      if(!roleMap.has(roleId)) issues.push({code:'WORKER_UNKNOWN_ROLE',severity:'critical',worker_id:worker.worker_id,role_definition_id:roleId});
    }
  }

  for(const role of p.roles){
    const workers=uniq(role.worker_ids);
    if(criticalRoleIds.has(role.role_definition_id) && workers.length===0){
      issues.push({code:'CRITICAL_ROLE_UNSTAFFED',severity:'high',worker_id:null,role_definition_id:role.role_definition_id});
    }
  }

  for(const link of p.assignment_links){
    const assignmentId=clean(link.assignment_id);
    if(seenAssignments.has(assignmentId)) issues.push({code:'DUPLICATE_ASSIGNMENT_LINK',severity:'high',assignment_id:assignmentId,worker_id:link.worker_id||null});
    seenAssignments.add(assignmentId);

    const worker=link.worker_id?workerMap.get(link.worker_id):null;
    if(link.worker_id && !worker){
      issues.push({code:'ASSIGNMENT_UNKNOWN_WORKER',severity:'critical',assignment_id:assignmentId,worker_id:link.worker_id});
      continue;
    }
    const roles=uniq(link.role_definition_ids);
    if(link.worker_id && roles.length===0){
      issues.push({code:'ASSIGNMENT_WITHOUT_ROLE_CONTEXT',severity:'medium',assignment_id:assignmentId,worker_id:link.worker_id});
    }
    if(worker && worker.role_definition_ids.length>1 && roles.length===0){
      issues.push({code:'AMBIGUOUS_MULTI_ROLE_ASSIGNMENT',severity:'high',assignment_id:assignmentId,worker_id:link.worker_id});
    }
    for(const roleId of roles){
      if(!roleMap.has(roleId)) issues.push({code:'ASSIGNMENT_UNKNOWN_ROLE',severity:'critical',assignment_id:assignmentId,worker_id:link.worker_id||null,role_definition_id:roleId});
      else if(worker && !worker.role_definition_ids.includes(roleId)) issues.push({code:'ASSIGNMENT_ROLE_NOT_HELD',severity:'critical',assignment_id:assignmentId,worker_id:link.worker_id,role_definition_id:roleId});
    }
  }

  const severityWeight={critical:4,high:3,medium:2,low:1};
  issues.sort((a,b)=>(severityWeight[b.severity]||0)-(severityWeight[a.severity]||0)||String(a.code).localeCompare(String(b.code)));
  const counts={critical:0,high:0,medium:0,low:0,total:issues.length};
  for(const issue of issues) counts[issue.severity]=(counts[issue.severity]||0)+1;

  return {
    schema:'titan.workforce.role-worker-integrity.v1',
    company_id:p.company_id,
    status:counts.critical?'invalid':counts.high?'attention':counts.medium?'review':'healthy',
    counts,
    issues,
    critical_role_definition_ids:[...criticalRoleIds].sort(),
    checks:{
      worker_role_membership:true,
      critical_role_staffing:true,
      assignment_uniqueness:true,
      assignment_role_context:true,
      multi_role_assignment_disambiguation:true,
      company_boundary:'company_id',
    },
    read_only:true,
    derived:true,
    automatic_execution:false,
    grants_authority:false,
  };
}

export function summarizeRoleWorkerIntegrity(report={}){
  if(report?.schema!=='titan.workforce.role-worker-integrity.v1') throw new Error('invalid-role-worker-integrity-report');
  return {
    company_id:report.company_id,
    status:report.status,
    counts:{...report.counts},
    issue_codes:uniq(report.issues?.map(x=>x.code)),
    read_only:true,
    grants_authority:false,
  };
}
