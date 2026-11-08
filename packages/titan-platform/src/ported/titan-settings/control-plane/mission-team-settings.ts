// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/mission-team-settings.mjs
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const LEGACY=new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const STATES=Object.freeze(['DRAFT','FORMING','ACTIVE','HANDOVER','COMPLETED','DISSOLVED','FAILED']);
const TRANSITIONS=Object.freeze({
  DRAFT:Object.freeze(['FORMING','DISSOLVED']),
  FORMING:Object.freeze(['ACTIVE','DISSOLVED','FAILED']),
  ACTIVE:Object.freeze(['HANDOVER','COMPLETED','DISSOLVED','FAILED']),
  HANDOVER:Object.freeze(['ACTIVE','COMPLETED','DISSOLVED','FAILED']),
  COMPLETED:Object.freeze([]),DISSOLVED:Object.freeze([]),FAILED:Object.freeze([])
});
function rejectLegacy(v,path='mission-team-settings'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=clean(v,128);if(!/^[A-Za-z0-9._:-]{2,128}$/.test(id))throw new Error('mission-team-settings-company_id-required');return id;}
function bool(v,d){return typeof v==='boolean'?v:d;}
function normalizeState(v){const s=clean(v,40).toUpperCase();return STATES.includes(s)?s:null;}
export const MISSION_TEAM_SETTINGS_DEFAULTS=Object.freeze({
  default_kind:'temporary',
  require_coordination_owner_before_activation:true,
  require_supervisor_before_activation:false,
  require_coordinator_before_activation:false,
  require_objective_before_activation:false,
  require_handover_ref:true,
  membership_changes_proposal_only:true,
  automatic_activation:false,
  team_membership_confers_authority:false,
  supervisor_confers_authority:false,
  coordinator_confers_authority:false
});
export function projectMissionTeamSettings(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const raw=input.missionTeamSettings||input.settings||{};rejectLegacy(raw);
  const contractions=[];
  if(raw.require_handover_ref===false)contractions.push('handover-ref-remains-mandatory');
  if(raw.membership_changes_proposal_only===false)contractions.push('membership-changes-remain-proposal-only');
  if(raw.automatic_activation===true)contractions.push('mission-team-activation-remains-governed');
  if(raw.team_membership_confers_authority===true)contractions.push('team-membership-never-confers-authority');
  if(raw.supervisor_confers_authority===true)contractions.push('supervisor-identity-never-confers-authority');
  if(raw.coordinator_confers_authority===true)contractions.push('coordinator-identity-never-confers-authority');
  return {
    schema:'titan.settings.mission-team-settings.v1',company_id,
    default_kind:clean(raw.default_kind,80)||'temporary',
    require_coordination_owner_before_activation:bool(raw.require_coordination_owner_before_activation,true),
    require_supervisor_before_activation:bool(raw.require_supervisor_before_activation,false),
    require_coordinator_before_activation:bool(raw.require_coordinator_before_activation,false),
    require_objective_before_activation:bool(raw.require_objective_before_activation,false),
    require_handover_ref:true,
    membership_changes_proposal_only:true,
    automatic_activation:false,
    team_membership_confers_authority:false,
    supervisor_confers_authority:false,
    coordinator_confers_authority:false,
    runtime_states:[...STATES],
    runtime_transition_matrix:Object.fromEntries(Object.entries(TRANSITIONS).map(([k,v])=>[k,[...v]])),
    contractions:[...new Set(contractions)].sort(),
    runtime_owner:'titan-workforce/mission/mission-team-runtime.js',
    coordination_owner:'titan-workforce/coordination/chief-of-staff-runtime.js',
    settings_can_change_runtime_transition_matrix:false,
    settings_can_activate_team:false,
    settings_can_grant_authority:false,
    settings_can_execute:false,
    authority_granted:false,
    execution_permitted:false,
    grants_authority:false
  };
}
export function buildMissionTeamCreationDefaults(projection={},input={}){
  const company_id=company(projection.company_id);if(input.company_id&&clean(input.company_id,128)!==company_id)throw new Error('mission-team-settings-cross-company-creation');rejectLegacy(input);
  return {
    schema:'titan.settings.mission-team-creation-defaults.v1',company_id,
    name:clean(input.name,180)||null,
    kind:clean(input.kind,80)||clean(projection.default_kind,80)||'temporary',
    initial_state:'DRAFT',
    require_coordination_owner_before_activation:projection.require_coordination_owner_before_activation!==false,
    require_supervisor_before_activation:projection.require_supervisor_before_activation===true,
    require_coordinator_before_activation:projection.require_coordinator_before_activation===true,
    require_objective_before_activation:projection.require_objective_before_activation===true,
    require_handover_ref:true,
    membership_changes_proposal_only:true,
    automatic_activation:false,
    settings_projection_only:true,
    settings_can_create_runtime_record:false,
    settings_can_grant_authority:false,
    authority_granted:false,
    execution_permitted:false,
    grants_authority:false
  };
}
export function evaluateMissionTeamTransition(projection={},team={},input={}){
  const company_id=company(projection.company_id);rejectLegacy(input);if(clean(team.company_id,128)!==company_id||clean(input.company_id,128)!==company_id)throw new Error('mission-team-settings-cross-company-transition');
  if(team?.schema!=='titan.workforce.mission-team.v1')throw new Error('mission-team-settings-runtime-record-required');
  const from=normalizeState(team.state);const to=normalizeState(input.to_state||input.state);if(!from||!to)throw new Error('mission-team-settings-invalid-state');
  const blocking=[];
  if(from!==to&&!TRANSITIONS[from].includes(to))blocking.push(`runtime-transition-not-allowed:${from}->${to}`);
  if(to==='ACTIVE'){
    if(list(team.members).length===0)blocking.push('runtime-active-members-required');
    const hasSupervisor=Boolean(clean(team.supervisor_worker_id));const hasCoordinator=Boolean(clean(team.coordinator_worker_id));
    if(projection.require_coordination_owner_before_activation!==false&&!hasSupervisor&&!hasCoordinator)blocking.push('coordination-owner-required-before-activation');
    if(projection.require_supervisor_before_activation===true&&!hasSupervisor)blocking.push('supervisor-required-before-activation');
    if(projection.require_coordinator_before_activation===true&&!hasCoordinator)blocking.push('coordinator-required-before-activation');
    if(projection.require_objective_before_activation===true&&list(team.objectives).filter(x=>clean(x?.text||x,500)).length===0)blocking.push('objective-required-before-activation');
  }
  if(to==='HANDOVER'&&!clean(input.handover_ref||team.handover_ref,220))blocking.push('handover-ref-required');
  return {
    schema:'titan.settings.mission-team-transition-evaluation.v1',company_id,mission_team_id:clean(team.mission_team_id),from_state:from,to_state:to,
    settings_policy_allows_transition:blocking.length===0,
    blocking_reasons:blocking,
    requires_coordination_owner:projection.require_coordination_owner_before_activation!==false,
    requires_runtime_transition:true,
    requires_runtime_authority_evaluation:true,
    membership_changes_proposal_only:true,
    automatic_activation:false,
    team_membership_confers_authority:false,
    supervisor_confers_authority:false,
    coordinator_confers_authority:false,
    settings_can_change_runtime_transition_matrix:false,
    settings_can_grant_authority:false,
    settings_can_execute:false,
    authority_granted:false,
    execution_permitted:false,
    grants_authority:false
  };
}
export const MissionTeamSettingStates=STATES;
