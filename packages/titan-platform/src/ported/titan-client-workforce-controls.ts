// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-client-workforce-controls.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero client workforce controls. Additive owner/operator projection; no authority is granted here. */
(() => {
  const KEYS = Object.freeze({
    businessProfile:'titanBusinessProfile',
    activationProposals:'titanWorkforceActivationProposals',
    controlIntents:'titanWorkforceControlIntents',
    managerProjection:'titanWorkforceManagerProjection'
  });
  const validCompanyId=value=>/^[A-Za-z0-9._:-]{2,128}$/.test(String(value||'').trim());
  const uid=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2,10)}`}`;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let catalogue=null;
  let templates=[];
  let state={company_id:'',outcomes:[],proposals:[],intents:[],allProposals:[],allIntents:[],missionTeams:[],supervisorCoordination:[],chiefOfStaffCoordination:null,decisionRightsPolicy:null,skillCapabilityRegistry:null,workloadCapacity:null,dynamicStaffing:null,performanceOutcomes:null,improvementProposals:null,investigationInstallationHandover:null,businessDiscoverySpecification:null,installationPlan:null,commissioningGates:null,liveHostCertification:null,endToEndCertification:null,crossVersionCompatibility:null,migrationUpgradeSafety:null,uninstallReversibility:null,securityPosture:null,privacyEvidenceControls:null,intelligenceRouting:null,knowledgeAuthority:null,unifiedWorkforce:null,externalActorBoundary:null,notificationEscalation:null,scheduleRecurrence:null,financialResourceGuardrails:null,physicalEnvironmentalRisk:null,workerMemory:null,projection:{roster:[],assignments:[],approval_waits:[],escalations:[],workforce_profile:null,handover:null,change_requests:[],projection_revision:0,projection_cursor:null,sync_generation:0,sync_started_at_ms:0,component_cursors:{},workforce_graph:null}};

  async function loadJson(path){
    const response=await fetch(chrome.runtime.getURL(path));
    if(!response.ok) throw new Error(`Unable to load ${path} (${response.status})`);
    return response.json();
  }

  async function loadStaticData(){
    if(!catalogue) catalogue=await window.TitanWorkforce?.loadRoleCatalogue?.() || await loadJson('titan-workforce/catalogue/installed-client-workforce-master.json');
    if(!templates.length){
      const data=await loadJson('titan-workforce/templates/client-team-templates.json');
      templates=Array.isArray(data?.templates)?data.templates:[];
    }
    return {catalogue,templates};
  }

  const sameCompany=(item,company_id)=>item?.company_id===company_id;
  const cleanArray=v=>Array.isArray(v)?v:[];
  async function loadCanonicalOutcomes(company_id){
    if(typeof chrome.runtime?.sendMessage!=='function') return [];
    const response=await chrome.runtime.sendMessage({
      type:'TITAN_BUSINESS_STATE',
      action:'list',
      context:{company_id,actor_id:'user:titan-client-workforce-controls'},
      domain:'outcome',
      options:{limit:10000}
    });
    if(!response?.ok) throw new Error(response?.error||'Unable to load canonical outcomes');
    return cleanArray(response.result).filter(x=>sameCompany(x,company_id));
  }

  async function loadState(){
    const data=await chrome.storage.local.get(Object.values(KEYS));
    const company_id=String(data[KEYS.businessProfile]?.company_id||'').trim();
    if(!validCompanyId(company_id)) throw new Error('Client workforce controls require a valid company_id');
    const allProposals=cleanArray(data[KEYS.activationProposals]);
    const allIntents=cleanArray(data[KEYS.controlIntents]);
    const projectionStore=data[KEYS.managerProjection]||{};
    const projection=projectionStore?.company_id ? projectionStore : projectionStore?.[company_id];
    state={
      company_id,
      outcomes:await loadCanonicalOutcomes(company_id),
      proposals:allProposals.filter(x=>sameCompany(x,company_id)),
      intents:allIntents.filter(x=>sameCompany(x,company_id)),
      allProposals,
      allIntents,
      missionTeams:[],
      supervisorCoordination:[],
      chiefOfStaffCoordination:null,
      decisionRightsPolicy:null,
      workloadCapacity:null,
      projection:projection?.company_id===company_id?{
        roster:cleanArray(projection.roster).filter(x=>!x?.company_id||sameCompany(x,company_id)),
        assignments:cleanArray(projection.assignments).filter(x=>sameCompany(x,company_id)),
        approval_waits:cleanArray(projection.approval_waits).filter(x=>sameCompany(x,company_id)),
        escalations:cleanArray(projection.escalations).filter(x=>sameCompany(x,company_id)),
        workforce_profile:projection.workforce_profile?.company_id===company_id?projection.workforce_profile:null,
        handover:projection.handover?.company_id===company_id?projection.handover:null,
        change_requests:cleanArray(projection.change_requests).filter(x=>!x?.company_id||sameCompany(x,company_id)),
        projection_revision:Number.isSafeInteger(Number(projection.projection_revision))?Number(projection.projection_revision):0,
        projection_cursor:String(projection.projection_cursor||'')||null,
        sync_generation:Number(projection.sync_generation||0),
        sync_started_at_ms:Number(projection.sync_started_at_ms||0),
        component_cursors:projection.component_cursors&&typeof projection.component_cursors==='object'?projection.component_cursors:{},
        workforce_graph:projection.workforce_graph?.company_id===company_id&&projection.workforce_graph?.grants_authority===false?projection.workforce_graph:null
      }:{roster:[],assignments:[],approval_waits:[],escalations:[],workforce_profile:null,handover:null,change_requests:[],projection_revision:0,projection_cursor:null,sync_generation:0,sync_started_at_ms:0,component_cursors:{},workforce_graph:null}
    };
    return state;
  }

  const observedRoleIds=()=>new Set(state.outcomes.map(x=>x?.role_definition_id).filter(Boolean));
  const proposedRoleIds=()=>new Set(state.proposals.filter(x=>x?.state!=='superseded'&&x?.state!=='rejected').map(x=>x?.role_definition_id).filter(Boolean));

  // Pass 2: derive the headline Workforce activity strip from the existing canonical
  // projection/runtime state. These counts are presentation-only and never grant authority.
  const liveAssignmentStates=new Set(['assigned','active','accepted','in_progress','in-progress','working','running','executing']);
  const liveWorkerStates=new Set(['active','available','busy','online','working','running','executing','in_progress','in-progress']);
  const openEscalationStates=new Set(['open','acknowledged','escalated']);
  const openNotificationStates=new Set(['OPEN','ESCALATED']);
  const normalizeState=value=>String(value||'').trim().toLowerCase();
  const workerRef=item=>String(item?.worker_id||item?.assignee_worker_id||item?.actor_id||item?.agent_id||item?.id||'').trim();
  let organizationIdentityFilter='all';

  function deriveLiveActivityCounts(snapshot=state){
    const projection=snapshot?.projection||{};
    const activeWorkers=new Set();
    for(const assignment of cleanArray(projection.assignments)){
      const status=normalizeState(assignment?.decision_state||assignment?.state||assignment?.work_state);
      const id=workerRef(assignment);
      if(id&&liveAssignmentStates.has(status)) activeWorkers.add(id);
    }
    for(const member of cleanArray(projection.roster)){
      const status=normalizeState(member?.status||member?.state||member?.availability_status);
      const id=workerRef(member);
      if(id&&liveWorkerStates.has(status)) activeWorkers.add(id);
    }

    const managers=new Set();
    for(const record of cleanArray(snapshot?.supervisorCoordination)){
      const id=String(record?.supervisor_worker_id||record?.worker_id||'').trim();
      if(id) managers.add(id);
    }
    const graph=projection?.workforce_graph;
    for(const edge of cleanArray(graph?.edges)){
      if(edge?.type!=='REPORTS_TO') continue;
      const target=String(edge?.to||'').replace(/^worker:/,'').trim();
      if(target) managers.add(target);
    }
    const chief=snapshot?.chiefOfStaffCoordination;
    const chiefId=String(chief?.chief_of_staff_worker_id||'').trim();
    if(chiefId) managers.add(chiefId);
    const managerCount=managers.size+((chief&&!chiefId)?1:0);

    const notificationRuntime=snapshot?.notificationEscalation;
    const liveNotifications=cleanArray(notificationRuntime?.notifications).filter(item=>openNotificationStates.has(String(item?.state||'OPEN').toUpperCase()));
    const notificationCount=liveNotifications.length || Number(notificationRuntime?.summary?.open_count||0);

    const projectedEscalations=cleanArray(projection.escalations).filter(item=>openEscalationStates.has(normalizeState(item?.state||'open')));
    const notificationEscalations=liveNotifications.filter(item=>String(item?.state||'').toUpperCase()==='ESCALATED');
    const escalationCount=projectedEscalations.length || notificationEscalations.length;

    return {
      active_now:activeWorkers.size,
      managers:managerCount,
      notifications:Math.max(0,notificationCount),
      escalations:Math.max(0,escalationCount),
      grants_authority:false
    };
  }

  function renderLiveActivityStrip(){
    const counts=deriveLiveActivityCounts(state);
    const set=(id,value)=>{const el=document.getElementById(id);if(el){el.textContent=String(value);el.dataset.live='1';}};
    set('titan-wf-active-now',counts.active_now);
    set('titan-wf-managers',counts.managers);
    set('titan-wf-notifications',counts.notifications);
    set('titan-wf-escalation-demo',counts.escalations);
    return counts;
  }

  function renderUnifiedCommandDashboard(){
    if(!document.getElementById('titan-wf-command-dashboard')) return null;
    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value)};
    const openStates=new Set(['ACTIVE','FORMING','DRAFT','HANDOVER','OPEN','ACKNOWLEDGED','WAITING','PENDING','ASSIGNED','PROPOSED']);
    const activeTeams=cleanArray(state.missionTeams).filter(team=>openStates.has(normalizeState(team?.state||team?.status||'ACTIVE')));
    const capacity=state.workloadCapacity||{};
    const capacitySummary=capacity.summary||capacity.readiness||{};
    const totalCapacity=Number(capacitySummary.total_capacity??capacitySummary.capacity_total??capacitySummary.worker_count??0);
    const usedCapacity=Number(capacitySummary.used_capacity??capacitySummary.assigned_capacity??capacitySummary.active_workload??0);
    const overloaded=Number(capacitySummary.overloaded_count??capacitySummary.overloaded_workers??cleanArray(capacity.overloaded_workers).length??0);
    const utilisation=Number.isFinite(Number(capacitySummary.utilization_percent))?Math.round(Number(capacitySummary.utilization_percent)):totalCapacity>0?Math.max(0,Math.min(100,Math.round((usedCapacity/totalCapacity)*100))):null;
    const staffing=state.dynamicStaffing||{};
    const staffingSummary=staffing.summary||staffing.readiness||{};
    const staffingRecommendations=Number(staffingSummary.recommendation_count??staffingSummary.proposal_count??cleanArray(staffing.recommendations||staffing.proposals).length??0);
    const schedule=state.scheduleRecurrence||{};
    const scheduleSummary=schedule.summary||schedule.readiness||{};
    const dueSchedules=Number(scheduleSummary.due_schedule_count??scheduleSummary.due_count??0);
    const risk=state.physicalEnvironmentalRisk||{};
    const riskSummary=risk.summary||risk.readiness||{};
    const criticalRisk=Number(riskSummary.critical_count??0);
    const highRisk=Number(riskSummary.high_or_critical_count??riskSummary.high_count??0);
    const workforce=state.unifiedWorkforce||{};
    const workforceSummary=workforce.summary||workforce.readiness||{};
    const humans=Number(workforceSummary.human_workers??workforceSummary.human_count??0);
    const ai=Number(workforceSummary.advanced_intelligence_workers??workforceSummary.ai_workers??workforceSummary.advanced_intelligence_count??0);
    const activity=deriveLiveActivityCounts(state);
    const approvals=cleanArray(state.projection?.approval_waits).filter(x=>normalizeState(x?.state||'WAITING')==='WAITING').length;
    const escalations=activity.escalations;
    const openNotifications=activity.notifications;
    const blockers=[
      ...cleanArray(state.installationPlan?.readiness?.blockers),
      ...cleanArray(state.commissioningGates?.readiness?.blockers),
      ...cleanArray(state.endToEndCertification?.readiness?.blockers)
    ];
    const managerNeeds=escalations+approvals+criticalRisk+overloaded;
    set('titan-wf-command-teams',activeTeams.length);
    set('titan-wf-command-teams-detail',activeTeams.length?`${activeTeams.filter(x=>normalizeState(x?.state)==='ACTIVE').length} active · ${activeTeams.filter(x=>normalizeState(x?.state)==='HANDOVER').length} handover`:'No active mission teams');
    set('titan-wf-command-capacity',utilisation==null?'—':`${utilisation}%`);
    set('titan-wf-command-capacity-detail',utilisation==null?'Capacity data not loaded':`${overloaded} overloaded · ${Math.max(0,totalCapacity-usedCapacity)} capacity available`);
    set('titan-wf-command-staffing',staffingRecommendations);
    set('titan-wf-command-staffing-detail',staffingRecommendations?`${staffingRecommendations} governed recommendation${staffingRecommendations===1?'':'s'}`:'No staffing recommendations');
    set('titan-wf-command-schedules',dueSchedules);
    set('titan-wf-command-schedules-detail',`${Number(scheduleSummary.enabled_count??0)} enabled · ${dueSchedules} due`);
    set('titan-wf-command-risk',highRisk);
    set('titan-wf-command-risk-detail',`${criticalRisk} critical · ${Number(riskSummary.environmental_count??0)} environmental`);
    set('titan-wf-command-mix',(humans||ai)?`${humans} / ${ai}`:'—');
    set('titan-wf-command-mix-detail',(humans||ai)?`${humans} human · ${ai} Advanced Intelligence`:'Human + AI view not loaded');
    set('titan-wf-command-needs',managerNeeds?`${escalations} escalations · ${approvals} approvals · ${overloaded} overloaded · ${criticalRisk} critical risk`:'No manager-attention items.');
    set('titan-wf-command-pulse',`${activity.active_now} active workers · ${activeTeams.length} mission teams · ${openNotifications} open notifications · ${staffingRecommendations} staffing recommendations`);
    const e2e=state.endToEndCertification;
    const deploymentText=e2e?`${e2e.state||'REVIEW'} · ${e2e.summary?.passed||0}/${e2e.summary?.total||0} certification checks · ${blockers.length} blockers`:state.installationPlan?`${state.installationPlan.state||'REVIEW'} installation plan · ${blockers.length} blockers`:'No deployment assessment loaded.';
    set('titan-wf-command-deployment',deploymentText);
    const health=document.getElementById('titan-wf-command-health');
    if(health){
      const healthState=criticalRisk>0?'critical':(escalations>0||approvals>0||overloaded>0||blockers.length>0?'attention':'ok');
      health.dataset.state=healthState;
      health.textContent=healthState==='critical'?'Critical attention':healthState==='attention'?'Needs attention':'Operational';
    }
    return {active_mission_teams:activeTeams.length,capacity_utilisation_percent:utilisation,staffing_recommendations:staffingRecommendations,due_schedules:dueSchedules,high_or_critical_risk:highRisk,human_workers:humans,advanced_intelligence_workers:ai,manager_attention_items:managerNeeds,grants_authority:false};
  }

  function renderChiefOfStaffCommandCentre(){
    const root=document.getElementById('titan-wf-chief-command');
    if(!root) return null;
    const chief=state.chiefOfStaffCoordination||{};
    const staffing=state.dynamicStaffing||{};
    const capacity=state.workloadCapacity||{};
    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value)};
    const gaps=cleanArray(chief.responsibility_gaps);
    const overlaps=cleanArray(chief.responsibility_overlaps);
    const escalations=cleanArray(chief.consolidated_escalations).filter(item=>!['closed','resolved'].includes(normalizeState(item?.state||'open')));
    const priorities=cleanArray(chief.priorities).slice().sort((a,b)=>Number(b?.priority||0)-Number(a?.priority||0)||String(a?.ref||'').localeCompare(String(b?.ref||'')));
    const recommendations=cleanArray(chief.recommendations);
    const staffingCandidates=cleanArray(staffing.candidates);
    const staffingGaps=cleanArray(staffing.gaps);
    const overloaded=cleanArray(capacity.worker_capacity).filter(worker=>String(worker?.state||'').toUpperCase()==='OVERLOADED');
    const staffingPressure=staffingCandidates.length+staffingGaps.length;
    set('titan-wf-chief-gaps',gaps.length);
    set('titan-wf-chief-overlaps',overlaps.length);
    set('titan-wf-chief-escalations',escalations.length);
    set('titan-wf-chief-staffing',staffingPressure);
    set('titan-wf-chief-priority-count',`${priorities.length} priorit${priorities.length===1?'y':'ies'}`);
    set('titan-wf-chief-recommendation-count',`${recommendations.length+staffingCandidates.length} recommendation${recommendations.length+staffingCandidates.length===1?'':'s'}`);
    set('titan-wf-chief-coverage',`${Number(chief.supervisor_count||state.supervisorCoordination?.length||0)} supervisors · ${Number(chief.active_mission_team_count||0)} active mission teams · graph revision ${Number(chief.graph_revision||state.projection?.projection_revision||0)}`);
    const priorityRoot=document.getElementById('titan-wf-chief-priorities');
    if(priorityRoot){
      const merged=[...priorities.map(item=>({source:'Chief of Staff',kind:item.kind||'priority',ref:item.ref||'Unknown',score:Number(item.priority||0),reason:item.reason||'coordination review required',owners:cleanArray(item.owner_worker_ids)})),...overloaded.map(worker=>({source:'Capacity',kind:'overloaded_worker',ref:worker.worker_id||'worker',score:70,reason:'worker capacity overloaded',owners:[worker.worker_id].filter(Boolean)})),...staffingGaps.map(item=>({source:'Staffing',kind:item.kind||'staffing_gap',ref:item.assignment_id||item.mission_team_id||'staffing gap',score:70,reason:item.reason||'no eligible staffing candidate',owners:[item.current_worker_id].filter(Boolean)}))].sort((a,b)=>b.score-a.score||String(a.ref).localeCompare(String(b.ref))).slice(0,10);
      priorityRoot.innerHTML=merged.length?merged.map(item=>`<article class="workforce-chief-item" data-priority="${item.score>=80?'high':item.score>=60?'attention':'normal'}"><div><strong>${esc(String(item.kind).replaceAll('_',' '))}</strong><span>${esc(item.source)} · ${esc(item.ref)}</span></div><small>${esc(item.reason)}${item.owners.length?` · owner ${esc(item.owners.join(', '))}`:''}</small><b>${item.score}</b></article>`).join(''):'<div class="workforce-chief-empty">No current coordination priorities.</div>';
    }
    const recommendationRoot=document.getElementById('titan-wf-chief-recommendations');
    if(recommendationRoot){
      const combined=[...recommendations.map(item=>({type:item.type||'coordination_recommendation',target:item.target_ref||'Unknown',rationale:item.rationale||'coordination review',candidateIds:cleanArray(item.candidate_worker_ids),source:'Chief of Staff'})),...staffingCandidates.map(item=>({type:item.kind||'staffing_candidate',target:item.assignment_id||item.mission_team_id||'workforce',rationale:item.reason||'staffing pressure',candidateIds:cleanArray(item.ranked_candidates).slice(0,3).map(x=>x?.worker_id).filter(Boolean),source:'Dynamic staffing'}))].slice(0,10);
      recommendationRoot.innerHTML=combined.length?combined.map(item=>`<article class="workforce-chief-item recommendation"><div><strong>${esc(String(item.type).replaceAll('_',' '))}</strong><span>${esc(item.source)} · ${esc(item.target)}</span></div><small>${esc(item.rationale)}${item.candidateIds.length?` · candidates ${esc(item.candidateIds.join(', '))}`:''}</small><b>Proposal only</b></article>`).join(''):'<div class="workforce-chief-empty">No governed coordination recommendations.</div>';
    }
    const badge=document.getElementById('titan-wf-chief-state');
    const criticalEscalations=escalations.filter(item=>['critical','high'].includes(normalizeState(item?.severity))).length;
    if(badge){const status=criticalEscalations?'critical':(gaps.length||overlaps.length||staffingPressure||overloaded.length||escalations.length?'attention':'ok');badge.dataset.state=status;badge.textContent=status==='critical'?'Critical attention':status==='attention'?'Needs coordination':'Coordinated';}
    return {responsibility_gaps:gaps.length,responsibility_overlaps:overlaps.length,open_escalations:escalations.length,staffing_pressure:staffingPressure,priority_count:priorities.length,recommendation_count:recommendations.length+staffingCandidates.length,overloaded_workers:overloaded.length,recommendations_execute_automatically:false,grants_authority:false};
  }

  function renderUnifiedOrganizationView(){
    const root=document.getElementById('titan-wf-organization-tree');
    if(!root) return null;
    const workforce=state.unifiedWorkforce||{};
    const graph=state.projection?.workforce_graph||{};
    const workers=cleanArray(workforce.workers).filter(worker=>!worker?.company_id||worker.company_id===state.company_id);
    const summary=workforce.summary||{};
    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value)};
    const humanCount=Number(summary.human_workers??workers.filter(w=>String(w?.identity_kind||'').toUpperCase()==='HUMAN').length);
    const aiCount=Number(summary.advanced_intelligence_workers??workers.filter(w=>String(w?.identity_kind||'').toUpperCase()==='ADVANCED_INTELLIGENCE').length);
    set('titan-wf-org-total',Number(summary.worker_count??workers.length));
    set('titan-wf-org-human',humanCount);
    set('titan-wf-org-ai',aiCount);
    set('titan-wf-org-mixed',Number(summary.mixed_mission_teams??0));

    const filter=organizationIdentityFilter;
    const visible=workers.filter(worker=>{
      const kind=String(worker?.identity_kind||'UNKNOWN').toUpperCase();
      if(filter==='human') return kind==='HUMAN';
      if(filter==='advanced_intelligence') return kind==='ADVANCED_INTELLIGENCE';
      return true;
    });
    if(typeof document.querySelectorAll==='function') document.querySelectorAll('[data-workforce-identity-filter]').forEach(button=>button.classList.toggle('active',button.dataset.workforceIdentityFilter===filter));
    if(!workers.length){
      root.innerHTML='<div class="workforce-organization-empty">No unified Workforce snapshot is available for this company yet.</div>';
      return {worker_count:0,human_workers:0,advanced_intelligence_workers:0,grants_authority:false};
    }

    const byId=new Map(workers.map(worker=>[String(worker?.worker_id||''),worker]).filter(([id])=>id));
    const workerName=id=>byId.get(String(id))?.display_name||byId.get(String(id))?.name||String(id||'Unknown worker');
    const depthCache=new Map();
    const depthFor=(worker,trail=new Set())=>{
      const id=String(worker?.worker_id||'');if(depthCache.has(id))return depthCache.get(id);if(!id||trail.has(id)){depthCache.set(id,0);return 0;}
      const parent=cleanArray(worker?.supervisor_worker_ids).map(String).find(ref=>byId.has(ref));if(!parent){depthCache.set(id,0);return 0;}
      const next=new Set(trail);next.add(id);const depth=Math.min(8,1+depthFor(byId.get(parent),next));depthCache.set(id,depth);return depth;
    };
    const roleLabel=worker=>cleanArray(worker?.role_ids).length?cleanArray(worker.role_ids).slice(0,3).map(String).join(' · '):'Role not assigned';
    const capacityLabel=worker=>{
      const capacity=worker?.capacity||{};
      const status=String(capacity?.state||capacity?.status||'').trim();
      if(status) return status.replaceAll('_',' ');
      const pct=Number(capacity?.utilization_percent??capacity?.utilisation_percent);
      return Number.isFinite(pct)?`${Math.round(pct)}% utilized`:'Capacity not loaded';
    };
    const kindMeta=worker=>{
      const kind=String(worker?.identity_kind||'UNKNOWN').toUpperCase();
      if(kind==='HUMAN') return {label:'Human',css:'human',identity:worker?.human_identity_ref||'Human identity retained'};
      if(kind==='ADVANCED_INTELLIGENCE') return {label:'Advanced Intelligence',css:'advanced-intelligence',identity:worker?.ai_identity_ref||worker?.ai_runtime_ref||'AI identity retained'};
      return {label:'Identity unresolved',css:'unknown',identity:'Identity kind requires review'};
    };
    const workerCard=worker=>{
      const id=String(worker?.worker_id||'');
      const meta=kindMeta(worker);
      const assignmentCount=cleanArray(worker?.assignment_ids).length;
      const supervisorNames=cleanArray(worker?.supervisor_worker_ids).map(workerName).filter(Boolean);
      const authorityRef=String(worker?.effective_authority_ref||'').trim();
      const authorityText=authorityRef?`Policy ref: ${esc(authorityRef)}`:'No effective authority reference loaded';
      const identityDetail=meta.css==='human'?(worker?.employment_status?`${esc(worker.employment_status)} · ${esc(meta.identity)}`:esc(meta.identity)):(worker?.ai_runtime_ref?`${esc(meta.identity)} · runtime ${esc(worker.ai_runtime_ref)}`:esc(meta.identity));
      return `<article id="titan-wf-org-worker-${esc(id)}" class="workforce-org-worker-node" data-identity-kind="${meta.css}" data-worker-id="${esc(id)}" data-org-depth="${depthFor(worker)}"><div class="workforce-org-card"><div class="workforce-org-card-head"><div><strong>${esc(worker?.display_name||worker?.name||id||'Unnamed worker')}</strong><span>${esc(roleLabel(worker))}</span></div><span class="workforce-identity-badge" data-kind="${meta.css}">${esc(meta.label)}</span></div><div class="workforce-org-meta"><span>${supervisorNames.length?`Reports to ${esc(supervisorNames.join(', '))}`:'Top-level / no supervisor loaded'}</span><span>${assignmentCount} assignment${assignmentCount===1?'':'s'}</span><span>${esc(capacityLabel(worker))}</span></div><div class="workforce-org-separation"><span>${identityDetail}</span><span>${authorityText}</span><strong>Identity and role do not grant authority</strong></div></div></article>`;
    };

    const reports=new Map();
    for(const edge of cleanArray(graph?.edges)){
      if(edge?.type!=='REPORTS_TO') continue;
      const child=String(edge?.from||'').replace(/^worker:/,'');
      const parent=String(edge?.to||'').replace(/^worker:/,'');
      if(!byId.has(child)||!byId.has(parent)) continue;
      const list=reports.get(parent)||[]; if(!list.includes(child)) list.push(child); reports.set(parent,list);
    }
    for(const worker of workers){
      const child=String(worker?.worker_id||'');
      for(const parent of cleanArray(worker?.supervisor_worker_ids).map(String)){
        if(!child||!byId.has(parent)) continue;
        const list=reports.get(parent)||[];if(!list.includes(child))list.push(child);reports.set(parent,list);
      }
    }
    for(const [parent,list] of reports) list.sort((a,b)=>workerName(a).localeCompare(workerName(b)));

    const activeTeamStates=new Set(['FORMING','ACTIVE','HANDOVER']);
    const teams=cleanArray(state.missionTeams).filter(team=>(!team?.company_id||team.company_id===state.company_id)&&activeTeamStates.has(String(team?.state||'').toUpperCase()));
    const teamsBySupervisor=new Map();
    for(const team of teams){
      const supervisor=String(team?.supervisor_worker_id||team?.coordinator_worker_id||'');
      const list=teamsBySupervisor.get(supervisor)||[];list.push(team);teamsBySupervisor.set(supervisor,list);
    }
    const renderTeam=team=>{
      const teamId=String(team?.mission_team_id||team?.team_id||'mission-team');
      const memberIds=cleanArray(team?.members).map(member=>String(member?.worker_id||member)).filter(id=>byId.has(id));
      const memberCards=memberIds.filter(id=>visible.includes(byId.get(id))).map(id=>workerCard(byId.get(id))).join('');
      const objectives=cleanArray(team?.objectives).slice(0,2).map(String).join(' · ');
      return `<details class="workforce-hierarchy-team" data-hierarchy-node="team" open><summary><span><strong>${esc(team?.name||teamId)}</strong><small>${esc(String(team?.state||'ACTIVE'))} · ${memberIds.length} member${memberIds.length===1?'':'s'}${objectives?` · ${esc(objectives)}`:''}</small></span><span>Mission team</span></summary><div class="workforce-hierarchy-children">${memberCards||'<div class="workforce-hierarchy-empty">No team members match the current identity filter.</div>'}</div></details>`;
    };
    const rendered=new Set();
    const renderReportTree=(id,trail=new Set())=>{
      if(trail.has(id)||!byId.has(id)) return '';
      const worker=byId.get(id); if(!visible.includes(worker)) return '';
      rendered.add(id);
      const next=new Set(trail);next.add(id);
      const childHtml=cleanArray(reports.get(id)).map(child=>renderReportTree(child,next)).filter(Boolean).join('');
      return `${workerCard(worker)}${childHtml?`<div class="workforce-hierarchy-report-children">${childHtml}</div>`:''}`;
    };

    const supervisorIds=new Set(cleanArray(state.supervisorCoordination).map(record=>String(record?.supervisor_worker_id||'')).filter(id=>byId.has(id)));
    for(const [parent] of reports) supervisorIds.add(parent);
    for(const team of teams){const supervisor=String(team?.supervisor_worker_id||'');if(byId.has(supervisor))supervisorIds.add(supervisor);}
    const chief=state.chiefOfStaffCoordination||{};
    const chiefWorkerId=String(chief?.chief_of_staff_worker_id||'');
    if(byId.has(chiefWorkerId)) supervisorIds.delete(chiefWorkerId);
    const supervisorSections=[...supervisorIds].sort((a,b)=>workerName(a).localeCompare(workerName(b))).map(id=>{
      const supervisor=byId.get(id);
      if(!visible.includes(supervisor)&&filter!=='all'){
        const hasVisibleReports=cleanArray(reports.get(id)).some(child=>visible.includes(byId.get(child)));
        const hasVisibleTeam=cleanArray(teamsBySupervisor.get(id)).some(team=>cleanArray(team?.members).some(member=>visible.includes(byId.get(String(member?.worker_id||member)))));
        if(!hasVisibleReports&&!hasVisibleTeam) return '';
      }
      rendered.add(id);
      const teamHtml=cleanArray(teamsBySupervisor.get(id)).map(renderTeam).join('');
      const childHtml=cleanArray(reports.get(id)).map(child=>renderReportTree(child,new Set([id]))).filter(Boolean).join('');
      return `<details class="workforce-hierarchy-supervisor" data-hierarchy-node="supervisor" open><summary><span><strong>${esc(workerName(id))}</strong><small>${esc(roleLabel(supervisor))} · ${cleanArray(reports.get(id)).length} direct report${cleanArray(reports.get(id)).length===1?'':'s'} · ${cleanArray(teamsBySupervisor.get(id)).length} mission team${cleanArray(teamsBySupervisor.get(id)).length===1?'':'s'}</small></span><span>Supervisor</span></summary><div class="workforce-hierarchy-children">${visible.includes(supervisor)?workerCard(supervisor):''}${teamHtml}${childHtml||(!teamHtml?'<div class="workforce-hierarchy-empty">No visible reports or mission teams.</div>':'')}</div></details>`;
    }).filter(Boolean).join('');
    const orphanHtml=visible.filter(worker=>!rendered.has(String(worker?.worker_id||''))).map(worker=>{rendered.add(String(worker?.worker_id||''));return workerCard(worker)}).join('');
    const chiefName=chiefWorkerId&&byId.has(chiefWorkerId)?workerName(chiefWorkerId):'Chief of Staff';
    const chiefMeta=`${Number(chief?.supervisor_count??supervisorIds.size)} supervisors · ${Number(chief?.active_mission_team_count??teams.length)} active mission teams · ${cleanArray(chief?.consolidated_escalations).length} escalations`;
    root.innerHTML=`<details class="workforce-hierarchy-chief" data-hierarchy-node="chief" open><summary><span><strong>${esc(chiefName)}</strong><small>${esc(chiefMeta)}</small></span><span>Coordination root</span></summary><div class="workforce-hierarchy-children">${chiefWorkerId&&visible.includes(byId.get(chiefWorkerId))?workerCard(byId.get(chiefWorkerId)):''}${supervisorSections}${orphanHtml?`<details class="workforce-hierarchy-unassigned" data-hierarchy-node="unassigned" open><summary><span><strong>Top-level / unassigned</strong><small>${visible.filter(worker=>!cleanArray(worker?.supervisor_worker_ids).length).length} workers without a loaded supervisor</small></span><span>Review</span></summary><div class="workforce-hierarchy-children">${orphanHtml}</div></details>`:''}</div></details>`;
    const path=document.getElementById('titan-wf-hierarchy-path');if(path)path.textContent=`${chiefName} → ${supervisorIds.size} supervisors → ${teams.length} active teams → ${visible.length} visible workers`;
    return {worker_count:workers.length,visible_workers:visible.length,human_workers:humanCount,advanced_intelligence_workers:aiCount,mixed_mission_teams:Number(summary.mixed_mission_teams??0),supervisor_count:supervisorIds.size,active_mission_teams:teams.length,hierarchy_source:'canonical-workforce-graph',identity_confers_authority:false,same_role_does_not_equal_same_authority:true,grants_authority:false};
  }

  function createControlIntent(action,target_ref,detail={}){
    return {
      intent_id:uid('workforce-intent'),
      schema:'titan.client.workforce.control-intent.v1',
      company_id:state.company_id,
      action,
      target_ref:String(target_ref||''),
      state:'prepared',
      grants_authority:false,
      auto_execute:false,
      created_at:new Date().toISOString(),
      ...detail
    };
  }

  async function proposeRoleActivation(role,reason='Owner requested workforce role review from Titan Zero'){
    if(!role?.role_definition_id) throw new Error('Role definition is required');
    if(proposedRoleIds().has(role.role_definition_id)) return null;
    const intent=createControlIntent('propose_role_activation',role.role_definition_id,{role_name:role.name});
    const proposal={
      proposal_id:uid('activation-proposal'),
      schema:'titan.workforce.role-activation-proposal.v1',
      company_id:state.company_id,
      role_definition_id:role.role_definition_id,
      reason,
      evidence_refs:[`owner_control_intent:${intent.intent_id}`],
      required_provider_capabilities:[],
      approval_required:true,
      auto_activate:false,
      state:'proposed',
      grants_authority:false,
      created_at:new Date().toISOString()
    };
    state.proposals=[...state.proposals,proposal];
    state.intents=[...state.intents,intent];
    state.allProposals=[...state.allProposals.filter(x=>x?.company_id!==state.company_id),...state.proposals];
    state.allIntents=[...state.allIntents.filter(x=>x?.company_id!==state.company_id),...state.intents];
    await chrome.storage.local.set({[KEYS.activationProposals]:state.allProposals,[KEYS.controlIntents]:state.allIntents});
    window.dispatchEvent(new CustomEvent('titan-workforce-control-intent',{detail:intent}));
    window.titanDiagWrite?.('info','client-workforce','Prepared role activation proposal',{company_id:state.company_id,role_definition_id:role.role_definition_id,proposal_id:proposal.proposal_id});
    render();
    return proposal;
  }

  async function proposeTemplate(templateId){
    const template=templates.find(x=>x.template_id===templateId);
    if(!template) return [];
    const rolesById=Object.fromEntries((catalogue?.roles||[]).map(r=>[r.role_definition_id,r]));
    const created=[];
    for(const id of template.roles||[]){
      const role=rolesById[id];
      if(!role) continue;
      const proposal=await proposeRoleActivation(role,`Owner requested review of client team template: ${template.name}`);
      if(proposal) created.push(proposal);
    }
    return created;
  }

  async function prepareWorkerControl(action,targetRef,label){
    if(!['request_pause','request_resume','request_assignment_review'].includes(action)) throw new Error('Unsupported workforce control action');
    const intent=createControlIntent(action,targetRef,{label:String(label||targetRef)});
    state.intents=[...state.intents,intent];
    state.allIntents=[...state.allIntents.filter(x=>x?.company_id!==state.company_id),...state.intents];
    await chrome.storage.local.set({[KEYS.controlIntents]:state.allIntents});
    window.dispatchEvent(new CustomEvent('titan-workforce-control-intent',{detail:intent}));
    render();
    return intent;
  }

  const projectionComponents=['workforce_profile','roster','assignments','approval_waits','escalations','handover','change_requests'];
  const projectionDigest=value=>JSON.stringify(value??null);
  function compareProjectionComponent(existingMeta={},incomingMeta={},existingValue,incomingValue){
    const er=existingMeta?.revision===null||existingMeta?.revision===undefined||existingMeta?.revision===''?null:(Number.isSafeInteger(Number(existingMeta.revision))?Number(existingMeta.revision):null);
    const ir=incomingMeta?.revision===null||incomingMeta?.revision===undefined||incomingMeta?.revision===''?null:(Number.isSafeInteger(Number(incomingMeta.revision))?Number(incomingMeta.revision):null);
    const ec=String(existingMeta?.cursor||'')||null,ic=String(incomingMeta?.cursor||'')||null;
    if(er!==null&&ir===null)return {accept:false,status:'STALE_UNVERSIONED_AFTER_VERSIONED'};
    if(er!==null&&ir!==null){
      if(ir<er)return {accept:false,status:'STALE_REVISION'};
      if(ir===er){
        if(ec&&ic&&ec!==ic)return {accept:false,status:'REVISION_CURSOR_CONFLICT'};
        if(projectionDigest(existingValue)!==projectionDigest(incomingValue))return {accept:false,status:'EQUAL_REVISION_DATA_CONFLICT'};
        return {accept:false,status:'IDEMPOTENT_EQUAL_REVISION'};
      }
    }
    return {accept:true,status:'ADVANCE'};
  }
  async function ingestManagerProjection(payload={}){
    const company_id=String(payload.company_id||'').trim();
    if(!validCompanyId(company_id)||company_id!==state.company_id) throw new Error('Cross-company workforce projection rejected');
    const existing=await chrome.storage.local.get([KEYS.managerProjection]);
    const raw=existing[KEYS.managerProjection];
    const projectionStore=raw?.company_id?{[raw.company_id]:raw}:{...(raw||{})};
    const previous=projectionStore[company_id]&&typeof projectionStore[company_id]==='object'?projectionStore[company_id]:null;
    const incomingGeneration=Number(payload.sync_generation||0),previousGeneration=Number(previous?.sync_generation||0);
    const incomingStarted=Number(payload.sync_started_at_ms||0),previousStarted=Number(previous?.sync_started_at_ms||0);
    if(previous&&incomingGeneration>0&&(incomingGeneration<previousGeneration||(incomingGeneration===previousGeneration&&incomingStarted>0&&incomingStarted<previousStarted)))throw new Error('Stale workforce projection sync rejected');
    const normalized={
      workforce_profile:payload.workforce_profile?.company_id===company_id?payload.workforce_profile:null,
      roster:cleanArray(payload.roster).filter(x=>!x?.company_id||sameCompany(x,company_id)),
      assignments:cleanArray(payload.assignments).filter(x=>sameCompany(x,company_id)),
      approval_waits:cleanArray(payload.approval_waits).filter(x=>sameCompany(x,company_id)),
      escalations:cleanArray(payload.escalations).filter(x=>sameCompany(x,company_id)),
      handover:payload.handover?.company_id===company_id?payload.handover:null,
      change_requests:cleanArray(payload.change_requests).filter(x=>!x?.company_id||sameCompany(x,company_id))
    };
    const incomingMeta=payload.component_cursors&&typeof payload.component_cursors==='object'?payload.component_cursors:{};
    const previousMeta=previous?.component_cursors&&typeof previous.component_cursors==='object'?previous.component_cursors:{};
    const partial=payload.partial===true;
    const includedComponents=new Set(partial?(Array.isArray(payload.components)?payload.components.filter(x=>projectionComponents.includes(x)):Object.keys(incomingMeta).filter(x=>projectionComponents.includes(x))):projectionComponents);
    const merged={},component_cursors={...previousMeta},component_status={};
    for(const component of projectionComponents){
      if(partial&&!includedComponents.has(component)){merged[component]=previous?.[component]??normalized[component];component_status[component]='UNCHANGED_NOT_IN_EVENT';continue;}
      const decision=previous?compareProjectionComponent(previousMeta[component],incomingMeta[component],previous[component],normalized[component]):{accept:true,status:'INITIAL'};
      component_status[component]=decision.status;
      if(decision.status==='REVISION_CURSOR_CONFLICT'||decision.status==='EQUAL_REVISION_DATA_CONFLICT')throw new Error(`Workforce projection conflict: ${component}:${decision.status}`);
      if(decision.accept||!previous){merged[component]=normalized[component];component_cursors[component]=incomingMeta[component]||{revision:null,cursor:null,versioned:false,grants_authority:false};}
      else merged[component]=previous[component];
    }
    const projection={
      schema:'titan.client.workforce.manager-projection.v2',company_id,...merged,
      projection_revision:Number.isSafeInteger(Number(payload.projection_revision))?Number(payload.projection_revision):Number(previous?.projection_revision||0),
      projection_cursor:String(payload.projection_cursor||previous?.projection_cursor||'')||null,
      sync_generation:Math.max(incomingGeneration,previousGeneration),sync_started_at_ms:Math.max(incomingStarted,previousStarted),
      component_cursors,component_status,projected_at:String(payload.projected_at||new Date().toISOString()),grants_authority:false
    };
    try{
      const gateway=await ensureGatewayRuntime();
      projection.workforce_graph=await gateway.buildWorkforceGraph(projection);
    }catch(error){
      projection.workforce_graph=previous?.workforce_graph?.company_id===company_id?previous.workforce_graph:null;
      window.titanDiagWrite?.('warn','client-workforce','Workforce graph derivation unavailable',{company_id,message:String(error?.message||error)});
    }
    projectionStore[company_id]=projection;
    await chrome.storage.local.set({[KEYS.managerProjection]:projectionStore});
    await loadState();render();return projection;
  }

  function renderSummary(){
    renderLiveActivityStrip();
    renderUnifiedCommandDashboard();
    const observed=observedRoleIds();
    const pending=state.proposals.filter(x=>x.state==='proposed');
    const assignments=state.projection.assignments.filter(x=>['proposed','assigned'].includes(x.state||x.decision_state));
    const approvals=state.projection.approval_waits.filter(x=>(x.state||'waiting')==='waiting');
    const escalations=state.projection.escalations.filter(x=>['open','acknowledged'].includes(x.state||'open'));
    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value)};
    set('titan-wf-summary-observed',observed.size);
    set('titan-wf-summary-proposals',pending.length);
    set('titan-wf-summary-assignments',assignments.length);
    set('titan-wf-summary-approvals',approvals.length);
    set('titan-wf-summary-escalations',escalations.length);
  }

  function renderTemplates(){
    const select=document.getElementById('titan-wf-template');
    if(!select||select.dataset.loaded==='1') return;
    for(const t of templates){
      const option=document.createElement('option');
      option.value=t.template_id;
      option.textContent=`${t.name} (${(t.roles||[]).length})`;
      select.appendChild(option);
    }
    select.dataset.loaded='1';
  }

  function filteredRoles(){
    const q=String(document.getElementById('titan-wf-role-search')?.value||'').trim().toLowerCase();
    const filter=document.getElementById('titan-wf-role-filter')?.value||'all';
    const observed=observedRoleIds(), proposed=proposedRoleIds();
    return (catalogue?.roles||[]).filter(role=>{
      if(filter==='observed'&&!observed.has(role.role_definition_id)) return false;
      if(filter==='proposed'&&!proposed.has(role.role_definition_id)) return false;
      if(!q) return true;
      const hay=[role.name,role.role_definition_id,role.division_key,role.purpose,...(role.operational_domains||[])].join(' ').toLowerCase();
      return hay.includes(q);
    }).slice(0,60);
  }

  function renderRoles(){
    const list=document.getElementById('titan-wf-role-list');
    if(!list) return;
    const observed=observedRoleIds(), proposed=proposedRoleIds();
    const roles=filteredRoles();
    list.innerHTML='';
    if(!roles.length){list.innerHTML='<div class="workforce-control-empty">No roles match this filter.</div>';return;}
    for(const role of roles){
      const row=document.createElement('div');
      row.className='workforce-role-row';
      const isProposed=proposed.has(role.role_definition_id);
      const isObserved=observed.has(role.role_definition_id);
      row.innerHTML=`<div><strong>${esc(role.name)}</strong><small>${esc(role.division_key||'workforce')} · ${esc(role.role_definition_id)}</small></div><button class="workforce-role-action" ${isProposed?'disabled':''}>${isProposed?'Proposed':'Propose role'}</button><p>${esc(role.purpose||'Operational client workforce role.')}</p><div class="workforce-role-badges"><span>risk ${esc(role.risk_ceiling||'UNKNOWN')}</span><span>${isObserved?'observed':'not observed'}</span><span>activation ≠ authority</span></div>`;
      row.querySelector('button')?.addEventListener('click',()=>proposeRoleActivation(role).catch(error=>window.titanDiagWrite?.('error','client-workforce','Role proposal failed',{message:error.message,company_id:state.company_id})));
      list.appendChild(row);
    }
  }

  function setDeploymentStage(stage,stateCode,title,detail){
    const article=document.querySelector?.(`[data-deploy-stage="${stage}"]`)||null;
    const titleEl=document.getElementById(`titan-wf-deploy-${stage}`);
    const detailEl=document.getElementById(`titan-wf-deploy-${stage}-detail`);
    if(article) article.dataset.state=stateCode||'review';
    if(titleEl) titleEl.textContent=title;
    if(detailEl) detailEl.textContent=detail;
  }

  function renderDeploymentConsole(){
    if(!document.getElementById('titan-wf-deployment-console')) return;
    const blockers=[];
    const p=state.installationPlan;
    if(p){const b=cleanArray(p.readiness?.blockers);blockers.push(...b.map(x=>`plan: ${x}`));setDeploymentStage('plan',b.length?'blocked':'ready',`${p.state||'UNKNOWN'} · ${p.readiness?.total_steps||0} steps`,`${p.readiness?.governed_change_steps||0} governed changes · ${p.readiness?.verification_steps||0} verification steps`);}else setDeploymentStage('plan','review','Not prepared','Business discovery must be complete before an installation plan is prepared.');
    const g=state.commissioningGates;
    if(g){const b=cleanArray(g.readiness?.blockers);blockers.push(...b.map(x=>`commissioning: ${x}`));const passed=Number(g.readiness?.passed_gates||0), required=Number(g.readiness?.required_gates||0);setDeploymentStage('gates',b.length?'blocked':(required&&passed>=required?'ready':'review'),`${g.state||'UNKNOWN'} · ${passed}/${required} passed`,`${b.length} blockers · evidence-backed · no automatic go-live`);}else setDeploymentStage('gates','review','Not evaluated','Commissioning gates appear once an installation plan is available.');
    const h=state.liveHostCertification;
    if(h){const b=cleanArray(h.readiness?.blockers);blockers.push(...b.map(x=>`host: ${x}`));const certified=h.readiness?.live_host_certified===true;setDeploymentStage('host',certified?'ready':(b.length?'blocked':'review'),certified?'Certified':`${h.state||'NOT CERTIFIED'}`,`${h.readiness?.passed_probes||0}/${h.readiness?.required_probes||0} probes passed · ${b.length} blockers`);}else setDeploymentStage('host','review','Not certified','Use Probe live host after commissioning evidence is available.');
    const e=state.endToEndCertification;if(e){const b=cleanArray(e.readiness?.blockers);blockers.push(...b.map(x=>`e2e: ${x}`));setDeploymentStage('e2e',e.state==='PASS'?'ready':(e.state==='BLOCKED'?'blocked':'review'),e.state||'UNKNOWN',`${e.summary?.passed||0}/${e.summary?.total||0} checks passed · live Laravel ${e.readiness?.live_laravel_certified?'certified':'not certified'}`);}else setDeploymentStage('e2e','review','Not certified','Run/refresh certification after deployment evidence is available.');
    const browser=state.browserLiveSmokeCertification;if(browser){const b=cleanArray(browser.readiness?.blockers);blockers.push(...b.map(x=>`browser: ${x}`));setDeploymentStage('browser',browser.state==='PASS'?'ready':'blocked',browser.state||'UNKNOWN',`${browser.summary?.passed||0}/${browser.summary?.total||0} browser smoke checks passed`);}else setDeploymentStage('browser','review','Not certified','Run live-smoke in an extension-enabled Chromium session.');
    const cv=state.crossVersionCompatibility;if(cv){const b=cleanArray(cv.compatibility?.blockers);blockers.push(...b.map(x=>`version: ${x}`));setDeploymentStage('rollback',b.length?'blocked':'ready',`${cv.direction||'UNKNOWN'} · ${cv.source_version||'?'} → ${cv.target_version||'?'}`,`${cv.rollback?.exact_reconstruction_required?'exact reconstruction required':'reconstruction not asserted'} · fresh authority required after transition`);}
    const m=state.migrationUpgradeSafety;
    if(m){const b=cleanArray(m.readiness?.blockers);blockers.push(...b.map(x=>`upgrade: ${x}`));setDeploymentStage('upgrade',b.length?'blocked':(m.phase==='COMPLETED'?'ready':'review'),`${m.phase||'UNKNOWN'} · ${m.source_version||'?'} → ${m.target_version||'?'}`,`${m.readiness?.migration_count||0} migrations · ${m.recovery?.interrupted_upgrade_detected?'recovery review required':'idempotent checkpointing'}`);}else setDeploymentStage('upgrade','review','No checkpoint','No governed migration/upgrade checkpoint is currently stored for this company.');
    const u=state.uninstallReversibility;
    if(u){const b=cleanArray(u.readiness?.blockers);blockers.push(...b.map(x=>`rollback: ${x}`));setDeploymentStage('rollback',b.length?'blocked':(u.phase==='COMPLETED'||u.phase==='ROLLED_BACK'?'ready':'review'),`${u.phase||'UNKNOWN'} · ${u.readiness?.action_count||0} actions`,`${u.readiness?.protected_action_count||0} protected · evidence/audit/authority history preserved`);}else setDeploymentStage('rollback','review','Not prepared','No uninstall/reversibility plan is currently stored for this company.');
    const box=document.getElementById('titan-wf-deployment-blockers');
    if(box){box.innerHTML='';const values=blockers.length?blockers:['No current deployment blockers were reported by the loaded records.'];for(const item of values.slice(0,16)){const span=document.createElement('span');span.className=blockers.length?'blocker':'';span.textContent=item;box.appendChild(span);}}
  }

  async function probeDeploymentHost(){
    const gateway=await ensureGatewayRuntime();
    if(!state.commissioningGates) throw new Error('commissioning-gates-required-before-live-host-probe');
    const result=await gateway.probeLiveLaravelHostCertification({commissioning_gates:state.commissioningGates});
    state.liveHostCertification=result?.record||result||null;
    renderDeploymentConsole();renderQueue();
    window.titanDiagWrite?.('info','client-workforce','Refreshed live Laravel deployment certification',{company_id:state.company_id,certified:state.liveHostCertification?.readiness?.live_host_certified===true,grants_authority:false});
    return state.liveHostCertification;
  }

  function renderQueue(){
    const box=document.getElementById('titan-wf-control-queue');
    if(!box) return;
    const items=[];
    for(const a of state.projection.assignments){
      items.push({kind:'Assignment',title:a.work_item_id||a.assignment_id||'Work assignment',detail:`${a.worker_id||'worker pending'} · ${a.decision_state||a.state||'proposed'}`});
    }
    for(const a of state.projection.approval_waits){
      items.push({kind:'Approval',title:a.approval_class||a.work_item_id||'Approval required',detail:a.state||'waiting'});
    }
    for(const e of state.projection.escalations){
      items.push({kind:'Escalation',title:e.reason||e.work_item_id||'Escalated work',detail:`${e.severity||'unknown'} · ${e.state||'open'}`});
    }
    for(const member of state.projection.roster.slice(0,12)){
      items.push({kind:'Roster',title:member.name||member.role_name||member.actor_id||member.worker_id||'Workforce member',detail:`${member.role_definition_id||member.role||'role'} · ${member.state||member.status||'active'}`});
    }
    if(state.projection.handover) items.push({kind:'Handover',title:state.projection.handover.client_workforce_handover_id||'Installed workforce handover',detail:state.projection.handover.state||state.projection.handover.status||'active'});
    for(const team of cleanArray(state.missionTeams).slice(0,8)){items.push({kind:'Mission team',title:team.name||team.mission_team_id||'Mission team',detail:`${team.state||'DRAFT'} · ${team.members?.length||0} members · authority-neutral`});}
    for(const sup of cleanArray(state.supervisorCoordination).slice(0,8)){items.push({kind:'Supervisor scope',title:sup.supervisor_worker_id||'Supervisor',detail:`${sup.scope?.subordinate_worker_ids?.length||0} subordinates · ${sup.scope?.mission_teams?.length||0} mission teams · ${sup.escalations?.filter?.(x=>!['closed','resolved'].includes(x.state))?.length||0} escalations · authority-neutral`});}
    if(state.chiefOfStaffCoordination){const c=state.chiefOfStaffCoordination;items.push({kind:'Chief-of-Staff',title:`${c.responsibility_gaps?.length||0} gaps · ${c.responsibility_overlaps?.length||0} overlaps`,detail:`${c.consolidated_escalations?.length||0} escalations · ${c.priorities?.length||0} priorities · recommendations only`});}
    if(state.decisionRightsPolicy){items.push({kind:'Decision rights',title:`Policy ${state.decisionRightsPolicy.policy_id||'workforce-default'} · rev ${state.decisionRightsPolicy.revision||1}`,detail:`${state.decisionRightsPolicy.rules?.length||0} explicit rules · no execute right · authority-neutral`});}
    if(state.skillCapabilityRegistry){const c=state.skillCapabilityRegistry.summary||{};items.push({kind:'Skills + capabilities',title:`${c.verified_capabilities||0} verified · ${c.coverage_gaps||0} coverage gaps`,detail:`${c.worker_capability_count||0} worker capabilities · ${c.expired_capabilities||0} expired · capability ≠ authority`});}
    if(state.workloadCapacity){const c=state.workloadCapacity.summary||{};items.push({kind:'Capacity',title:`${c.overloaded_workers||0} overloaded · ${c.under_capacity_workers||0} under capacity`,detail:`${Math.round((c.utilization||0)*100)}% utilization · ${c.capability_bottlenecks||0} capability bottlenecks · recommendations only`});}
    if(state.performanceOutcomes){const c=state.performanceOutcomes.summary||{};items.push({kind:'Performance evidence',title:`${c.evidence_backed_records||0} evidenced outcomes · ${c.workers_with_evidence||0} workers`,detail:`${c.corrections||0} corrections · evidence confidence is separate from score · performance ≠ authority`});}
    if(state.dynamicStaffing){const c=state.dynamicStaffing.summary||{};items.push({kind:'Dynamic staffing',title:`${c.candidate_groups||0} candidate groups · ${c.unfilled_staffing_gaps||0} gaps`,detail:`${c.assignment_rebalance_candidates||0} rebalance · ${c.mission_staffing_candidates||0} mission · proposal-only`});}
    if(state.improvementProposals){const c=state.improvementProposals.summary||{};items.push({kind:'Improvement proposals',title:`${c.proposal_count||0} proposals · ${c.high_priority||0} high priority`,detail:`${c.quality_reviews||0} quality · ${c.capability_reviews||0} capability · ${c.workload_reviews||0} workload · review-only`});}
    if(state.investigationInstallationHandover){const h=state.investigationInstallationHandover;const c=h.readiness||{};items.push({kind:'Investigation handover',title:`${c.state||'UNKNOWN'} · ${c.finding_count||0} findings`,detail:`${c.accepted_recommendations||0} accepted · ${c.unresolved_risks||0} unresolved risks · ${c.blockers?.length||0} blockers · governed installation only`});}
    if(state.businessDiscoverySpecification){const d=state.businessDiscoverySpecification;const c=d.completeness||{};const i=d.installation_spec?.install_components||{};items.push({kind:'Business discovery',title:`${c.state||'UNKNOWN'} · ${i.workflow_count||0} processes · ${i.system_count||0} systems`,detail:`${i.actor_count||0} people · ${i.capability_count||0} capabilities · ${c.blockers?.length||0} blockers · planning only`});}
    if(state.installationPlan){const p=state.installationPlan;items.push({kind:'Installation plan',title:`${p.state||'UNKNOWN'} · ${p.readiness?.total_steps||0} steps`,detail:`${p.readiness?.governed_change_steps||0} governed changes · ${p.readiness?.verification_steps||0} verification · ${p.readiness?.blockers?.length||0} blockers · no auto install`});}
    if(state.commissioningGates){const g=state.commissioningGates;items.push({kind:'Commissioning gates',title:`${g.state||'UNKNOWN'} · ${g.readiness?.passed_gates||0}/${g.readiness?.required_gates||0} passed`,detail:`${g.readiness?.blockers?.length||0} blockers · evidence-backed · no auto go-live`});}
    if(state.liveHostCertification){const c=state.liveHostCertification;items.push({kind:'Live Laravel host',title:`${c.state||'UNKNOWN'} · ${c.readiness?.passed_probes||0}/${c.readiness?.required_probes||0} probes`,detail:`${c.readiness?.blockers?.length||0} blockers · ${c.readiness?.live_host_certified?'host certified':'not live-certified'} · no authority granted`});}
    if(state.crossVersionCompatibility){const v=state.crossVersionCompatibility;items.push({kind:'Version compatibility',title:`${v.direction||'UNKNOWN'} · ${v.source_version||'?'} → ${v.target_version||'?'}`,detail:`${v.compatibility?.blockers?.length||0} blockers · exact rollback reconstruction required · fresh authority after transition · no automatic rollback`});}
    if(state.migrationUpgradeSafety){const m=state.migrationUpgradeSafety;items.push({kind:'Upgrade safety',title:`${m.phase||'UNKNOWN'} · ${m.source_version||'?'} → ${m.target_version||'?'}`,detail:`${m.readiness?.migration_count||0} migrations · ${m.readiness?.blockers?.length||0} blockers · ${m.recovery?.interrupted_upgrade_detected?'recovery required':'idempotent upgrade'} · no authority change`});}
    if(state.uninstallReversibility){const u=state.uninstallReversibility;items.push({kind:'Uninstall safety',title:`${u.phase||'UNKNOWN'} · ${u.readiness?.action_count||0} reversible actions`,detail:`${u.readiness?.blockers?.length||0} blockers · preserves data/evidence/audit/authority history · no automatic uninstall`});}
    if(state.securityPosture){const s=state.securityPosture;items.push({kind:'Workforce security',title:`${s.state||'UNKNOWN'} · ${s.readiness?.secure_for_gateway_dispatch?'gateway hardened':'attention required'}`,detail:`${s.readiness?.blockers?.length||0} blockers · endpoint ${s.endpoint?.trusted?'trusted':'not trusted'} · replay+integrity enforced · authority never granted`});}
    if(state.privacyEvidenceControls){const p=state.privacyEvidenceControls;items.push({kind:'Privacy / evidence',title:`${p.readiness?.privacy_controls_ready?'READY':'BLOCKED'} · ${p.readiness?.evidence_count||0} evidence records`,detail:`${p.readiness?.sensitive_count||0} sensitive · ${p.readiness?.expired_count||0} expired · exports default deny · protected history preserved`});}
    if(state.intelligenceRouting){const r=state.intelligenceRouting;items.push({kind:'AI / BYO routing',title:`${r.readiness?.ready?'READY':'BLOCKED'} · deterministic/local first`,detail:`${r.providers?.filter?.(x=>x.local)?.length||0} local · ${r.providers?.filter?.(x=>x.byo)?.length||0} BYO · ${r.providers?.filter?.(x=>x.titan_variable_cost)?.length||0} Titan-cost routes · no silent paid fallback`});}
    if(state.knowledgeAuthority){const k=state.knowledgeAuthority;items.push({kind:'Knowledge authority',title:`${k.readiness?.ready?'READY':'BLOCKED'} · ${k.readiness?.knowledge_count||0} sources`,detail:`${k.readiness?.shared_public_count||0} shared/public · ${k.readiness?.company_private_count||0} company-private · ${k.readiness?.stale_or_unknown_count||0} stale/unknown · ${k.readiness?.contradicted_count||0} contradicted · knowledge is not authority`});}
    if(state.unifiedWorkforce){const u=state.unifiedWorkforce;items.push({kind:'Human + AI workforce',title:`${u.readiness?.ready?'READY':'BLOCKED'} · ${u.summary?.worker_count||0} workers`,detail:`${u.summary?.human_workers||0} human · ${u.summary?.advanced_intelligence_workers||0} Advanced Intelligence · ${u.summary?.mixed_mission_teams||0} mixed mission teams · same workforce fabric, separate identity/authority`});}
    if(state.externalActorBoundary){const x=state.externalActorBoundary;items.push({kind:'External actors',title:`${x.readiness?.ready?'READY':'BLOCKED'} · ${x.summary?.external_actor_count||0} external actors`,detail:`${x.summary?.customers||0} customers · ${x.summary?.suppliers||0} suppliers · ${x.summary?.contractors||0} contractors · scoped participation only, no internal authority`});}
    if(state.notificationEscalation){const n=state.notificationEscalation;items.push({kind:'Notifications / escalation',title:`${n.readiness?.ready?'READY':'BLOCKED'} · ${n.summary?.open_count||0} open · ${n.summary?.critical_open_count||0} critical`,detail:`${n.summary?.ack_pending_count||0} awaiting acknowledgement · ${n.summary?.suppressed_duplicate_count||0} duplicates suppressed · bounded escalation, no authority expansion`});}
    if(state.scheduleRecurrence){const r=state.scheduleRecurrence;items.push({kind:'Schedule / recurrence',title:`${r.readiness?.ready?'READY':'BLOCKED'} · ${r.summary?.enabled_count||0} enabled · ${r.summary?.due_schedule_count||0} due`,detail:'Recurring definitions create governed due instances only; schedule timing never grants authority or executes protected work.',tone:r.readiness?.ready?'ok':'warn'});}
    if(state.financialResourceGuardrails){const r=state.financialResourceGuardrails;items.push({kind:'Financial / resource guardrails',title:`${r.readiness?.ready?'READY':'BLOCKED'} · ${r.limits?.length||0} limits · ${r.summary?.over_limit_count||0} over limit`,detail:'Budgets and quotas can allow, require review, or deny resource use; being within budget never grants spend or execution authority.',tone:r.readiness?.ready?'ok':'warn'});}
    if(state.physicalEnvironmentalRisk){const r=state.physicalEnvironmentalRisk;items.push({kind:'Physical / environmental risk',title:`${r.readiness?.ready?'READY':'BLOCKED'} · ${r.summary?.open_count||0} open · ${r.summary?.critical_count||0} critical`,detail:`${r.summary?.high_or_critical_count||0} high/critical · ${r.summary?.environmental_count||0} environmental · risk review can block work but never grants authority`,tone:r.readiness?.ready?'ok':'warn'});}
    if(state.workerMemory){const m=state.workerMemory;items.push({kind:'Worker memory',title:`${m.readiness?.ready_for_recall?'READY':'NO ACTIVE MEMORY'} · ${m.readiness?.active_count||0}/${m.readiness?.memory_count||0} active`,detail:`worker ${m.worker_id||'?'} · ${m.readiness?.expired_count||0} expired · ${m.readiness?.superseded_count||0} superseded · context only, not truth or authority`});}
    if(state.projection.workforce_graph) items.push({kind:'Workforce graph',title:`${state.projection.workforce_graph.nodes?.length||0} nodes · ${state.projection.workforce_graph.edges?.length||0} relationships`,detail:`revision ${state.projection.workforce_graph.projection_revision||0} · derived, authority-neutral`});
    for(const change of state.projection.change_requests.slice(0,8)){
      items.push({kind:'Change request',title:change.title||change.reason||change.change_request_id||'Operational change',detail:change.state||change.status||'open'});
    }
    for(const i of state.intents.slice(-8).reverse()){
      items.push({kind:'Prepared control',title:i.label||i.target_ref||i.action,detail:`${i.action} · ${i.state}`});
    }
    box.innerHTML=items.length?items.slice(0,18).map(x=>`<div class="workforce-queue-item"><strong>${esc(x.kind)} · ${esc(x.title)}</strong><span>${esc(x.detail)}</span></div>`).join(''):'<div class="workforce-control-empty">No workforce manager activity has been projected yet.</div>';
  }

  let gatewayLoadPromise=null;
  function ensureGatewayPanel(){
    const host=document.getElementById('titan-client-workforce-controls');
    if(!host||document.getElementById('titan-wf-gateway-status')) return;
    const panel=document.createElement('section');
    panel.className='workforce-control-panel workforce-gateway-panel';
    panel.setAttribute('aria-label','Laravel client workforce connection');
    panel.innerHTML='<div class="workforce-control-head"><div><strong>Laravel workforce connection</strong><small>Sync the installed client workforce and submit prepared controls to the canonical Laravel extensions. This surface does not grant authority.</small></div><span id="titan-wf-gateway-status" class="workforce-gateway-badge">Not configured</span></div><div class="workforce-gateway-fields"><label>Gateway endpoint<input id="titan-wf-gateway-endpoint" type="url" placeholder="https://your-titan-app/api/titan/workforce/gateway/v1"></label><label>Realtime endpoint · optional<input id="titan-wf-gateway-realtime-endpoint" type="url" placeholder="https://your-titan-app/api/titan/workforce/events"></label><label>Poll fallback · seconds<input id="titan-wf-gateway-poll-seconds" type="number" min="10" max="300" step="5" value="30"></label><label>Client actor_id<input id="titan-wf-gateway-actor" type="text" placeholder="authenticated"></label><label>Gateway token<input id="titan-wf-gateway-token" type="password" placeholder="Optional scoped gateway token"></label></div><div class="workforce-control-toolbar workforce-gateway-toolbar"><button id="titan-wf-gateway-save">Save</button><button id="titan-wf-gateway-refresh">Sync Laravel</button><button id="titan-wf-gateway-submit">Submit Prepared Controls</button></div><div id="titan-wf-gateway-receipts" class="workforce-gateway-receipts"><div class="workforce-control-empty">No Laravel gateway receipts yet.</div></div>';
    host.prepend(panel);
  }

  function ensureGatewayRuntime(){
    if(window.TitanClientWorkforceGateway) return Promise.resolve(window.TitanClientWorkforceGateway);
    if(gatewayLoadPromise) return gatewayLoadPromise;
    gatewayLoadPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=chrome.runtime.getURL('titan-workforce-gateway-client.js');
      script.dataset.titanWorkforceGateway='1';
      script.addEventListener('load',()=>window.TitanClientWorkforceGateway?resolve(window.TitanClientWorkforceGateway):reject(new Error('Client Workforce Gateway unavailable')),{once:true});
      script.addEventListener('error',()=>reject(new Error('Client Workforce Gateway load failed')),{once:true});
      document.head.appendChild(script);
    });
    return gatewayLoadPromise;
  }

  async function renderGateway(){
    ensureGatewayPanel();
    const gateway=await ensureGatewayRuntime();
    const [config,receipts,missionTeams,supervisorCoordination]=await Promise.all([gateway.getConfig(),gateway.receipts().catch(()=>[]),gateway.listMissionTeams?.().catch(()=>[]),gateway.listSupervisorCoordination?.().catch(()=>[])]);
    state.missionTeams=Array.isArray(missionTeams)?missionTeams:[];state.supervisorCoordination=Array.isArray(supervisorCoordination)?supervisorCoordination:[];
    if(state.projection?.workforce_graph&&gateway.buildChiefOfStaffCoordination){const c=await gateway.buildChiefOfStaffCoordination({graph:state.projection.workforce_graph}).catch(()=>null);state.chiefOfStaffCoordination=c?.record||null;}else state.chiefOfStaffCoordination=await gateway.getChiefOfStaffCoordination?.().catch(()=>null);state.decisionRightsPolicy=await gateway.getDecisionRightsPolicy?.('workforce-default').catch(()=>null);if(state.projection?.workforce_graph&&gateway.buildSkillCapabilityRegistry){const skills=await gateway.buildSkillCapabilityRegistry({graph:state.projection.workforce_graph,projection:state.projection}).catch(()=>null);state.skillCapabilityRegistry=skills?.record||null;}else state.skillCapabilityRegistry=await gateway.getSkillCapabilityRegistry?.().catch(()=>null);if(state.projection?.workforce_graph&&gateway.buildWorkloadCapacity){const capacity=await gateway.buildWorkloadCapacity({graph:state.projection.workforce_graph,projection:state.projection}).catch(()=>null);state.workloadCapacity=capacity?.record||null;}else state.workloadCapacity=await gateway.getWorkloadCapacity?.().catch(()=>null);if(state.projection?.workforce_graph&&gateway.buildPerformanceOutcomes){const performance=await gateway.buildPerformanceOutcomes({graph:state.projection.workforce_graph,projection:{...state.projection,outcomes:state.outcomes}}).catch(()=>null);state.performanceOutcomes=performance?.record||null;}else state.performanceOutcomes=await gateway.getPerformanceOutcomes?.().catch(()=>null);if(state.projection?.workforce_graph&&gateway.buildDynamicStaffing){const staffing=await gateway.buildDynamicStaffing({graph:state.projection.workforce_graph,projection:state.projection}).catch(()=>null);state.dynamicStaffing=staffing?.record||null;}else state.dynamicStaffing=await gateway.getDynamicStaffing?.().catch(()=>null);if(state.projection?.workforce_graph&&gateway.buildImprovementProposals){const learning=await gateway.buildImprovementProposals({graph:state.projection.workforce_graph}).catch(()=>null);state.improvementProposals=learning?.record||null;}else state.improvementProposals=await gateway.getImprovementProposals?.().catch(()=>null);const handoverRef=state.projection?.handover;state.investigationInstallationHandover=handoverRef&&gateway.getInvestigationInstallationHandover?await gateway.getInvestigationInstallationHandover({handover_id:handoverRef.handover_id||handoverRef.client_workforce_handover_id}).catch(()=>null):null;state.businessDiscoverySpecification=state.investigationInstallationHandover&&gateway.getBusinessDiscoverySpecification?await gateway.getBusinessDiscoverySpecification({handover_id:state.investigationInstallationHandover.handover_id}).catch(()=>null):null;if(state.businessDiscoverySpecification?.completeness?.ready_for_installation_planning&&gateway.buildInstallationPlan){const plan=await gateway.buildInstallationPlan({discovery:state.businessDiscoverySpecification}).catch(()=>null);state.installationPlan=plan?.record||null;}else state.installationPlan=null;if(state.installationPlan&&gateway.getCommissioningGates){state.commissioningGates=await gateway.getCommissioningGates({installation_plan_id:state.installationPlan.installation_plan_id}).catch(()=>null);}else state.commissioningGates=null;if(state.commissioningGates&&gateway.probeLiveLaravelHostCertification){const cert=await gateway.probeLiveLaravelHostCertification({commissioning_gates:state.commissioningGates}).catch(()=>null);state.liveHostCertification=cert?.record||null;}else state.liveHostCertification=await gateway.getLiveLaravelHostCertification?.().catch(()=>null);state.migrationUpgradeSafety=await gateway.getMigrationUpgradeSafety?.({}).catch(()=>null);state.uninstallReversibility=await gateway.getUninstallReversibility?.({}).catch(()=>null);if(gateway.buildWorkforceEndToEndCertification){const e2e=await gateway.buildWorkforceEndToEndCertification({commissioning_gates:state.commissioningGates,live_host_certification:state.liveHostCertification,migration_upgrade_safety:state.migrationUpgradeSafety,uninstall_reversibility:state.uninstallReversibility,ui_contract:{reachable:true,evidence_refs:['ui:rich-shell-workforce-launcher','ui:sidePanel-workforce-workspace']},runtime_contract:{company_id_only:true,evidence_refs:['runtime:workforce-background']},gateway_contract:{company_id_only:true,contract_verified:true,evidence_refs:['gateway:contract-v2','gateway:deployment-lineage']},authority_contract:{command_prepare_proposal_only:true,fresh_authority_required:true,evidence_refs:['authority:command-prepare','authority:receipt-verify']},receipt_contract:{authoritative_receipt_required:true,post_action_verification_required:true,evidence_refs:['receipt:verify-required']}}).catch(()=>null);state.endToEndCertification=e2e?.record||null;}else state.endToEndCertification=await gateway.getWorkforceEndToEndCertification?.().catch(()=>null);state.browserLiveSmokeCertification=await gateway.getWorkforceBrowserLiveSmokeCertification?.().catch(()=>null);state.crossVersionCompatibility=await gateway.getCrossVersionCompatibility?.({}).catch(()=>null);if(gateway.buildWorkforceSecurityPosture){const sec=await gateway.buildWorkforceSecurityPosture({}).catch(()=>null);state.securityPosture=sec?.record||null;}else state.securityPosture=await gateway.getWorkforceSecurityPosture?.().catch(()=>null);state.privacyEvidenceControls=await gateway.getWorkforcePrivacyEvidenceControls?.().catch(()=>null);state.intelligenceRouting=await gateway.getWorkforceIntelligenceRouting?.().catch(()=>null);state.knowledgeAuthority=await gateway.getWorkforceKnowledgeAuthority?.().catch(()=>null);if(state.projection?.workforce_graph&&gateway.buildUnifiedWorkforce){const u=await gateway.buildUnifiedWorkforce({graph:state.projection.workforce_graph,projection:state.projection,mission_teams:state.missionTeams,supervision:state.supervisorCoordination,capacity:state.workloadCapacity,capability_registry:state.skillCapabilityRegistry}).catch(()=>null);state.unifiedWorkforce=u?.record||null;}else state.unifiedWorkforce=await gateway.getUnifiedWorkforce?.().catch(()=>null);state.externalActorBoundary=await gateway.getExternalActorBoundary?.({}).catch(()=>null);state.notificationEscalation=await gateway.getWorkforceNotificationEscalation?.({}).catch(()=>null);state.scheduleRecurrence=await gateway.getWorkforceScheduleRecurrence?.({}).catch(()=>null);state.financialResourceGuardrails=await gateway.getWorkforceFinancialResourceGuardrails?.({}).catch(()=>null);state.physicalEnvironmentalRisk=await gateway.getWorkforcePhysicalEnvironmentalRisk?.({}).catch(()=>null);const firstWorker=state.projection?.roster?.find?.(x=>x?.worker_id)?.worker_id||state.projection?.workforce_graph?.nodes?.find?.(x=>x?.kind==='worker'&&x?.id)?.id||null;state.workerMemory=firstWorker&&gateway.getWorkforceWorkerMemory?await gateway.getWorkforceWorkerMemory(firstWorker).catch(()=>null):null;renderLiveActivityStrip();renderQueue();renderUnifiedCommandDashboard();renderUnifiedOrganizationView();renderChiefOfStaffCommandCentre();
    const endpoint=document.getElementById('titan-wf-gateway-endpoint'),realtimeEndpoint=document.getElementById('titan-wf-gateway-realtime-endpoint'),pollSeconds=document.getElementById('titan-wf-gateway-poll-seconds'),actor=document.getElementById('titan-wf-gateway-actor');
    if(endpoint&&!endpoint.matches(':focus')) endpoint.value=config.endpoint||'';
    if(realtimeEndpoint&&!realtimeEndpoint.matches(':focus')) realtimeEndpoint.value=config.realtime_endpoint||'';
    if(pollSeconds&&!pollSeconds.matches(':focus')) pollSeconds.value=String(Math.max(10,Math.round(Number(config.poll_interval_ms||30000)/1000)));
    if(actor&&!actor.matches(':focus')) actor.value=config.actor_id||'';
    const badge=document.getElementById('titan-wf-gateway-status');
    if(badge){badge.textContent=config.endpoint?'Configured':'Not configured';badge.classList.toggle('ready',Boolean(config.endpoint));}
    const box=document.getElementById('titan-wf-gateway-receipts');
    if(box){box.innerHTML='';if(!receipts.length)box.innerHTML='<div class="workforce-control-empty">No Laravel gateway receipts yet.</div>';for(const r of receipts.slice(-20).reverse()){const row=document.createElement('div');row.className='workforce-gateway-receipt';const strong=document.createElement('strong');strong.textContent=`${r.operation||'workforce request'} · ${r.status||'recorded'}`;const span=document.createElement('span');span.textContent=`${r.receipt_id||'receipt'} · ${r.recorded_at||''} · applied ${r.applied===true?'yes':'no'}`;row.append(strong,span);box.appendChild(row);}}
  }

  async function saveGateway(){
    const gateway=await ensureGatewayRuntime();
    const pollSeconds=Math.max(10,Math.min(300,Number(document.getElementById('titan-wf-gateway-poll-seconds')?.value||30)));
    const saved=await gateway.saveConfig({enabled:true,endpoint:document.getElementById('titan-wf-gateway-endpoint')?.value||'',realtime_endpoint:document.getElementById('titan-wf-gateway-realtime-endpoint')?.value||'',poll_interval_ms:pollSeconds*1000,actor_id:document.getElementById('titan-wf-gateway-actor')?.value||'authenticated',token:document.getElementById('titan-wf-gateway-token')?.value||undefined});
    const token=document.getElementById('titan-wf-gateway-token');if(token)token.value='';
    await renderGateway();await startLiveSync({force:true}).catch(error=>window.titanDiagWrite?.('warn','client-workforce','Realtime Workforce sync unavailable; polling/config fallback retained',{message:error.message,company_id:state.company_id}));return saved;
  }

  async function syncLaravel(){
    const gateway=await ensureGatewayRuntime();
    const projection=await gateway.refreshProjection();
    await ingestManagerProjection(projection);
    await renderGateway();
    window.titanDiagWrite?.('info','client-workforce','Synced Laravel client workforce projection',{company_id:state.company_id,errors:projection.errors?.length||0});
    return projection;
  }

  async function submitPreparedControls(){
    const gateway=await ensureGatewayRuntime();
    const prepared=state.intents.filter(x=>x.state==='prepared');
    const results=await gateway.submitPreparedIntents(prepared);
    const accepted=new Set(results.filter(x=>x.ok).map(x=>x.intent_id));
    state.intents=state.intents.map(x=>accepted.has(x.intent_id)?{...x,state:'submitted',submitted_at:new Date().toISOString()}:x);
    state.allIntents=[...state.allIntents.filter(x=>x?.company_id!==state.company_id),...state.intents];
    await chrome.storage.local.set({[KEYS.controlIntents]:state.allIntents});
    render();await renderGateway();
    window.titanDiagWrite?.('info','client-workforce','Submitted prepared workforce controls to Laravel',{company_id:state.company_id,submitted:accepted.size,failed:results.filter(x=>!x.ok).length});
    return results;
  }

  let liveSyncStartedForCompany=null;
  function updateLiveSyncStatus(status={}){
    const badge=document.getElementById('titan-wf-gateway-status');if(!badge)return;
    const mode=status.mode==='realtime'?'Realtime':status.mode==='polling'?'Polling':null;
    if(status.status==='OFFLINE'){badge.textContent='Offline · cached';badge.classList.remove('ready');return;}
    if(status.status==='ERROR'){badge.textContent=`${mode||'Sync'} error`;badge.classList.remove('ready');return;}
    if(status.status==='FALLBACK'){badge.textContent='Polling fallback';badge.classList.add('ready');return;}
    if(mode){badge.textContent=`${mode} · ${String(status.status||'active').toLowerCase()}`;badge.classList.add('ready');}
  }
  async function startLiveSync({force=false}={}){
    const gateway=await ensureGatewayRuntime();
    if(!force&&liveSyncStartedForCompany===state.company_id)return {started:true,reused:true,company_id:state.company_id,grants_authority:false};
    gateway.stopRealtimeSync?.();liveSyncStartedForCompany=null;
    const result=await gateway.startRealtimeSync?.({
      onProjection:async projection=>{await ingestManagerProjection(projection);window.titanDiagWrite?.('info','client-workforce','Applied realtime/polling Workforce projection',{company_id:state.company_id,source:projection.source||'polling',projection_revision:projection.projection_revision??null});return projection;},
      onStatus:updateLiveSyncStatus
    });
    if(result?.started)liveSyncStartedForCompany=state.company_id;
    return result||{started:false,company_id:state.company_id,grants_authority:false};
  }
  function render(){renderSummary();renderTemplates();renderRoles();renderDeploymentConsole();renderQueue();renderUnifiedOrganizationView();renderGateway().catch(error=>window.titanDiagWrite?.('warn','client-workforce','Laravel gateway unavailable',{message:error.message,company_id:state.company_id}));}

  async function refresh(){
    try{await Promise.all([loadStaticData(),loadState()]);render();startLiveSync().catch(error=>window.titanDiagWrite?.('warn','client-workforce','Realtime Workforce sync unavailable',{message:error.message,company_id:state.company_id}));}
    catch(error){
      window.titanDiagWrite?.('error','client-workforce','Unable to render client workforce controls',{message:error.message});
      const box=document.getElementById('titan-wf-role-list'); if(box) box.innerHTML=`<div class="workforce-control-empty">${esc(error.message)}</div>`;
    }
  }

  document.getElementById('titan-wf-refresh')?.addEventListener('click',refresh);
  document.getElementById('titan-wf-deployment-refresh')?.addEventListener('click',refresh);
  document.getElementById('titan-wf-deployment-probe')?.addEventListener('click',()=>probeDeploymentHost().catch(error=>window.titanDiagWrite?.('error','client-workforce','Live deployment probe failed',{message:error.message,company_id:state.company_id})));
  if(typeof document.querySelectorAll==='function') document.querySelectorAll('[data-workforce-identity-filter]').forEach(button=>button.addEventListener('click',()=>{organizationIdentityFilter=button.dataset.workforceIdentityFilter||'all';renderUnifiedOrganizationView();}));
  if(typeof document.querySelectorAll==='function') document.querySelectorAll('[data-workforce-hierarchy-action]').forEach(button=>button.addEventListener('click',()=>{const open=button.dataset.workforceHierarchyAction==='expand';document.querySelectorAll('#titan-wf-organization-tree details').forEach(node=>{node.open=open;});}));
  document.getElementById('titan-wf-propose-template')?.addEventListener('click',()=>proposeTemplate(document.getElementById('titan-wf-template')?.value).catch(error=>window.titanDiagWrite?.('error','client-workforce','Team proposal failed',{message:error.message,company_id:state.company_id})));
  document.getElementById('titan-wf-role-search')?.addEventListener('input',renderRoles);
  document.getElementById('titan-wf-role-filter')?.addEventListener('change',renderRoles);
  ensureGatewayPanel();
  document.getElementById('titan-wf-gateway-save')?.addEventListener('click',()=>saveGateway().catch(error=>window.titanDiagWrite?.('error','client-workforce','Gateway save failed',{message:error.message,company_id:state.company_id})));
  document.getElementById('titan-wf-gateway-refresh')?.addEventListener('click',()=>syncLaravel().catch(error=>window.titanDiagWrite?.('error','client-workforce','Laravel workforce sync failed',{message:error.message,company_id:state.company_id})));
  document.getElementById('titan-wf-gateway-submit')?.addEventListener('click',()=>submitPreparedControls().catch(error=>window.titanDiagWrite?.('error','client-workforce','Prepared workforce controls failed',{message:error.message,company_id:state.company_id})));
  window.addEventListener('titan-business-profile-updated',refresh);
  window.addEventListener('titan-worker-selected',renderSummary);
  window.addEventListener('online',()=>startLiveSync({force:true}).catch(error=>window.titanDiagWrite?.('warn','client-workforce','Workforce sync reconnect failed',{message:error.message,company_id:state.company_id})));
  window.addEventListener('offline',()=>updateLiveSyncStatus({mode:'polling',status:'OFFLINE'}));
  window.addEventListener('beforeunload',()=>window.TitanClientWorkforceGateway?.stopRealtimeSync?.());

  window.TitanClientWorkforceControls={refresh,deriveLiveActivityCounts,renderLiveActivityStrip,renderDeploymentConsole,probeDeploymentHost,proposeRoleActivation,proposeTemplate,prepareWorkerControl,compareProjectionComponent,ingestManagerProjection,syncLaravel,startLiveSync,updateLiveSyncStatus,submitPreparedControls,getPreparedIntents:()=>state.intents.filter(x=>x.state==='prepared'),getState:()=>structuredClone(state)};
  refresh();
})();
