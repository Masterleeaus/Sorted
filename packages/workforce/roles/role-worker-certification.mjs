const list=v=>Array.isArray(v)?v:[];
const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const uniq=v=>[...new Set(list(v).map(x=>clean(x)).filter(Boolean))].sort();

function requireSchema(value,schema,label){
  if(value?.schema!==schema) throw new Error(`invalid-${label}-schema`);
  if(!clean(value.company_id,128)) throw new Error(`${label}-company_id-required`);
  return value;
}
function assertSameCompany(company_id,value,label){
  if(value.company_id!==company_id) throw new Error(`role-worker-certification-company-mismatch:${label}`);
}
function safetyViolations(value,label){
  const out=[];
  if(value?.grants_authority!==false) out.push(`${label}:grants_authority`);
  if(value?.automatic_execution!==false) out.push(`${label}:automatic_execution`);
  if(value?.applies_mutations===true) out.push(`${label}:applies_mutations`);
  if(value?.creates_assignments===true) out.push(`${label}:creates_assignments`);
  return out;
}

export function certifyRoleWorkerModel(input={}){
  const separation=requireSchema(input.separation,'titan.workforce.role-worker-separation.v1','separation');
  const integrity=requireSchema(input.integrity,'titan.workforce.role-worker-integrity.v1','integrity');
  const staffing=requireSchema(input.staffing,'titan.workforce.role-worker-staffing-projection.v1','staffing');
  const change_set=input.change_set?requireSchema(input.change_set,'titan.workforce.role-worker-change-set.v1','change-set'):null;
  const company_id=separation.company_id;
  assertSameCompany(company_id,integrity,'integrity');
  assertSameCompany(company_id,staffing,'staffing');
  if(change_set) assertSameCompany(company_id,change_set,'change-set');

  const safety_violations=[
    ...safetyViolations(separation,'separation'),
    ...safetyViolations(integrity,'integrity'),
    ...safetyViolations(staffing,'staffing'),
    ...(change_set?safetyViolations(change_set,'change_set'):[]),
  ];

  const integrityIssues=list(integrity.issues);
  const blockingIntegrity=integrityIssues.filter(x=>['critical','high'].includes(clean(x?.severity,30).toLowerCase()));
  const warningIntegrity=integrityIssues.filter(x=>!['critical','high'].includes(clean(x?.severity,30).toLowerCase()));
  const blockers=[];
  if(safety_violations.length) blockers.push({code:'SAFETY_CONTRACT_VIOLATION',count:safety_violations.length,details:[...safety_violations]});
  if(blockingIntegrity.length) blockers.push({code:'BLOCKING_INTEGRITY_ISSUES',count:blockingIntegrity.length,issue_codes:uniq(blockingIntegrity.map(x=>x.code))});

  const warnings=[];
  if(warningIntegrity.length) warnings.push({code:'NON_BLOCKING_INTEGRITY_ISSUES',count:warningIntegrity.length,issue_codes:uniq(warningIntegrity.map(x=>x.code))});
  const summary=staffing.summary||{};
  if(Number(summary.unstaffed_roles||0)>0) warnings.push({code:'UNSTAFFED_ROLES_PRESENT',count:Number(summary.unstaffed_roles||0)});
  if(Number(summary.multi_role_workers||0)>0) warnings.push({code:'MULTI_ROLE_WORKERS_PRESENT',count:Number(summary.multi_role_workers||0)});
  if(change_set?.summary?.changed) warnings.push({code:'STAFFING_CHANGE_SET_PRESENT',count:Number(change_set.summary.role_changes||0)+Number(change_set.summary.worker_changes||0)});

  const data_model_ready=blockers.length===0;
  return {
    schema:'titan.workforce.role-worker-certification.v1',
    company_id,
    status:data_model_ready?'certified':'blocked',
    data_model_ready,
    visible_ui_integration_pending:true,
    blockers,
    warnings,
    source_schemas:[separation.schema,integrity.schema,staffing.schema,...(change_set?[change_set.schema]:[])],
    counts:{
      role_definitions:Number(separation.counts?.role_definitions||0),
      worker_instances:Number(separation.counts?.worker_instances||0),
      assignment_links:Number(separation.counts?.assignment_links||0),
      integrity_issues:integrityIssues.length,
      blocking_integrity_issues:blockingIntegrity.length,
      warnings:warnings.length,
    },
    invariants:{
      role_definition_is_not_worker_instance:separation.invariants?.role_definition_is_not_worker_instance===true,
      one_role_may_have_many_workers:separation.invariants?.one_role_may_have_many_workers===true,
      one_worker_may_hold_many_roles:separation.invariants?.one_worker_may_hold_many_roles===true,
      company_boundary:'company_id',
      identity_confers_authority:false,
      role_assignment_confers_authority:false,
      automatic_execution:false,
    },
    read_only:true,
    derived:true,
    applies_mutations:false,
    creates_assignments:false,
    automatic_execution:false,
    grants_authority:false,
  };
}

export function summarizeRoleWorkerCertification(certification={}){
  if(certification?.schema!=='titan.workforce.role-worker-certification.v1') throw new Error('invalid-role-worker-certification');
  return {
    company_id:certification.company_id,
    status:certification.status,
    data_model_ready:certification.data_model_ready===true,
    visible_ui_integration_pending:certification.visible_ui_integration_pending===true,
    blockers:certification.blockers?.length||0,
    warnings:certification.warnings?.length||0,
    ...certification.counts,
    read_only:true,
    grants_authority:false,
  };
}
