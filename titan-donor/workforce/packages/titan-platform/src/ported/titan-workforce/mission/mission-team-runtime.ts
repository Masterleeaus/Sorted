// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/mission/mission-team-runtime.mjs
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const uniq=v=>[...new Set(list(v).map(x=>clean(x)).filter(Boolean))].sort();
const STATES=Object.freeze(['DRAFT','FORMING','ACTIVE','HANDOVER','COMPLETED','DISSOLVED','FAILED']);
const TRANSITIONS=Object.freeze({
  DRAFT:['FORMING','DISSOLVED'],
  FORMING:['ACTIVE','DISSOLVED','FAILED'],
  ACTIVE:['HANDOVER','COMPLETED','DISSOLVED','FAILED'],
  HANDOVER:['ACTIVE','COMPLETED','DISSOLVED','FAILED'],
  COMPLETED:[],DISSOLVED:[],FAILED:[]
});
function validCompany(v){return /^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));}
function nodeIndex(graph){return new Map(list(graph?.nodes).map(n=>[n.node_id,n]));}
function workerNode(graph,workerId){return nodeIndex(graph).get(`worker:${clean(workerId)}`)||null;}
function assertGraphCompany(graph,company_id){if(!graph||graph.schema!=='titan.workforce.graph.v1')throw new Error('mission-team-workforce-graph-required');if(graph.company_id!==company_id)throw new Error('mission-team-cross-company-graph-rejected');}
function assertWorker(graph,workerId,label){if(!workerNode(graph,workerId))throw new Error(`mission-team-${label}-worker-not-in-graph`);}
function normalizeMember(raw={}){const worker_id=clean(raw.worker_id||raw.actor_id||raw.id);if(!worker_id)throw new Error('mission-team-member-worker_id-required');return {worker_id,mission_role:clean(raw.mission_role||raw.role,120)||'member',work_item_ids:uniq(raw.work_item_ids),capability_refs:uniq(raw.capability_refs||raw.capabilities),status:clean(raw.status,60)||'assigned',grants_authority:false};}
export function createMissionTeamRecord(input={},graph={}){
  const company_id=clean(input.company_id,128);if(!validCompany(company_id))throw new Error('mission-team-company_id-required');assertGraphCompany(graph,company_id);
  const mission_team_id=clean(input.mission_team_id||input.team_id||input.mission_id,180);if(!mission_team_id)throw new Error('mission-team-id-required');
  const mission_id=clean(input.mission_id||input.deployment_mission_id||mission_team_id,180);
  const coordinator_worker_id=clean(input.coordinator_worker_id||input.coordinator_id,180)||null;
  const supervisor_worker_id=clean(input.supervisor_worker_id||input.supervisor_id,180)||null;
  const members=list(input.members).map(normalizeMember);
  if(coordinator_worker_id)assertWorker(graph,coordinator_worker_id,'coordinator');
  if(supervisor_worker_id)assertWorker(graph,supervisor_worker_id,'supervisor');
  for(const member of members)assertWorker(graph,member.worker_id,'member');
  const ids=uniq(members.map(m=>m.worker_id));if(ids.length!==members.length)throw new Error('mission-team-duplicate-member');
  const now=Date.now();
  return {schema:'titan.workforce.mission-team.v1',company_id,mission_team_id,mission_id,name:clean(input.name,180)||mission_team_id,kind:clean(input.kind,80)||'temporary',state:'DRAFT',coordinator_worker_id,supervisor_worker_id,members:members.sort((a,b)=>a.worker_id.localeCompare(b.worker_id)),objectives:list(input.objectives).map((x,i)=>({objective_id:clean(x?.objective_id||`objective-${i+1}`,180),text:clean(x?.text||x,500),status:clean(x?.status,60)||'planned'})).filter(x=>x.text),work_item_ids:uniq(input.work_item_ids),handover_ref:null,created_at:now,updated_at:now,completed_at:null,dissolved_at:null,failure_reason:null,graph_revision:Number(graph.projection_revision||0),graph_cursor:graph.projection_cursor||null,derived_from_graph:true,durable_authority:false,team_membership_confers_authority:false,supervisor_confers_authority:false,coordinator_confers_authority:false,grants_authority:false,authority_effect:false};
}
export function transitionMissionTeam(record={},input={}){
  if(record?.schema!=='titan.workforce.mission-team.v1')throw new Error('invalid-mission-team-record');
  if(clean(input.company_id,128)!==record.company_id)throw new Error('mission-team-cross-company-transition-rejected');
  const from=clean(record.state,40);const to=clean(input.to_state||input.state,40).toUpperCase();if(!STATES.includes(to))throw new Error('mission-team-invalid-state');
  if(from===to)return {...record,updated_at:record.updated_at,grants_authority:false};
  if(!list(TRANSITIONS[from]).includes(to))throw new Error(`mission-team-invalid-transition:${from}->${to}`);
  if(to==='ACTIVE'&&!record.members.length)throw new Error('mission-team-active-members-required');
  if(to==='HANDOVER'&&!clean(input.handover_ref,220))throw new Error('mission-team-handover-ref-required');
  const now=Date.now();return {...record,state:to,handover_ref:to==='HANDOVER'?clean(input.handover_ref,220):(record.handover_ref||null),failure_reason:to==='FAILED'?clean(input.reason,500)||'unspecified':record.failure_reason,completed_at:to==='COMPLETED'?now:record.completed_at,dissolved_at:to==='DISSOLVED'?now:record.dissolved_at,updated_at:now,grants_authority:false,authority_effect:false};
}
export function summarizeMissionTeam(record={}){return {company_id:record.company_id,mission_team_id:record.mission_team_id,mission_id:record.mission_id,state:record.state,member_count:list(record.members).length,objective_count:list(record.objectives).length,work_item_count:list(record.work_item_ids).length,coordinator_worker_id:record.coordinator_worker_id||null,supervisor_worker_id:record.supervisor_worker_id||null,grants_authority:false};}
export const MissionTeamStates=STATES;
