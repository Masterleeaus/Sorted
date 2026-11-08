// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/graph/workforce-graph.mjs
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const uniq=values=>[...new Set(values.map(v=>clean(v)).filter(Boolean))].sort();

function refId(kind,id){return `${kind}:${clean(id,180)}`;}
function addNode(nodes,company_id,kind,id,data={},source_refs=[]){
  id=clean(id,180);if(!id)return null;const node_id=refId(kind,id);
  const prior=nodes.get(node_id)||{node_id,company_id,kind,entity_id:id,label:null,status:null,source_refs:[],attributes:{},grants_authority:false};
  const next={...prior,label:clean(data.label??data.name??data.role_name??prior.label,180)||prior.label,status:clean(data.status??data.state??data.decision_state??prior.status,80)||prior.status,attributes:{...prior.attributes,...data.attributes},source_refs:uniq([...(prior.source_refs||[]),...source_refs]),grants_authority:false};
  nodes.set(node_id,next);return node_id;
}
function addEdge(edges,company_id,type,from,to,data={},source_refs=[]){
  if(!from||!to)return;const key=`${type}|${from}|${to}`;
  if(edges.has(key))return;edges.set(key,{edge_id:`edge:${type}:${from}:${to}`,company_id,type,from,to,status:clean(data.status,80)||null,attributes:data.attributes||{},source_refs:uniq(source_refs),grants_authority:false});
}
function idsFrom(value,...keys){
  for(const key of keys){const v=value?.[key];if(Array.isArray(v))return uniq(v);if(v!=null&&clean(v))return [clean(v)];}
  return [];
}

export function buildCanonicalWorkforceGraph(projection={}){
  const company_id=clean(projection.company_id,128);if(!validCompany(company_id))throw new Error('workforce-graph-company_id-required');
  const nodes=new Map(),edges=new Map();
  const roster=list(projection.roster).filter(x=>!x?.company_id||x.company_id===company_id);
  const assignments=list(projection.assignments).filter(x=>!x?.company_id||x.company_id===company_id);
  const profile=projection.workforce_profile?.company_id===company_id?projection.workforce_profile:null;
  const handover=projection.handover?.company_id===company_id?projection.handover:null;

  for(const role of list(profile?.activated_roles)){
    const roleId=typeof role==='string'?role:(role?.role_definition_id||role?.role_id);
    addNode(nodes,company_id,'role',roleId,{label:role?.name||role?.role_name,status:role?.status||'active'},['workforce_profile.activated_roles']);
  }

  for(const member of roster){
    const workerId=member.worker_id||member.actor_id||member.agent_id||member.id;
    const worker=addNode(nodes,company_id,'worker',workerId,{label:member.name||member.display_name,status:member.status||member.state,attributes:{actor_type:clean(member.actor_type||member.worker_type||member.type,80)||null}},['roster']);
    const roleIds=idsFrom(member,'role_definition_ids','role_ids').concat(idsFrom(member,'role_definition_id','role_id','role'));
    for(const roleId of uniq(roleIds)){const role=addNode(nodes,company_id,'role',roleId,{label:member.role_name},['roster']);addEdge(edges,company_id,'HAS_ROLE',worker,role,{},['roster']);}
    const teamIds=idsFrom(member,'team_ids').concat(idsFrom(member,'team_id','crew_id','group_id'));
    for(const teamId of uniq(teamIds)){const team=addNode(nodes,company_id,'team',teamId,{label:member.team_name||member.crew_name},['roster']);addEdge(edges,company_id,'MEMBER_OF_TEAM',worker,team,{},['roster']);}
    const supervisorIds=idsFrom(member,'supervisor_ids','manager_ids').concat(idsFrom(member,'supervisor_id','manager_id','reports_to_worker_id'));
    for(const supervisorId of uniq(supervisorIds)){const supervisor=addNode(nodes,company_id,'worker',supervisorId,{},['roster']);addEdge(edges,company_id,'REPORTS_TO',worker,supervisor,{},['roster']);}
    const missionIds=idsFrom(member,'mission_ids').concat(idsFrom(member,'mission_id','deployment_mission_id'));
    for(const missionId of uniq(missionIds)){const mission=addNode(nodes,company_id,'mission',missionId,{label:member.mission_name},['roster']);addEdge(edges,company_id,'PARTICIPATES_IN_MISSION',worker,mission,{},['roster']);}
    const capabilityIds=idsFrom(member,'capabilities','capability_ids','provider_capabilities');
    for(const capabilityId of uniq(capabilityIds)){const capability=addNode(nodes,company_id,'capability',capabilityId,{},['roster']);addEdge(edges,company_id,'HAS_CAPABILITY',worker,capability,{},['roster']);}
  }

  for(const assignment of assignments){
    const assignmentId=assignment.assignment_id||assignment.id||assignment.work_item_id;
    const assignmentNode=addNode(nodes,company_id,'assignment',assignmentId,{status:assignment.decision_state||assignment.state},['assignments']);
    const workerId=assignment.worker_id||assignment.assignee_worker_id||assignment.actor_id;
    const worker=addNode(nodes,company_id,'worker',workerId,{},['assignments']);
    if(worker)addEdge(edges,company_id,'ASSIGNED_TO',assignmentNode,worker,{status:assignment.decision_state||assignment.state},['assignments']);
    const workItemId=assignment.work_item_id||assignment.job_id||assignment.task_id;
    const workItem=addNode(nodes,company_id,'work_item',workItemId,{label:assignment.work_type||assignment.title,status:assignment.work_state},['assignments']);
    if(workItem)addEdge(edges,company_id,'ASSIGNMENT_FOR',assignmentNode,workItem,{},['assignments']);
    const missionId=assignment.mission_id||assignment.deployment_mission_id;
    if(missionId){const mission=addNode(nodes,company_id,'mission',missionId,{label:assignment.mission_name},['assignments']);addEdge(edges,company_id,'PART_OF_MISSION',assignmentNode,mission,{},['assignments']);}
    const roleId=assignment.role_definition_id||assignment.role_id;
    if(roleId&&worker){const role=addNode(nodes,company_id,'role',roleId,{label:assignment.role_name},['assignments']);addEdge(edges,company_id,'HAS_ROLE',worker,role,{},['assignments']);}
    for(const capabilityId of uniq(list(assignment.required_capabilities).concat(list(assignment.capabilities)))){const cap=addNode(nodes,company_id,'capability',capabilityId,{},['assignments']);if(workItem)addEdge(edges,company_id,'REQUIRES_CAPABILITY',workItem,cap,{},['assignments']);if(assignmentNode)addEdge(edges,company_id,'REQUIRES_CAPABILITY',assignmentNode,cap,{},['assignments']);}
  }

  if(handover){
    const handoverId=handover.client_workforce_handover_id||handover.handover_id||handover.id||'active';
    const h=addNode(nodes,company_id,'handover',handoverId,{label:handover.title,status:handover.state||handover.status,attributes:{deployment_mission_id:clean(handover.deployment_mission_id||handover.mission_id,180)||null}},['handover']);
    const missionId=handover.deployment_mission_id||handover.mission_id;if(missionId){const m=addNode(nodes,company_id,'mission',missionId,{},['handover']);addEdge(edges,company_id,'HANDOVER_FOR_MISSION',h,m,{},['handover']);}
    for(const workerId of uniq(list(handover.worker_ids).concat(list(handover.workers).map(x=>typeof x==='string'?x:x?.worker_id)) )){const w=addNode(nodes,company_id,'worker',workerId,{},['handover']);addEdge(edges,company_id,'INCLUDED_IN_HANDOVER',h,w,{},['handover']);}
  }

  const nodeList=[...nodes.values()].sort((a,b)=>a.node_id.localeCompare(b.node_id));
  const edgeList=[...edges.values()].sort((a,b)=>a.edge_id.localeCompare(b.edge_id));
  const counts={};for(const n of nodeList)counts[n.kind]=(counts[n.kind]||0)+1;
  return {schema:'titan.workforce.graph.v1',company_id,projection_revision:Number(projection.projection_revision||0),projection_cursor:clean(projection.projection_cursor,240)||null,sync_generation:Number(projection.sync_generation||0),nodes:nodeList,edges:edgeList,counts,source_components:['workforce_profile','roster','assignments','handover'],derived:true,durable_authority:false,identity_confers_authority:false,role_confers_authority:false,graph_confers_authority:false,grants_authority:false};
}

export function summarizeWorkforceGraph(graph={}){
  if(graph?.schema!=='titan.workforce.graph.v1')throw new Error('invalid-workforce-graph');
  return {company_id:graph.company_id,node_count:list(graph.nodes).length,edge_count:list(graph.edges).length,counts:{...(graph.counts||{})},projection_revision:Number(graph.projection_revision||0),projection_cursor:graph.projection_cursor||null,grants_authority:false};
}
