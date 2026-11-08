import graph from './workforce-organizational-graph.json' with { type: 'json' };

const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const norm=v=>clean(v,240).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const tokens=v=>new Set(norm(v).split(/\s+/).filter(x=>x.length>2&&!['agent','worker','create','update','send','manage'].includes(x)));

const catalogue=[...list(graph.catalogue_hierarchy),...list(graph.supplemental_supervisors)];
const roleById=new Map(catalogue.map(x=>[x.role_definition_id,x]));
const workerById=new Map(list(graph.atomic_workers).map(x=>[x.worker_id,x]));
const orchByKey=new Map(list(graph.orchestrators).map(x=>[x.agent_key,x]));

const supplementalByDivision=new Map(list(graph.supplemental_supervisors).map(x=>[x.division_key,x]));

function parent(role){return role?.reports_to?roleById.get(role.reports_to)||null:null;}
function nearest(role,tierName){let cur=role;const seen=new Set();while(cur&&!seen.has(cur.role_definition_id)){seen.add(cur.role_definition_id);if(cur.workforce_tier===tierName)return cur;cur=parent(cur);}return null;}
function managerFor(role){return nearest(role,'manager');}
function supervisorFor(specialist){
  const explicit=nearest(specialist,'supervisor');
  if(explicit)return explicit;
  return supplementalByDivision.get(specialist?.division_key)||null;
}
function scoreWorker(worker, intent, affinity){
  let score=0; const it=tokens(intent); const wt=tokens(`${worker.name} ${worker.legacy_class||''}`);
  for(const t of it) if(wt.has(t)) score+=5;
  if(worker.reports_to_specialist===affinity) score+=3;
  const specialist=roleById.get(worker.reports_to_specialist);
  const st=tokens(`${specialist?.name||''} ${specialist?.division_key||''}`);
  for(const t of it) if(st.has(t)) score+=2;
  return score;
}
function selectWorker({worker_id,intent,affinity}){
  if(worker_id){const w=workerById.get(clean(worker_id));if(!w)throw new Error('delegation-worker-not-found');return w;}
  const ranked=[...workerById.values()].map(w=>({w,s:scoreWorker(w,intent,affinity)})).sort((a,b)=>b.s-a.s||a.w.worker_id.localeCompare(b.w.worker_id));
  return ranked[0]?.s>0?ranked[0].w:null;
}
function assertRole(role,tierName,label){if(!role)throw new Error(`delegation-${label}-missing`);if(role.workforce_tier!==tierName)throw new Error(`delegation-${label}-wrong-tier`);}

export function resolveDelegationChain(input={}){
  const company_id=clean(input.company_id,128);if(!validCompany(company_id))throw new Error('delegation-company_id-required');
  const orchestrator_key=clean(input.orchestrator_key||input.agent_key,80);const orchestrator=orchByKey.get(orchestrator_key);if(!orchestrator)throw new Error('delegation-orchestrator-not-found');
  const worker=selectWorker({worker_id:input.worker_id,intent:input.intent||input.task||'',affinity:orchestrator.primary_role_affinity});
  if(!worker)return {schema:'titan.workforce.delegation-route.v1',company_id,orchestrator,route_status:'NO_ATOMIC_WORKER_MATCH',manager:null,supervisor:null,specialist:null,worker:null,grants_authority:false,authority_effect:false};
  if(worker.atomic!==true||worker.can_delegate!==false)throw new Error('delegation-worker-not-atomic');
  const specialist=roleById.get(worker.reports_to_specialist);assertRole(specialist,'specialist','specialist');
  const supervisor=supervisorFor(specialist);assertRole(supervisor,'supervisor','supervisor');
  const manager=managerFor(supervisor)||managerFor(specialist);assertRole(manager,'manager','manager');
  return {
    schema:'titan.workforce.delegation-route.v1',company_id,route_status:'READY_FOR_GOVERNED_HANDOFF',
    orchestrator:{agent_key:orchestrator.agent_key,name:orchestrator.name,tier:'orchestrator'},
    manager:{role_definition_id:manager.role_definition_id,name:manager.name,tier:'manager'},
    supervisor:{role_definition_id:supervisor.role_definition_id,name:supervisor.name,tier:'supervisor',supplemental:supervisor.supplemental===true},
    specialist:{role_definition_id:specialist.role_definition_id,name:specialist.name,tier:'specialist'},
    worker:{worker_id:worker.worker_id,name:worker.name,tier:'worker',atomic:true},
    chain:[`orchestrator:${orchestrator.agent_key}`,manager.role_definition_id,supervisor.role_definition_id,specialist.role_definition_id,worker.worker_id],
    execution_layer:'tool_capability',delegation_is_proposal:true,identity_grants_authority:false,grants_authority:false,authority_effect:false
  };
}

export function prepareDelegationHandoff(input={}){
  const route=resolveDelegationChain(input);if(route.route_status!=='READY_FOR_GOVERNED_HANDOFF')return {...route,handoff:null};
  const task=clean(input.task||input.intent,500);if(!task)throw new Error('delegation-task-required');
  const handoff_id=clean(input.handoff_id,180)||`delegation:${route.orchestrator.agent_key}:${route.worker.worker_id}:${Date.now()}`;
  return {...route,handoff:{schema:'titan.workforce.delegation-handoff.v1',handoff_id,company_id:route.company_id,state:'PROPOSED',task,chain:route.chain,from_orchestrator:route.orchestrator.agent_key,to_worker_id:route.worker.worker_id,requires_authority_evaluation:true,requires_capability_resolution:true,execution_permitted:false,delegation_confers_authority:false,grants_authority:false}};
}

export function validateDelegationChain(route={}){
  const errs=[];
  if(route?.schema!=='titan.workforce.delegation-route.v1')errs.push('invalid-schema');
  if(!validCompany(route?.company_id))errs.push('invalid-company');
  const expected=['orchestrator','manager','supervisor','specialist','worker'];
  const nodes=[route.orchestrator,route.manager,route.supervisor,route.specialist,route.worker];
  nodes.forEach((n,i)=>{if(!n)errs.push(`missing-${expected[i]}`);else if(n.tier!==expected[i])errs.push(`wrong-tier-${expected[i]}`);});
  if(route.worker&&route.worker.atomic!==true)errs.push('worker-not-atomic');
  if(route.grants_authority!==false||route.authority_effect!==false)errs.push('authority-escalation');
  return {ok:errs.length===0,errors:errs};
}

export function listWorkersForSpecialist(specialist_id){return [...workerById.values()].filter(w=>w.reports_to_specialist===clean(specialist_id)).sort((a,b)=>a.worker_id.localeCompare(b.worker_id));}
export default {resolveDelegationChain,prepareDelegationHandoff,validateDelegationChain,listWorkersForSpecialist};
