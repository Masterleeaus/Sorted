// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): runtime/workforce-runtime-background.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { database, ready as businessDatabaseReady } from '../titan-local/storage/bootstrap.js';
import { normalizeWorkforceControlIntent } from './native-runtime-contracts.js';
import { createRestartCheckpointStore } from '../titan-offline/restart-checkpoint.js';
import { createWorkforceRetryEvaluator, classifyWorkforceFailure } from '../titan-workforce/gateway/failure-retry.js';
import { normalizeInvestigationParticipationPacket, investigationParticipationSummary } from '../titan-workforce/investigation-participation-manager.js';
import { buildCanonicalWorkforceGraph, summarizeWorkforceGraph } from '../titan-workforce/graph/workforce-graph.js';
import { createMissionTeamRecord, transitionMissionTeam, summarizeMissionTeam } from '../titan-workforce/mission/mission-team-runtime.js';
import { createSupervisorCoordinationRecord, refreshSupervisorCoordination, acknowledgeEscalation, prepareSupervisorHandover, summarizeSupervisorCoordination } from '../titan-workforce/supervision/supervisor-runtime.js';
import { deriveChiefOfStaffCoordination, summarizeChiefOfStaffCoordination } from '../titan-workforce/coordination/chief-of-staff-runtime.js';
import { createDecisionRightsPolicy, evaluateDecisionRight, evaluateDecisionRightsMatrix, summarizeDecisionRightsEvaluation } from '../titan-workforce/decision/decision-rights-runtime.js';
import { buildWorkloadCapacitySnapshot, summarizeWorkloadCapacity } from '../titan-workforce/capacity/workload-capacity-runtime.js';
import { buildSkillCapabilityRegistry, summarizeSkillCapabilityRegistry } from '../titan-workforce/capability/skill-capability-registry.js';
import { buildDynamicStaffingSnapshot, summarizeDynamicStaffing } from '../titan-workforce/staffing/dynamic-staffing-runtime.js';
import { buildPerformanceOutcomeEvidence, summarizePerformanceOutcomeEvidence } from '../titan-workforce/performance/performance-outcome-runtime.js';
import { buildImprovementProposalSnapshot, summarizeImprovementProposals } from '../titan-workforce/learning/improvement-proposal-runtime.js';
import { buildInvestigationInstallationHandover, summarizeInvestigationInstallationHandover, compileBusinessDiscoverySpecification, summarizeBusinessDiscoverySpecification, buildInstallationPlan, summarizeInstallationPlan, buildCommissioningGates, summarizeCommissioningGates, buildLiveLaravelHostCertification, summarizeLiveLaravelHostCertification, buildMigrationUpgradeSafety, transitionMigrationUpgradeSafety, summarizeMigrationUpgradeSafety, executeRegisteredMigrationPlan, buildUninstallReversibilityPlan, transitionUninstallReversibility, summarizeUninstallReversibility, buildWorkforceSecurityPosture, summarizeWorkforceSecurityPosture, prepareWorkforceSecurityEnvelope, verifyWorkforceSecurityEnvelope, chainWorkforceSecurityEvidence, buildWorkforcePrivacyEvidenceControls, evaluateWorkforceEvidenceAccess, prepareWorkforceEvidenceExport, prepareWorkforceEvidenceDeletion, summarizeWorkforcePrivacyEvidenceControls, buildWorkforceIntelligenceRoutingPolicy, selectWorkforceIntelligenceRoute, buildWorkforceProviderReceipt, summarizeWorkforceIntelligenceRouting, buildWorkforceKnowledgeAuthorityPacket, evaluateWorkforceKnowledgeUse, buildWorkforceKnowledgeUseReceipt, summarizeWorkforceKnowledgeAuthority, buildWorkforceWorkerMemorySnapshot, recallWorkforceWorkerMemory, buildWorkforceWorkerMemoryRecallReceipt, summarizeWorkforceWorkerMemory, buildUnifiedWorkforceSnapshot, evaluateUnifiedWorkerAssignment, summarizeUnifiedWorkforce, buildExternalActorBoundary, evaluateExternalActorParticipation, buildExternalActorParticipationReceipt, summarizeExternalActorBoundary, buildWorkforceNotificationEscalation, transitionWorkforceNotification, evaluateWorkforceEscalationDue, summarizeWorkforceNotificationEscalation, buildWorkforceScheduleRecurrence, evaluateWorkforceScheduleDue, recordWorkforceScheduleInstance, summarizeWorkforceScheduleRecurrence, buildWorkforceFinancialResourceGuardrails, evaluateWorkforceResourceRequest, recordWorkforceResourceReservation, recordWorkforceResourceConsumption, summarizeWorkforceFinancialResourceGuardrails, buildWorkforcePhysicalEnvironmentalRiskHooks, evaluateWorkforcePhysicalEnvironmentalRisk, recordWorkforceRiskMitigation, summarizeWorkforcePhysicalEnvironmentalRisk, buildWorkforceEndToEndCertification, summarizeWorkforceEndToEndCertification, buildWorkforceBrowserLiveSmokeCertification, summarizeWorkforceBrowserLiveSmokeCertification, buildCrossVersionCompatibility, summarizeCrossVersionCompatibility } from '../titan-workforce/handover/investigation-installation-handover.js';
import {
  evaluateWorkerAuthorityDecision,
  prepareGovernedCommandEnvelope,
  assertAuthoritativeExecutionReceipt,
  assertPostActionVerification,
} from '../titan-runtime/authority/index.js';

let preparedControlIntents=0;
let investigationPlans=0;
let lastControlIntent=null;
let lastInvestigation=null;
let operationClaims=0;
let duplicateOperationClaims=0;
let operationFailures=0;
let syncRecoveryCheckpoints=0;
let lastOperation=null;
let lastSyncRecovery=null;
let retryEvaluations=0;
let retriesScheduled=0;
let manualReviewsRequired=0;
let lastRetryDecision=null;
let workforceGraphsBuilt=0;
let lastWorkforceGraph=null;
let missionTeamsCreated=0;
let missionTeamTransitions=0;
let lastMissionTeam=null;
let supervisorRecordsCreated=0;
let supervisorEscalationsAcknowledged=0;
let supervisorHandoversPrepared=0;
let lastSupervisorCoordination=null;
let chiefOfStaffSnapshotsBuilt=0;
let lastChiefOfStaffCoordination=null;
let decisionRightsPoliciesSaved=0;
let decisionRightsEvaluations=0;
let lastDecisionRightsEvaluation=null;
let workloadCapacitySnapshotsBuilt=0;
let skillCapabilityRegistriesBuilt=0;
let lastSkillCapabilityRegistry=null;
let lastWorkloadCapacity=null;
let dynamicStaffingSnapshotsBuilt=0;
let lastDynamicStaffing=null;
let performanceOutcomeSnapshotsBuilt=0;
let lastPerformanceOutcomeEvidence=null;
let improvementProposalSnapshotsBuilt=0;
let lastImprovementProposals=null;
let investigationInstallationHandoversBuilt=0;
let lastInvestigationInstallationHandover=null;
let businessDiscoverySpecificationsBuilt=0;
let lastBusinessDiscoverySpecification=null;
let installationPlansBuilt=0;
let lastInstallationPlan=null;
let commissioningGateSetsBuilt=0;
let lastCommissioningGates=null;
let liveHostCertificationsBuilt=0;
let lastLiveHostCertification=null;
let migrationUpgradeSafetyRecordsBuilt=0;
let migrationUpgradeTransitions=0;
let lastMigrationUpgradeSafety=null;
let uninstallReversibilityPlansBuilt=0;
let uninstallReversibilityTransitions=0;
let lastUninstallReversibility=null;
let workforceSecurityPosturesBuilt=0;
let workforceSecurityEnvelopesPrepared=0;
let lastWorkforceSecurityPosture=null;
let workforcePrivacyEvidenceControlsBuilt=0;
let lastWorkforcePrivacyEvidenceControls=null;
let workforceIntelligencePoliciesBuilt=0;
let workforceProviderReceiptsRecorded=0;
let lastWorkforceIntelligenceRouting=null;
let workforceKnowledgePacketsBuilt=0;
let workforceKnowledgeUseReceiptsRecorded=0;
let lastWorkforceKnowledgeAuthority=null;
let workforceWorkerMemorySnapshotsBuilt=0;
let workforceWorkerMemoryRecallReceiptsRecorded=0;
let lastWorkforceWorkerMemory=null;
let unifiedWorkforceSnapshotsBuilt=0;
let lastUnifiedWorkforce=null;

const WORKFORCE_OPERATION_LEDGER_COLLECTION='operation_ledger';
const WORKFORCE_SYNC_RECOVERY_COLLECTION='sync_recovery';
const WORKFORCE_MISSION_TEAM_COLLECTION='mission_teams';
const WORKFORCE_SUPERVISION_COLLECTION='supervisor_coordination';
const WORKFORCE_CHIEF_OF_STAFF_COLLECTION='chief_of_staff_coordination';
const WORKFORCE_DECISION_RIGHTS_COLLECTION='decision_rights';
const WORKFORCE_CAPACITY_COLLECTION='workload_capacity';
const WORKFORCE_SKILL_CAPABILITY_COLLECTION='skill_capability_registry';
const WORKFORCE_DYNAMIC_STAFFING_COLLECTION='dynamic_staffing';
const WORKFORCE_PERFORMANCE_OUTCOME_COLLECTION='performance_outcome_evidence';
const WORKFORCE_IMPROVEMENT_PROPOSALS_COLLECTION='improvement_proposals';
const WORKFORCE_INVESTIGATION_INSTALLATION_HANDOVER_COLLECTION='investigation_installation_handover';
const WORKFORCE_BUSINESS_DISCOVERY_COLLECTION='business_discovery_specification';
const WORKFORCE_INSTALLATION_PLAN_COLLECTION='installation_plan';
const WORKFORCE_COMMISSIONING_GATES_COLLECTION='commissioning_gates';
const WORKFORCE_LIVE_HOST_CERTIFICATION_COLLECTION='live_laravel_host_certification';
const WORKFORCE_E2E_CERTIFICATION_COLLECTION='cross_system_e2e_certification';
const WORKFORCE_BROWSER_LIVE_SMOKE_COLLECTION='browser_live_smoke_certification';
const WORKFORCE_CROSS_VERSION_COMPATIBILITY_COLLECTION='cross_version_compatibility';
const WORKFORCE_MIGRATION_UPGRADE_SAFETY_COLLECTION='migration_upgrade_safety';
const WORKFORCE_UNINSTALL_REVERSIBILITY_COLLECTION='uninstall_reversibility';
const WORKFORCE_SECURITY_POSTURE_COLLECTION='security_posture';
const WORKFORCE_SECURITY_NONCE_COLLECTION='security_nonce_ledger';
const WORKFORCE_PRIVACY_EVIDENCE_COLLECTION='privacy_evidence_controls';
const WORKFORCE_INTELLIGENCE_ROUTING_COLLECTION='intelligence_routing';
const WORKFORCE_PROVIDER_RECEIPTS_COLLECTION='intelligence_provider_receipts';
const WORKFORCE_KNOWLEDGE_AUTHORITY_COLLECTION='knowledge_authority';
const WORKFORCE_KNOWLEDGE_USE_RECEIPTS_COLLECTION='knowledge_use_receipts';
const WORKFORCE_WORKER_MEMORY_COLLECTION='worker_memory';
const WORKFORCE_WORKER_MEMORY_RECALL_RECEIPTS_COLLECTION='worker_memory_recall_receipts';
const WORKFORCE_HUMAN_AI_UNIFICATION_COLLECTION='human_ai_workforce_unification';
const WORKFORCE_EXTERNAL_ACTOR_BOUNDARY_COLLECTION='external_actor_boundary';
const WORKFORCE_EXTERNAL_ACTOR_RECEIPTS_COLLECTION='external_actor_participation_receipts';
const WORKFORCE_NOTIFICATION_ESCALATION_COLLECTION='notification_escalation';
const WORKFORCE_SCHEDULE_RECURRENCE_COLLECTION='schedule_recurrence';
const WORKFORCE_FINANCIAL_RESOURCE_GUARDRAILS_COLLECTION='financial_resource_guardrails';
const WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_COLLECTION='physical_environmental_risk';
const WORKFORCE_REGISTERED_MIGRATIONS=Object.freeze([]);
const workforceRestartCheckpointStore=createRestartCheckpointStore({database});
const workforceRetryEvaluator=createWorkforceRetryEvaluator({base_delay_ms:1000,max_delay_ms:60000,max_retries:5});

function cleanText(value,field,max=240){
  const out=String(value??'').trim().slice(0,max);
  if(!out)throw new Error(`${field}-required`);
  return out;
}


async function persistWorkforceSyncRecovery(raw={}){
  const current=await activeCompanyId();
  const company_id=cleanText(raw.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-sync-recovery-cross-company-active-context');
  const operation_id=`workforce-sync:${company_id}`;
  const now=Date.now();
  const data={
    schema:'titan.workforce.sync-recovery.v1',company_id,operation_id,
    mode:String(raw.mode||'polling').slice(0,40),
    projection_revision:Number(raw.projection_revision||0),
    projection_cursor:String(raw.projection_cursor||'').slice(0,240)||null,
    sync_generation:Number(raw.sync_generation||0),
    sync_started_at_ms:Number(raw.sync_started_at_ms||0),
    poll_interval_ms:Number(raw.poll_interval_ms||30000),
    retry_count:Number(raw.retry_count||0),
    last_event_at:String(raw.last_event_at||'').slice(0,80)||null,
    last_error:String(raw.last_error||'').slice(0,500)||null,
    connectivity:String(raw.connectivity||'online').slice(0,40),
    updated_at:now,
    token_persisted:false,authority_decision_persisted:false,command_persisted:false,
    automatic_effect_replay:false,effect_replay_allowed:false,requires_fresh_authority_for_effects:true,
    grants_authority:false,authority_effect:false,direct_mutation:false
  };
  await businessDatabaseReady;
  await database.putRecord({company_id,actor_id:'titan-zero-workforce-sync-recovery',operation_id},{module_id:'titan.workforce',collection:WORKFORCE_SYNC_RECOVERY_COLLECTION,record_id:operation_id,data,provenance:{source:'titan-zero-workforce-sync',company_id,operation_id}});
  await workforceRestartCheckpointStore.checkpoint({company_id,actor_id:'titan-zero-workforce-sync-recovery',operation_id},{operation_id,correlation_id:operation_id,idempotency_key:operation_id,type:'workforce.sync.active',terminal:false});
  syncRecoveryCheckpoints+=1;lastSyncRecovery={company_id,operation_id,mode:data.mode,projection_revision:data.projection_revision,projection_cursor:data.projection_cursor,retry_count:data.retry_count,last_error:data.last_error,updated_at:data.updated_at,grants_authority:false};
  return {recovery:data,grants_authority:false};
}
async function getWorkforceSyncRecovery(raw={}){
  const current=await activeCompanyId();
  const company_id=cleanText(raw.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-sync-recovery-cross-company-active-context');
  const operation_id=`workforce-sync:${company_id}`;
  await businessDatabaseReady;
  const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-sync-recovery',operation_id},{module_id:'titan.workforce',collection:WORKFORCE_SYNC_RECOVERY_COLLECTION,record_id:operation_id},{includeDeleted:true});
  return {recovery:row?.data||null,grants_authority:false};
}
async function completeWorkforceSyncRecovery(raw={}){
  const current=await activeCompanyId();
  const company_id=cleanText(raw.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-sync-recovery-cross-company-active-context');
  const operation_id=`workforce-sync:${company_id}`;
  await workforceRestartCheckpointStore.checkpoint({company_id,actor_id:'titan-zero-workforce-sync-recovery',operation_id},{operation_id,correlation_id:operation_id,idempotency_key:operation_id,type:'workforce.sync.stopped',terminal:true});
  return {completed:true,operation_id,company_id,grants_authority:false};
}

async function evaluateWorkforceRetry(raw={}){
  const current=await activeCompanyId();
  const company_id=cleanText(raw.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-retry-cross-company-active-context');
  const decision=workforceRetryEvaluator.evaluate(raw,{company_id});
  const classification=classifyWorkforceFailure(raw);
  retryEvaluations+=1;if(decision.retry_allowed)retriesScheduled+=1;if(decision.requires_review)manualReviewsRequired+=1;lastRetryDecision=decision;
  return {classification,decision,grants_authority:false};
}

async function buildWorkforceGraph(raw={}){
  const current=await activeCompanyId();
  const projection=raw.projection&&typeof raw.projection==='object'?raw.projection:raw;
  const company_id=cleanText(projection.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-graph-cross-company-active-context');
  const graph=buildCanonicalWorkforceGraph({...projection,company_id});
  const summary=summarizeWorkforceGraph(graph);
  workforceGraphsBuilt+=1;lastWorkforceGraph=summary;
  try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.graph.derived',company_id,operation_id:`workforce-graph:${company_id}:${graph.sync_generation||graph.projection_revision||0}`,actor_id:'titan-zero-workforce-graph',payload:summary,authority_effect:false})}catch(_){ }
  return {graph,summary,grants_authority:false};
}


async function saveMissionTeamRecord(record){
  await businessDatabaseReady;
  return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-mission-team-runtime',operation_id:record.mission_team_id,idempotency_key:`mission-team:${record.mission_team_id}`},{module_id:'titan.workforce',collection:WORKFORCE_MISSION_TEAM_COLLECTION,record_id:record.mission_team_id,data:record,provenance:{source:'titan-workforce-mission-team-runtime',company_id:record.company_id,mission_team_id:record.mission_team_id,authority_effect:false}});
}
async function getMissionTeamRecord(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('mission-team-cross-company-active-context');
  const mission_team_id=cleanText(raw.mission_team_id||raw.team_id,'mission_team_id',180);await businessDatabaseReady;
  const row=await database.getRecord({company_id,actor_id:'titan-zero-mission-team-runtime',operation_id:mission_team_id,idempotency_key:null},{module_id:'titan.workforce',collection:WORKFORCE_MISSION_TEAM_COLLECTION,record_id:mission_team_id},{includeDeleted:true});
  return {record:row?.data||null,grants_authority:false};
}
async function createMissionTeam(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('mission-team-cross-company-active-context');
  const graph=raw.graph;const record=createMissionTeamRecord({...raw,company_id},graph);const existing=await getMissionTeamRecord({company_id,mission_team_id:record.mission_team_id});
  if(existing.record){if(JSON.stringify(existing.record)===JSON.stringify(record))return {created:false,duplicate:true,record:existing.record,summary:summarizeMissionTeam(existing.record),grants_authority:false};throw new Error('mission-team-record-conflict');}
  const row=await saveMissionTeamRecord(record);missionTeamsCreated+=1;lastMissionTeam=summarizeMissionTeam(record);
  try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.mission-team.created',company_id,operation_id:record.mission_team_id,actor_id:'titan-zero-mission-team-runtime',payload:lastMissionTeam,authority_effect:false})}catch(_){}
  return {created:true,duplicate:false,record:row.data,summary:lastMissionTeam,grants_authority:false};
}
async function transitionMissionTeamRecord(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('mission-team-cross-company-active-context');
  const found=await getMissionTeamRecord(raw);if(!found.record)throw new Error('mission-team-record-required');
  const next=transitionMissionTeam(found.record,{...raw,company_id});const row=await saveMissionTeamRecord(next);missionTeamTransitions+=1;lastMissionTeam=summarizeMissionTeam(next);
  try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.mission-team.transitioned',company_id,operation_id:next.mission_team_id,actor_id:'titan-zero-mission-team-runtime',payload:lastMissionTeam,authority_effect:false})}catch(_){}
  return {updated:true,record:row.data,summary:lastMissionTeam,grants_authority:false};
}
async function listMissionTeams(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('mission-team-cross-company-active-context');await businessDatabaseReady;
  const rows=await database.listRecords?.({company_id,actor_id:'titan-zero-mission-team-runtime',operation_id:`mission-team-list:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_MISSION_TEAM_COLLECTION,includeDeleted:false,limit:1000})||[];
  const records=Array.isArray(rows)?rows.map(x=>x?.data||x).filter(x=>x?.company_id===company_id):[];return {records,grants_authority:false};
}

async function claimWorkforceOperation(raw={}){
  const current=await activeCompanyId();
  const company_id=cleanText(raw.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-operation-cross-company-active-context');
  const operation_id=cleanText(raw.operation_id,'operation_id',180);
  const idempotency_key=cleanText(raw.idempotency_key,'idempotency_key',220);
  const operation=cleanText(raw.operation,'operation',180);
  const phase=String(raw.phase||'gateway-proposal').trim().slice(0,80)||'gateway-proposal';
  await businessDatabaseReady;
  const context={company_id,actor_id:'titan-zero-workforce-operation-ledger',operation_id,idempotency_key};
  const locator={module_id:'titan.workforce',collection:WORKFORCE_OPERATION_LEDGER_COLLECTION,record_id:operation_id};
  const prior=await database.getRecord({...context,idempotency_key:null},locator,{includeDeleted:true});
  if(prior){
    const data=prior.data||{};
    if(String(data.idempotency_key||'')!==idempotency_key)throw new Error('workforce-operation-idempotency-conflict');
    if(String(data.operation||'')!==operation)throw new Error('workforce-operation-contract-conflict');
    duplicateOperationClaims+=1;lastOperation={company_id,operation_id,idempotency_key,operation,phase,state:data.state||'duplicate',duplicate:true,updated_at:Date.now(),grants_authority:false};
    return {claimed:false,duplicate:true,record:data,grants_authority:false};
  }
  const now=Date.now();
  const data={schema:'titan.workforce.operation-ledger.v1',company_id,operation_id,idempotency_key,operation,phase,state:'claimed',attempt_count:1,claimed_at:now,updated_at:now,receipt:null,result:null,delivery_status:'not_sent',grants_authority:false,authority_effect:false,automatic_effect_replay:false};
  const row=await database.putRecord(context,{...locator,data,provenance:{source:'titan-workforce-operation-ledger',company_id,operation_id,phase,authority_effect:false}});
  operationClaims+=1;lastOperation={company_id,operation_id,idempotency_key,operation,phase,state:'claimed',duplicate:false,updated_at:now,grants_authority:false};
  try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.operation.claimed',company_id,operation_id,actor_id:'titan-zero-workforce-operation-ledger',idempotency_key,payload:{operation,phase,state:'claimed'},authority_effect:false})}catch(_){ }
  return {claimed:true,duplicate:false,record:row.data,grants_authority:false};
}

async function completeWorkforceOperation(raw={}){
  const current=await activeCompanyId();
  const company_id=cleanText(raw.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-operation-cross-company-active-context');
  const operation_id=cleanText(raw.operation_id,'operation_id',180);
  const idempotency_key=cleanText(raw.idempotency_key,'idempotency_key',220);
  const locator={module_id:'titan.workforce',collection:WORKFORCE_OPERATION_LEDGER_COLLECTION,record_id:operation_id};
  await businessDatabaseReady;
  const prior=await database.getRecord({company_id,actor_id:'titan-zero-workforce-operation-ledger',operation_id,idempotency_key:null},locator,{includeDeleted:true});
  if(!prior)throw new Error('workforce-operation-ledger-record-required');
  const data=prior.data||{};
  if(String(data.idempotency_key||'')!==idempotency_key)throw new Error('workforce-operation-idempotency-conflict');
  const state=cleanText(raw.state||'completed','state',80);
  const terminal=['receipt_verified','completed','failed','reversed','gateway_rejected'].includes(state);
  const next={...data,state,phase:String(raw.phase||data.phase||'').trim()||null,delivery_status:String(raw.delivery_status||data.delivery_status||'').trim()||null,receipt:raw.receipt??data.receipt??null,result:raw.result??data.result??null,error:raw.error?String(raw.error).slice(0,1000):(data.error||null),failure_category:String(raw.failure_category||data.failure_category||'').slice(0,80)||null,failure_class:String(raw.failure_class||data.failure_class||'').slice(0,80)||null,retry_disposition:String(raw.retry_disposition||data.retry_disposition||'').slice(0,80)||null,retry_count:Number(raw.retry_count??data.retry_count??0),next_retry_at:Number.isFinite(Number(raw.next_retry_at))?Number(raw.next_retry_at):(data.next_retry_at??null),requires_review:raw.requires_review===true||data.requires_review===true,updated_at:Date.now(),terminal,grants_authority:false,authority_effect:false,automatic_effect_replay:false};
  const row=await database.putRecord({company_id,actor_id:'titan-zero-workforce-operation-ledger',operation_id,idempotency_key:null},{...locator,data:next,provenance:{source:'titan-workforce-operation-ledger',company_id,operation_id,phase:next.phase,state,authority_effect:false}});
  if(state==='failed'||state==='gateway_rejected'||state==='delivery_unknown')operationFailures+=1;lastOperation={company_id,operation_id,idempotency_key,operation:data.operation||null,phase:next.phase,state,delivery_status:next.delivery_status,error:next.error||null,updated_at:next.updated_at,grants_authority:false};
  const eventType=terminal?'titan.workforce.operation.completed':'titan.workforce.operation.updated';
  try{await globalThis.TitanZeroRuntime?.emit?.({type:eventType,company_id,operation_id,actor_id:'titan-zero-workforce-operation-ledger',idempotency_key,payload:{state,phase:next.phase,delivery_status:next.delivery_status},authority_effect:false})}catch(_){ }
  return {updated:true,record:row.data,grants_authority:false};
}

async function getWorkforceOperation(raw={}){
  const current=await activeCompanyId();
  const company_id=cleanText(raw.company_id||current,'company_id',128);
  if(current&&company_id!==current)throw new Error('workforce-operation-cross-company-active-context');
  const operation_id=cleanText(raw.operation_id,'operation_id',180);
  await businessDatabaseReady;
  const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-operation-ledger',operation_id,idempotency_key:null},{module_id:'titan.workforce',collection:WORKFORCE_OPERATION_LEDGER_COLLECTION,record_id:operation_id},{includeDeleted:true});
  return {record:row?.data||null,grants_authority:false};
}

async function activeCompanyId(){
  try{const d=await chrome.storage.local.get(['titanBusinessProfile']);return String(d?.titanBusinessProfile?.company_id||'').trim()||null}catch(_){return null}
}


async function saveSupervisorRecord(record){
  await businessDatabaseReady;
  return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-supervision-runtime',operation_id:`supervision:${record.supervisor_worker_id}`,idempotency_key:`supervision:${record.supervisor_worker_id}`},{module_id:'titan.workforce',collection:WORKFORCE_SUPERVISION_COLLECTION,record_id:record.supervisor_worker_id,data:record,provenance:{source:'titan-workforce-supervision-runtime',company_id:record.company_id,supervisor_worker_id:record.supervisor_worker_id,authority_effect:false}});
}
async function getSupervisorRecord(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('supervision-cross-company-active-context');
  const supervisor_worker_id=cleanText(raw.supervisor_worker_id||raw.manager_worker_id||raw.worker_id,'supervisor_worker_id',180);await businessDatabaseReady;
  const row=await database.getRecord({company_id,actor_id:'titan-zero-supervision-runtime',operation_id:`supervision:${supervisor_worker_id}`},{module_id:'titan.workforce',collection:WORKFORCE_SUPERVISION_COLLECTION,record_id:supervisor_worker_id},{includeDeleted:true});
  return {record:row?.data||null,grants_authority:false};
}
async function listSupervisorRecords(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('supervision-cross-company-active-context');await businessDatabaseReady;
  const rows=await database.listRecords?.({company_id,actor_id:'titan-zero-supervision-runtime',operation_id:`supervision-list:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_SUPERVISION_COLLECTION,includeDeleted:false,limit:1000})||[];
  const records=rows.map(x=>x?.data).filter(x=>x?.company_id===company_id);return {records,grants_authority:false};
}
async function upsertSupervisorRecord(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('supervision-cross-company-active-context');
  const supervisor_worker_id=cleanText(raw.supervisor_worker_id||raw.manager_worker_id||raw.worker_id,'supervisor_worker_id',180);const found=await getSupervisorRecord({company_id,supervisor_worker_id});const teams=(await listMissionTeams({company_id})).records;
  const record=found.record?refreshSupervisorCoordination(found.record,{...raw,company_id,supervisor_worker_id},raw.graph,teams):createSupervisorCoordinationRecord({...raw,company_id,supervisor_worker_id},raw.graph,teams);
  const row=await saveSupervisorRecord(record);if(!found.record)supervisorRecordsCreated+=1;lastSupervisorCoordination=summarizeSupervisorCoordination(record);
  try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.supervision.scope.updated',company_id,operation_id:`supervision:${supervisor_worker_id}`,actor_id:'titan-zero-supervision-runtime',payload:lastSupervisorCoordination,authority_effect:false})}catch(_){}
  return {created:!found.record,record:row.data,summary:lastSupervisorCoordination,grants_authority:false};
}
async function saveChiefOfStaffCoordination(record){
  await businessDatabaseReady;
  return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-chief-of-staff-runtime',operation_id:`chief-of-staff:${record.company_id}`,idempotency_key:`chief-of-staff:${record.company_id}:${record.graph_revision}`},{module_id:'titan.workforce',collection:WORKFORCE_CHIEF_OF_STAFF_COLLECTION,record_id:'chief-of-staff',data:record,provenance:{source:'titan-workforce-chief-of-staff-runtime',company_id:record.company_id,authority_effect:false}});
}
async function buildChiefOfStaffCoordination(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('chief-of-staff-cross-company-active-context');
  const teams=(await listMissionTeams({company_id})).records;const supervisors=(await listSupervisorRecords({company_id})).records;
  const record=deriveChiefOfStaffCoordination({...raw,company_id},raw.graph,teams,supervisors);const row=await saveChiefOfStaffCoordination(record);chiefOfStaffSnapshotsBuilt+=1;lastChiefOfStaffCoordination=summarizeChiefOfStaffCoordination(record);
  try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.chief-of-staff.coordination.updated',company_id,operation_id:`chief-of-staff:${company_id}`,actor_id:'titan-zero-chief-of-staff-runtime',payload:lastChiefOfStaffCoordination,authority_effect:false})}catch(_){}
  return {record:row.data,summary:lastChiefOfStaffCoordination,grants_authority:false};
}
async function getChiefOfStaffCoordination(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('chief-of-staff-cross-company-active-context');await businessDatabaseReady;
  const row=await database.getRecord({company_id,actor_id:'titan-zero-chief-of-staff-runtime',operation_id:`chief-of-staff:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_CHIEF_OF_STAFF_COLLECTION,record_id:'chief-of-staff'},{includeDeleted:true});return {record:row?.data||null,grants_authority:false};
}



async function saveSkillCapabilityRegistry(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-skill-capability-runtime',operation_id:`skill-capability:${record.company_id}`,idempotency_key:`skill-capability:${record.company_id}:${record.graph_revision}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_SKILL_CAPABILITY_COLLECTION,record_id:'current',data:record,provenance:{source:'titan-workforce-skill-capability-runtime',company_id:record.company_id,authority_effect:false}});}
async function buildSkillCapabilityRegistryRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('skill-capability-cross-company-active-context');if(!raw.graph)throw new Error('skill-capability-workforce-graph-required');const record=buildSkillCapabilityRegistry({...raw,company_id},raw.graph,{...(raw.projection||{}),company_id},raw.platform_capability_registry||null);const row=await saveSkillCapabilityRegistry(record);skillCapabilityRegistriesBuilt+=1;lastSkillCapabilityRegistry=summarizeSkillCapabilityRegistry(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.skill-capability.updated',company_id,operation_id:`skill-capability:${company_id}`,actor_id:'titan-zero-skill-capability-runtime',payload:lastSkillCapabilityRegistry,authority_effect:false})}catch(_){}return {record:row.data,summary:lastSkillCapabilityRegistry,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getSkillCapabilityRegistryRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('skill-capability-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-skill-capability-runtime',operation_id:`skill-capability:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_SKILL_CAPABILITY_COLLECTION,record_id:'current'},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveWorkloadCapacity(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workload-capacity-runtime',operation_id:`workload-capacity:${record.company_id}`,idempotency_key:`workload-capacity:${record.company_id}:${record.graph_revision}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_CAPACITY_COLLECTION,record_id:'current',data:record,provenance:{source:'titan-workforce-workload-capacity-runtime',company_id:record.company_id,authority_effect:false}});}
async function buildWorkloadCapacity(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workload-capacity-cross-company-active-context');if(!raw.graph)throw new Error('workload-capacity-workforce-graph-required');const teams=(await listMissionTeams({company_id})).records;const skills=(await getSkillCapabilityRegistryRecord({company_id})).record;const record=buildWorkloadCapacitySnapshot({...raw,company_id},raw.graph,{...(raw.projection||{}),company_id},teams,skills);const row=await saveWorkloadCapacity(record);workloadCapacitySnapshotsBuilt+=1;lastWorkloadCapacity=summarizeWorkloadCapacity(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.capacity.updated',company_id,operation_id:`workload-capacity:${company_id}`,actor_id:'titan-zero-workload-capacity-runtime',payload:lastWorkloadCapacity,authority_effect:false})}catch(_){}return {record:row.data,summary:lastWorkloadCapacity,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getWorkloadCapacity(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workload-capacity-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workload-capacity-runtime',operation_id:`workload-capacity:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_CAPACITY_COLLECTION,record_id:'current'},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function savePerformanceOutcomeEvidence(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-performance-outcome-runtime',operation_id:`performance-outcomes:${record.company_id}`,idempotency_key:`performance-outcomes:${record.company_id}:${record.graph_revision}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_PERFORMANCE_OUTCOME_COLLECTION,record_id:'current',data:record,provenance:{source:'titan-workforce-performance-outcome-runtime',company_id:record.company_id,authority_effect:false}});}
async function buildPerformanceOutcomes(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('performance-cross-company-active-context');if(!raw.graph)throw new Error('performance-workforce-graph-required');const record=buildPerformanceOutcomeEvidence({...raw,company_id},raw.graph,{...(raw.projection||{}),company_id});const row=await savePerformanceOutcomeEvidence(record);performanceOutcomeSnapshotsBuilt+=1;lastPerformanceOutcomeEvidence=summarizePerformanceOutcomeEvidence(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.performance.updated',company_id,operation_id:`performance-outcomes:${company_id}`,actor_id:'titan-zero-performance-outcome-runtime',payload:lastPerformanceOutcomeEvidence,authority_effect:false})}catch(_){}return {record:row.data,summary:lastPerformanceOutcomeEvidence,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getPerformanceOutcomes(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('performance-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-performance-outcome-runtime',operation_id:`performance-outcomes:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_PERFORMANCE_OUTCOME_COLLECTION,record_id:'current'},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveDynamicStaffing(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-dynamic-staffing-runtime',operation_id:`dynamic-staffing:${record.company_id}`,idempotency_key:`dynamic-staffing:${record.company_id}:${record.graph_revision}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_DYNAMIC_STAFFING_COLLECTION,record_id:'current',data:record,provenance:{source:'titan-workforce-dynamic-staffing-runtime',company_id:record.company_id,authority_effect:false}});}
async function buildDynamicStaffing(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('dynamic-staffing-cross-company-active-context');if(!raw.graph)throw new Error('dynamic-staffing-workforce-graph-required');const capacity=(await getWorkloadCapacity({company_id})).record;if(!capacity)throw new Error('dynamic-staffing-capacity-required');const skills=(await getSkillCapabilityRegistryRecord({company_id})).record;if(!skills)throw new Error('dynamic-staffing-skill-registry-required');const teams=(await listMissionTeams({company_id})).records;const performance=(await getPerformanceOutcomes({company_id})).record;const record=buildDynamicStaffingSnapshot({...raw,company_id},raw.graph,{...(raw.projection||{}),company_id},capacity,skills,teams,performance);const row=await saveDynamicStaffing(record);dynamicStaffingSnapshotsBuilt+=1;lastDynamicStaffing=summarizeDynamicStaffing(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.dynamic-staffing.updated',company_id,operation_id:`dynamic-staffing:${company_id}`,actor_id:'titan-zero-dynamic-staffing-runtime',payload:lastDynamicStaffing,authority_effect:false})}catch(_){}return {record:row.data,summary:lastDynamicStaffing,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getDynamicStaffing(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('dynamic-staffing-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-dynamic-staffing-runtime',operation_id:`dynamic-staffing:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_DYNAMIC_STAFFING_COLLECTION,record_id:'current'},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveImprovementProposals(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-improvement-proposal-runtime',operation_id:`improvement-proposals:${record.company_id}`,idempotency_key:`improvement-proposals:${record.company_id}:${record.graph_revision}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_IMPROVEMENT_PROPOSALS_COLLECTION,record_id:'current',data:record,provenance:{source:'titan-workforce-improvement-proposal-runtime',company_id:record.company_id,authority_effect:false}});}
async function buildImprovementProposals(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('improvement-cross-company-active-context');if(!raw.graph)throw new Error('improvement-workforce-graph-required');const performance=(await getPerformanceOutcomes({company_id})).record||{};const capacity=(await getWorkloadCapacity({company_id})).record||{};const skills=(await getSkillCapabilityRegistryRecord({company_id})).record||{};const staffing=(await getDynamicStaffing({company_id})).record||{};const record=buildImprovementProposalSnapshot({...raw,company_id},raw.graph,performance,capacity,skills,staffing);const row=await saveImprovementProposals(record);improvementProposalSnapshotsBuilt+=1;lastImprovementProposals=summarizeImprovementProposals(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.improvement-proposals.updated',company_id,operation_id:`improvement-proposals:${company_id}`,actor_id:'titan-zero-improvement-proposal-runtime',payload:lastImprovementProposals,authority_effect:false})}catch(_){}return {record:row.data,summary:lastImprovementProposals,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getImprovementProposals(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('improvement-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-improvement-proposal-runtime',operation_id:`improvement-proposals:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_IMPROVEMENT_PROPOSALS_COLLECTION,record_id:'current'},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveInvestigationInstallationHandover(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-investigation-installation-handover',operation_id:`investigation-installation-handover:${record.handover_id}`,idempotency_key:`investigation-installation-handover:${record.handover_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_INVESTIGATION_INSTALLATION_HANDOVER_COLLECTION,record_id:record.handover_id,data:record,provenance:{source:'titan-workforce-investigation-installation-handover',company_id:record.company_id,deployment_mission_id:record.deployment_mission_id,authority_effect:false}});}
async function buildInvestigationInstallationHandoverRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('handover-cross-company-active-context');const record=buildInvestigationInstallationHandover({...raw,company_id});const row=await saveInvestigationInstallationHandover(record);investigationInstallationHandoversBuilt+=1;lastInvestigationInstallationHandover=summarizeInvestigationInstallationHandover(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.investigation-installation-handover.updated',company_id,operation_id:record.handover_id,actor_id:'titan-zero-investigation-installation-handover',payload:lastInvestigationInstallationHandover,authority_effect:false})}catch(_){}return {record:row.data,summary:lastInvestigationInstallationHandover,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getInvestigationInstallationHandover(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('handover-cross-company-active-context');const handover_id=cleanText(raw.handover_id||raw.deployment_mission_id&&`investigation-installation:${raw.deployment_mission_id}`||'','handover_id',220);if(!handover_id)throw new Error('handover-id-required');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-investigation-installation-handover',operation_id:`investigation-installation-handover:${handover_id}`},{module_id:'titan.workforce',collection:WORKFORCE_INVESTIGATION_INSTALLATION_HANDOVER_COLLECTION,record_id:handover_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveBusinessDiscoverySpecification(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-business-discovery-compiler',operation_id:`business-discovery:${record.discovery_id}`,idempotency_key:`business-discovery:${record.discovery_id}:${record.compiled_at}`},{module_id:'titan.workforce',collection:WORKFORCE_BUSINESS_DISCOVERY_COLLECTION,record_id:record.discovery_id,data:record,provenance:{source:'titan-workforce-business-discovery-compiler',company_id:record.company_id,source_handover_id:record.source_handover_id,authority_effect:false}});}
async function buildBusinessDiscoverySpecification(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('business-discovery-cross-company-active-context');let handover=raw.handover||raw.investigation_installation_handover||null;if(!handover){const handover_id=String(raw.handover_id||'').trim();if(!handover_id)throw new Error('business-discovery-handover-required');handover=(await getInvestigationInstallationHandover({company_id,handover_id})).record;}if(!handover)throw new Error('business-discovery-handover-not-found');const record=compileBusinessDiscoverySpecification({...raw,company_id,handover});const row=await saveBusinessDiscoverySpecification(record);businessDiscoverySpecificationsBuilt+=1;lastBusinessDiscoverySpecification=summarizeBusinessDiscoverySpecification(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.business-discovery.compiled',company_id,operation_id:record.discovery_id,actor_id:'titan-zero-business-discovery-compiler',payload:lastBusinessDiscoverySpecification,authority_effect:false})}catch(_){}return {record:row.data,summary:lastBusinessDiscoverySpecification,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getBusinessDiscoverySpecification(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('business-discovery-cross-company-active-context');const discovery_id=cleanText(raw.discovery_id||raw.handover_id&&`business-discovery:${raw.handover_id}`||'','discovery_id',220);if(!discovery_id)throw new Error('business-discovery-id-required');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-business-discovery-compiler',operation_id:`business-discovery:${discovery_id}`},{module_id:'titan.workforce',collection:WORKFORCE_BUSINESS_DISCOVERY_COLLECTION,record_id:discovery_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}


async function saveInstallationPlan(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-installation-planner',operation_id:`installation-plan:${record.installation_plan_id}`,idempotency_key:`installation-plan:${record.installation_plan_id}:${record.created_at}`},{module_id:'titan.workforce',collection:WORKFORCE_INSTALLATION_PLAN_COLLECTION,record_id:record.installation_plan_id,data:record,provenance:{source:'titan-workforce-installation-planner',company_id:record.company_id,source_discovery_id:record.source_discovery_id,authority_effect:false}});}
async function buildInstallationPlanRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('installation-plan-cross-company-active-context');let discovery=raw.discovery||raw.business_discovery||null;if(!discovery){const discovery_id=String(raw.discovery_id||'').trim();if(!discovery_id)throw new Error('installation-plan-business-discovery-required');discovery=(await getBusinessDiscoverySpecification({company_id,discovery_id})).record;}if(!discovery)throw new Error('installation-plan-discovery-not-found');const record=buildInstallationPlan({...raw,company_id,discovery});const row=await saveInstallationPlan(record);installationPlansBuilt+=1;lastInstallationPlan=summarizeInstallationPlan(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.installation-plan.built',company_id,operation_id:record.installation_plan_id,actor_id:'titan-zero-installation-planner',payload:lastInstallationPlan,authority_effect:false})}catch(_){}return {record:row.data,summary:lastInstallationPlan,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getInstallationPlan(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('installation-plan-cross-company-active-context');const installation_plan_id=cleanText(raw.installation_plan_id||raw.installation_spec_id&&`installation-plan:${raw.installation_spec_id}`||'','installation_plan_id',240);if(!installation_plan_id)throw new Error('installation-plan-id-required');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-installation-planner',operation_id:`installation-plan:${installation_plan_id}`},{module_id:'titan.workforce',collection:WORKFORCE_INSTALLATION_PLAN_COLLECTION,record_id:installation_plan_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveCommissioningGates(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-commissioning-gates',operation_id:`commissioning-gates:${record.commissioning_gate_set_id}`,idempotency_key:`commissioning-gates:${record.commissioning_gate_set_id}:${record.created_at}`},{module_id:'titan.workforce',collection:WORKFORCE_COMMISSIONING_GATES_COLLECTION,record_id:record.commissioning_gate_set_id,data:record,provenance:{source:'titan-workforce-commissioning-gates',company_id:record.company_id,source_installation_plan_id:record.source_installation_plan_id,authority_effect:false}});}
async function buildCommissioningGatesRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('commissioning-gates-cross-company-active-context');let installation_plan=raw.installation_plan||raw.plan||null;if(!installation_plan){const installation_plan_id=String(raw.installation_plan_id||'').trim();if(!installation_plan_id)throw new Error('commissioning-gates-installation-plan-required');installation_plan=(await getInstallationPlan({company_id,installation_plan_id})).record;}if(!installation_plan)throw new Error('commissioning-gates-installation-plan-not-found');const record=buildCommissioningGates({...raw,company_id,installation_plan});const row=await saveCommissioningGates(record);commissioningGateSetsBuilt+=1;lastCommissioningGates=summarizeCommissioningGates(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.commissioning-gates.built',company_id,operation_id:record.commissioning_gate_set_id,actor_id:'titan-zero-commissioning-gates',payload:lastCommissioningGates,authority_effect:false})}catch(_){}return {record:row.data,summary:lastCommissioningGates,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getCommissioningGates(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('commissioning-gates-cross-company-active-context');const commissioning_gate_set_id=cleanText(raw.commissioning_gate_set_id||raw.installation_plan_id&&`commissioning:${raw.installation_plan_id}`||'','commissioning_gate_set_id',240);if(!commissioning_gate_set_id)throw new Error('commissioning-gates-id-required');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-commissioning-gates',operation_id:`commissioning-gates:${commissioning_gate_set_id}`},{module_id:'titan.workforce',collection:WORKFORCE_COMMISSIONING_GATES_COLLECTION,record_id:commissioning_gate_set_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}



async function saveLiveLaravelHostCertification(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-live-host-certification',operation_id:`live-host-certification:${record.certification_id}`,idempotency_key:`live-host-certification:${record.certification_id}:${record.created_at}`},{module_id:'titan.workforce',collection:WORKFORCE_LIVE_HOST_CERTIFICATION_COLLECTION,record_id:record.certification_id,data:record,provenance:{source:'titan-workforce-live-laravel-host-certification',company_id:record.company_id,source_commissioning_gate_set_id:record.source_commissioning_gate_set_id,authority_effect:false}});}
async function buildLiveLaravelHostCertificationRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('live-host-certification-cross-company-active-context');let commissioning=raw.commissioning_gates||raw.commissioning||null;if(!commissioning){const commissioning_gate_set_id=String(raw.commissioning_gate_set_id||'').trim();if(!commissioning_gate_set_id)throw new Error('live-host-certification-commissioning-required');commissioning=(await getCommissioningGates({company_id,commissioning_gate_set_id})).record;}if(!commissioning)throw new Error('live-host-certification-commissioning-not-found');const record=buildLiveLaravelHostCertification({...raw,company_id,commissioning_gates:commissioning});const row=await saveLiveLaravelHostCertification(record);liveHostCertificationsBuilt+=1;lastLiveHostCertification=summarizeLiveLaravelHostCertification(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.live-host-certification.updated',company_id,operation_id:record.certification_id,actor_id:'titan-zero-live-host-certification',payload:lastLiveHostCertification,authority_effect:false})}catch(_){}return {record:row.data,summary:lastLiveHostCertification,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function saveWorkforceBrowserLiveSmokeCertification(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-browser-live-smoke',operation_id:`browser-live-smoke:${record.company_id}`,idempotency_key:`browser-live-smoke:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_BROWSER_LIVE_SMOKE_COLLECTION,record_id:'current',data:record,provenance:{source:'titan-workforce-browser-live-smoke',company_id:record.company_id,authority_effect:false}});}
async function buildAndSaveWorkforceBrowserLiveSmokeCertification(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('browser-live-smoke-cross-company-active-context');const record=buildWorkforceBrowserLiveSmokeCertification({...raw,company_id});const row=await saveWorkforceBrowserLiveSmokeCertification(record);return {record:row.data,summary:summarizeWorkforceBrowserLiveSmokeCertification(record),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getWorkforceBrowserLiveSmokeCertification(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('browser-live-smoke-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-browser-live-smoke',operation_id:`browser-live-smoke:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_BROWSER_LIVE_SMOKE_COLLECTION,record_id:'current'},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function saveWorkforceEndToEndCertification(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-e2e-certification',operation_id:`e2e-certification:${record.company_id}`,idempotency_key:`e2e-certification:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_E2E_CERTIFICATION_COLLECTION,record_id:'current',data:record,provenance:{source:'titan-workforce-cross-system-e2e-certification',company_id:record.company_id,authority_effect:false}});}
async function getWorkforceEndToEndCertification(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('e2e-certification-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-e2e-certification',operation_id:`e2e-certification:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_E2E_CERTIFICATION_COLLECTION,record_id:'current'},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function buildAndSaveWorkforceEndToEndCertification(raw={}){const record=buildWorkforceEndToEndCertification(raw);await saveWorkforceEndToEndCertification(record);return {record,summary:summarizeWorkforceEndToEndCertification(record),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getLiveLaravelHostCertification(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('live-host-certification-cross-company-active-context');const certification_id=cleanText(raw.certification_id||`live-host-certification:${company_id}`,'certification_id',240);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-live-host-certification',operation_id:`live-host-certification:${certification_id}`},{module_id:'titan.workforce',collection:WORKFORCE_LIVE_HOST_CERTIFICATION_COLLECTION,record_id:certification_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveCrossVersionCompatibility(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-cross-version-compatibility',operation_id:`cross-version:${record.transition_id}`,idempotency_key:`cross-version:${record.transition_id}:${record.source_version}:${record.target_version}:${record.created_at}`},{module_id:'titan.workforce',collection:WORKFORCE_CROSS_VERSION_COMPATIBILITY_COLLECTION,record_id:record.transition_id,data:record,provenance:{source:'titan-workforce-cross-version-compatibility',company_id:record.company_id,source_version:record.source_version,target_version:record.target_version,direction:record.direction,authority_effect:false}});}
async function buildCrossVersionCompatibilityRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('cross-version-cross-company-active-context');const record=buildCrossVersionCompatibility({...raw,company_id});const row=await saveCrossVersionCompatibility(record);return {record:row.data,summary:summarizeCrossVersionCompatibility(record),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getCrossVersionCompatibility(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('cross-version-cross-company-active-context');const transition_id=cleanText(raw.transition_id||'','transition_id',240);await businessDatabaseReady;if(transition_id){const row=await database.getRecord({company_id,actor_id:'titan-zero-cross-version-compatibility',operation_id:`cross-version:${transition_id}`},{module_id:'titan.workforce',collection:WORKFORCE_CROSS_VERSION_COMPATIBILITY_COLLECTION,record_id:transition_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}const rows=await database.listRecords({company_id,module_id:'titan.workforce',collection:WORKFORCE_CROSS_VERSION_COMPATIBILITY_COLLECTION,includeDeleted:true});const latest=(rows||[]).map(x=>x?.data).filter(Boolean).sort((a,b)=>Number(b.created_at||0)-Number(a.created_at||0))[0]||null;return {record:latest,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveMigrationUpgradeSafety(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-migration-upgrade-safety',operation_id:`migration-upgrade:${record.migration_run_id}`,idempotency_key:`migration-upgrade:${record.migration_run_id}:${record.updated_at}:${record.phase}`},{module_id:'titan.workforce',collection:WORKFORCE_MIGRATION_UPGRADE_SAFETY_COLLECTION,record_id:record.migration_run_id,data:record,provenance:{source:'titan-workforce-migration-upgrade-safety',company_id:record.company_id,source_version:record.source_version,target_version:record.target_version,authority_effect:false}});}
async function buildMigrationUpgradeSafetyRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('migration-upgrade-cross-company-active-context');const record=buildMigrationUpgradeSafety({...raw,company_id});const row=await saveMigrationUpgradeSafety(record);migrationUpgradeSafetyRecordsBuilt+=1;lastMigrationUpgradeSafety=summarizeMigrationUpgradeSafety(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.migration-upgrade.prepared',company_id,operation_id:record.migration_run_id,actor_id:'titan-zero-migration-upgrade-safety',payload:lastMigrationUpgradeSafety,authority_effect:false})}catch(_){}return {record:row.data,summary:lastMigrationUpgradeSafety,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getMigrationUpgradeSafety(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('migration-upgrade-cross-company-active-context');const migration_run_id=cleanText(raw.migration_run_id,'migration_run_id',240);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-migration-upgrade-safety',operation_id:`migration-upgrade:${migration_run_id}`},{module_id:'titan.workforce',collection:WORKFORCE_MIGRATION_UPGRADE_SAFETY_COLLECTION,record_id:migration_run_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function transitionMigrationUpgradeSafetyRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('migration-upgrade-cross-company-active-context');const found=await getMigrationUpgradeSafety({company_id,migration_run_id:raw.migration_run_id});if(!found.record)throw new Error('migration-upgrade-record-not-found');const record=transitionMigrationUpgradeSafety(found.record,{...raw,company_id});const row=await saveMigrationUpgradeSafety(record);migrationUpgradeTransitions+=1;lastMigrationUpgradeSafety=summarizeMigrationUpgradeSafety(record);return {record:row.data,summary:lastMigrationUpgradeSafety,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function executeRegisteredWorkforceMigrations(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('migration-upgrade-cross-company-active-context');const found=await getMigrationUpgradeSafety({company_id,migration_run_id:raw.migration_run_id});if(!found.record)throw new Error('migration-upgrade-record-not-found');const requested=new Set((found.record.migrations||[]).map(x=>x.migration_id));const registered=WORKFORCE_REGISTERED_MIGRATIONS.filter(x=>requested.has(x.id));if(registered.length!==requested.size)throw new Error('migration-upgrade-unregistered-request');const applying=transitionMigrationUpgradeSafety(found.record,{company_id,type:found.record.phase==='RECOVERY_REQUIRED'?'RESUME':'START',checkpoint_id:`${found.record.migration_run_id}:applying`});await saveMigrationUpgradeSafety(applying);const result=await executeRegisteredMigrationPlan({database,context:{company_id,actor_id:'titan-zero-migration-upgrade-safety',operation_id:found.record.migration_run_id,idempotency_key:`migration-run:${found.record.migration_run_id}`},record:applying,registry:WORKFORCE_REGISTERED_MIGRATIONS});const verifying=transitionMigrationUpgradeSafety(applying,{company_id,type:'APPLIED',checkpoint_id:`${found.record.migration_run_id}:verifying`});const row=await saveMigrationUpgradeSafety(verifying);lastMigrationUpgradeSafety=summarizeMigrationUpgradeSafety(verifying);return {record:row.data,result:result.result,summary:lastMigrationUpgradeSafety,authority_granted:false,execution_permitted:false,grants_authority:false};}


async function saveUninstallReversibility(record){await businessDatabaseReady;return database.putRecord({company_id:record.company_id,actor_id:'titan-zero-uninstall-reversibility',operation_id:`uninstall-reversibility:${record.uninstall_id}`,idempotency_key:`uninstall-reversibility:${record.uninstall_id}:${record.updated_at}:${record.phase}`},{module_id:'titan.workforce',collection:WORKFORCE_UNINSTALL_REVERSIBILITY_COLLECTION,record_id:record.uninstall_id,data:record,provenance:{source:'titan-workforce-uninstall-reversibility',company_id:record.company_id,authority_effect:false}});}
async function buildUninstallReversibilityRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('uninstall-reversibility-cross-company-active-context');const record=buildUninstallReversibilityPlan({...raw,company_id});const row=await saveUninstallReversibility(record);uninstallReversibilityPlansBuilt+=1;lastUninstallReversibility=summarizeUninstallReversibility(record);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.uninstall-reversibility.prepared',company_id,operation_id:record.uninstall_id,actor_id:'titan-zero-uninstall-reversibility',payload:lastUninstallReversibility,authority_effect:false})}catch(_){}return {record:row.data,summary:lastUninstallReversibility,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getUninstallReversibility(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('uninstall-reversibility-cross-company-active-context');const uninstall_id=cleanText(raw.uninstall_id||`workforce-uninstall:${company_id}`,'uninstall_id',240);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-uninstall-reversibility',operation_id:`uninstall-reversibility:${uninstall_id}`},{module_id:'titan.workforce',collection:WORKFORCE_UNINSTALL_REVERSIBILITY_COLLECTION,record_id:uninstall_id},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function transitionUninstallReversibilityRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('uninstall-reversibility-cross-company-active-context');const found=await getUninstallReversibility({company_id,uninstall_id:raw.uninstall_id});if(!found.record)throw new Error('uninstall-reversibility-record-not-found');const record=transitionUninstallReversibility(found.record,{...raw,company_id});const row=await saveUninstallReversibility(record);uninstallReversibilityTransitions+=1;lastUninstallReversibility=summarizeUninstallReversibility(record);return {record:row.data,summary:lastUninstallReversibility,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveDecisionRightsPolicy(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('decision-rights-cross-company-active-context');const policy=createDecisionRightsPolicy({...raw,company_id});await businessDatabaseReady;const row=await database.putRecord({company_id,actor_id:'titan-zero-decision-rights-runtime',operation_id:`decision-rights:${policy.policy_id}`,idempotency_key:`decision-rights:${policy.policy_id}:${policy.revision}`},{module_id:'titan.workforce',collection:WORKFORCE_DECISION_RIGHTS_COLLECTION,record_id:policy.policy_id,data:policy,provenance:{source:'titan-workforce-decision-rights-runtime',company_id,authority_effect:false}});decisionRightsPoliciesSaved+=1;return {policy:row.data,grants_authority:false,execution_permitted:false};
}
async function getDecisionRightsPolicy(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('decision-rights-cross-company-active-context');const policy_id=cleanText(raw.policy_id||'workforce-default','policy_id',180);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-decision-rights-runtime',operation_id:`decision-rights:${policy_id}`},{module_id:'titan.workforce',collection:WORKFORCE_DECISION_RIGHTS_COLLECTION,record_id:policy_id},{includeDeleted:true});return {policy:row?.data||null,grants_authority:false,execution_permitted:false};}
async function evaluateDecisionRights(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('decision-rights-cross-company-active-context');const fetched=raw.policy?{policy:raw.policy}:await getDecisionRightsPolicy({company_id,policy_id:raw.policy_id||'workforce-default'});if(!fetched.policy)throw new Error('decision-rights-policy-not-found');const teams=(await listMissionTeams({company_id})).records;const supervisors=(await listSupervisorRecords({company_id})).records;const graph=raw.graph;if(!graph)throw new Error('decision-rights-workforce-graph-required');const evaluation=raw.matrix===true?evaluateDecisionRightsMatrix(fetched.policy,{...raw,company_id},graph,teams,supervisors):evaluateDecisionRight(fetched.policy,{...raw,company_id},graph,teams,supervisors);decisionRightsEvaluations+=1;lastDecisionRightsEvaluation=raw.matrix===true?{company_id,actor_worker_id:evaluation.actor_worker_id,decision_class:evaluation.decision_class,matrix:true,grants_authority:false}:summarizeDecisionRightsEvaluation(evaluation);try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.decision-rights.evaluated',company_id,operation_id:`decision-rights-eval:${Date.now()}`,actor_id:'titan-zero-decision-rights-runtime',payload:lastDecisionRightsEvaluation,authority_effect:false})}catch(_){}return {evaluation,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function acknowledgeSupervisorEscalation(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('supervision-cross-company-active-context');const found=await getSupervisorRecord(raw);if(!found.record)throw new Error('supervision-record-required');
  const record=acknowledgeEscalation(found.record,{...raw,company_id});const row=await saveSupervisorRecord(record);supervisorEscalationsAcknowledged+=1;lastSupervisorCoordination=summarizeSupervisorCoordination(record);return {record:row.data,summary:lastSupervisorCoordination,grants_authority:false};
}
async function prepareSupervisorHandoverRecord(raw={}){
  const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('supervision-cross-company-active-context');const found=await getSupervisorRecord(raw);if(!found.record)throw new Error('supervision-record-required');
  const record=prepareSupervisorHandover(found.record,{...raw,company_id},raw.graph);const row=await saveSupervisorRecord(record);supervisorHandoversPrepared+=1;lastSupervisorCoordination=summarizeSupervisorCoordination(record);
  try{await globalThis.TitanZeroRuntime?.emit?.({type:'titan.workforce.supervision.handover.prepared',company_id,operation_id:record.handover_history.at(-1)?.handover_id||`supervision:${record.supervisor_worker_id}`,actor_id:'titan-zero-supervision-runtime',payload:lastSupervisorCoordination,authority_effect:false})}catch(_){}
  return {record:row.data,summary:lastSupervisorCoordination,grants_authority:false};
}

async function persistControlIntent(raw){
  const company_id=await activeCompanyId();
  const intent=normalizeWorkforceControlIntent(raw,{company_id:company_id||raw?.company_id});
  await businessDatabaseReady;
  await database.putRecord({
    company_id:intent.company_id,
    actor_id:'titan-zero-workforce-ui',
    operation_id:intent.intent_id,
    idempotency_key:`workforce-control:${intent.intent_id}`,
  },{
    module_id:'titan.workforce',
    collection:'control_intents',
    record_id:intent.intent_id,
    data:intent,
    provenance:{source:'titan-client-workforce-controls',company_id:intent.company_id,authority_effect:false},
  });
  preparedControlIntents+=1; lastControlIntent=intent;
  try{await globalThis.TitanZeroRuntime?.emit?.({
    type:'titan.workforce.control.intent.prepared',company_id:intent.company_id,operation_id:intent.intent_id,
    actor_id:'titan-zero-workforce-ui',payload:{action:intent.action,target_ref:intent.target_ref},authority_effect:false,
  })}catch(_){}
  return intent;
}

async function persistInvestigation(raw){
  const packet=normalizeInvestigationParticipationPacket(raw);
  const current=await activeCompanyId();
  if(current&&packet.company_id!==current)throw new Error('investigation-cross-company-active-context');
  await businessDatabaseReady;
  await database.putRecord({
    company_id:packet.company_id,
    actor_id:'titan-zero-investigation-manager',
    operation_id:packet.participation_plan_id,
    idempotency_key:null,
  },{
    module_id:'titan.workforce',
    collection:'investigation_participation',
    record_id:packet.participation_plan_id,
    data:packet,
    provenance:{source_of_truth:packet.source_of_truth,deployment_mission_id:packet.deployment_mission_id,company_id:packet.company_id,authority_effect:false},
  });
  investigationPlans+=1; lastInvestigation=investigationParticipationSummary(packet);
  try{await globalThis.TitanZeroRuntime?.emit?.({
    type:'titan.workforce.investigation.participation.registered',company_id:packet.company_id,
    operation_id:packet.participation_plan_id,actor_id:'titan-zero-investigation-manager',payload:lastInvestigation,authority_effect:false,
  })}catch(_){}
  return packet;
}


async function saveWorkforceSecurityPosture(record){await businessDatabaseReady;await database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-security',operation_id:`security-posture:${record.company_id}`,idempotency_key:`security-posture:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_SECURITY_POSTURE_COLLECTION,record_id:`security-posture:${record.company_id}`,data:record,provenance:{source:'titan-workforce-security',company_id:record.company_id,authority_effect:false}});return record;}
async function buildWorkforceSecurityPostureRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-security-cross-company-active-context');const record=await buildWorkforceSecurityPosture({...raw,company_id});await saveWorkforceSecurityPosture(record);workforceSecurityPosturesBuilt+=1;lastWorkforceSecurityPosture=summarizeWorkforceSecurityPosture(record);return {record,summary:lastWorkforceSecurityPosture,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getWorkforceSecurityPosture(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-security-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-security',operation_id:`security-posture:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_SECURITY_POSTURE_COLLECTION,record_id:`security-posture:${company_id}`},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function prepareAndClaimWorkforceSecurityEnvelope(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-security-cross-company-active-context');const envelope=await prepareWorkforceSecurityEnvelope({...raw,company_id});await verifyWorkforceSecurityEnvelope(envelope,{company_id});await businessDatabaseReady;const record_id=`nonce:${company_id}:${envelope.nonce}`;const prior=await database.getRecord({company_id,actor_id:'titan-zero-workforce-security',operation_id:record_id},{module_id:'titan.workforce',collection:WORKFORCE_SECURITY_NONCE_COLLECTION,record_id},{includeDeleted:true});if(prior?.data)throw new Error('workforce-security-replay-detected');await database.putRecord({company_id,actor_id:'titan-zero-workforce-security',operation_id:record_id,idempotency_key:record_id},{module_id:'titan.workforce',collection:WORKFORCE_SECURITY_NONCE_COLLECTION,record_id,data:{company_id,nonce:envelope.nonce,request_id:envelope.request_id,idempotency_key:envelope.idempotency_key,request_digest:envelope.request_digest,issued_at:envelope.issued_at,expires_at:envelope.expires_at,consumed:true,grants_authority:false},provenance:{source:'titan-workforce-security-envelope',company_id,authority_effect:false}});workforceSecurityEnvelopesPrepared+=1;return {envelope,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function buildWorkforceSecurityEvidenceChainRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-security-cross-company-active-context');const chain=await chainWorkforceSecurityEvidence({...raw,company_id});return {chain,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function saveWorkforcePrivacyEvidenceControls(record){await businessDatabaseReady;await database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-privacy',operation_id:`privacy-evidence:${record.company_id}`,idempotency_key:`privacy-evidence:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_PRIVACY_EVIDENCE_COLLECTION,record_id:`privacy-evidence:${record.company_id}`,data:record,provenance:{source:'titan-workforce-privacy-evidence',company_id:record.company_id,authority_effect:false}});return record;}
async function buildWorkforcePrivacyEvidenceControlsRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-privacy-cross-company-active-context');const record=buildWorkforcePrivacyEvidenceControls({...raw,company_id});await saveWorkforcePrivacyEvidenceControls(record);workforcePrivacyEvidenceControlsBuilt+=1;lastWorkforcePrivacyEvidenceControls=summarizeWorkforcePrivacyEvidenceControls(record);return {record,summary:lastWorkforcePrivacyEvidenceControls,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getWorkforcePrivacyEvidenceControls(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-privacy-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-privacy',operation_id:`privacy-evidence:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_PRIVACY_EVIDENCE_COLLECTION,record_id:`privacy-evidence:${company_id}`},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function evaluateWorkforceEvidenceAccessRecord(raw={}){const {record}=await getWorkforcePrivacyEvidenceControls(raw);if(!record)throw new Error('workforce-privacy-controls-not-found');return {decision:evaluateWorkforceEvidenceAccess(record,raw),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function prepareWorkforceEvidenceExportRecord(raw={}){const {record}=await getWorkforcePrivacyEvidenceControls(raw);if(!record)throw new Error('workforce-privacy-controls-not-found');return {decision:prepareWorkforceEvidenceExport(record,raw),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function prepareWorkforceEvidenceDeletionRecord(raw={}){const {record}=await getWorkforcePrivacyEvidenceControls(raw);if(!record)throw new Error('workforce-privacy-controls-not-found');return {decision:prepareWorkforceEvidenceDeletion(record,raw),authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveWorkforceIntelligenceRouting(record){await businessDatabaseReady;await database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-intelligence',operation_id:`intelligence-routing:${record.company_id}`,idempotency_key:`intelligence-routing:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_INTELLIGENCE_ROUTING_COLLECTION,record_id:`intelligence-routing:${record.company_id}`,data:record,provenance:{source:'titan-workforce-intelligence-routing',company_id:record.company_id,authority_effect:false}});return record;}
async function buildWorkforceIntelligenceRoutingRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-intelligence-cross-company-active-context');const record=buildWorkforceIntelligenceRoutingPolicy({...raw,company_id});await saveWorkforceIntelligenceRouting(record);workforceIntelligencePoliciesBuilt+=1;lastWorkforceIntelligenceRouting=summarizeWorkforceIntelligenceRouting(record);return {record,summary:lastWorkforceIntelligenceRouting,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getWorkforceIntelligenceRouting(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-intelligence-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-intelligence',operation_id:`intelligence-routing:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_INTELLIGENCE_ROUTING_COLLECTION,record_id:`intelligence-routing:${company_id}`},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function selectWorkforceIntelligenceRouteRecord(raw={}){const {record}=await getWorkforceIntelligenceRouting(raw);if(!record)throw new Error('workforce-intelligence-routing-not-found');return {selection:selectWorkforceIntelligenceRoute(record,raw),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function recordWorkforceProviderReceipt(raw={}){const {record}=await getWorkforceIntelligenceRouting(raw);if(!record)throw new Error('workforce-intelligence-routing-not-found');const receipt=buildWorkforceProviderReceipt(record,raw.selection||{},raw.usage||{});await businessDatabaseReady;await database.putRecord({company_id:receipt.company_id,actor_id:'titan-zero-workforce-intelligence',operation_id:`provider-receipt:${receipt.receipt_id}`,idempotency_key:receipt.receipt_id},{module_id:'titan.workforce',collection:WORKFORCE_PROVIDER_RECEIPTS_COLLECTION,record_id:receipt.receipt_id,data:receipt,provenance:{source:'titan-workforce-provider-receipt',company_id:receipt.company_id,authority_effect:false}});workforceProviderReceiptsRecorded+=1;return {receipt,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveWorkforceKnowledgeAuthority(record){await businessDatabaseReady;await database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-knowledge',operation_id:`knowledge-authority:${record.company_id}`,idempotency_key:`knowledge-authority:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_KNOWLEDGE_AUTHORITY_COLLECTION,record_id:`knowledge-authority:${record.company_id}`,data:record,provenance:{source:'titan-workforce-knowledge-authority',company_id:record.company_id,authority_effect:false}});return record;}
async function buildWorkforceKnowledgeAuthorityRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-knowledge-cross-company-active-context');const record=buildWorkforceKnowledgeAuthorityPacket({...raw,company_id});await saveWorkforceKnowledgeAuthority(record);workforceKnowledgePacketsBuilt+=1;lastWorkforceKnowledgeAuthority=summarizeWorkforceKnowledgeAuthority(record);return {record,summary:lastWorkforceKnowledgeAuthority,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getWorkforceKnowledgeAuthority(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('workforce-knowledge-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-knowledge',operation_id:`knowledge-authority:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_KNOWLEDGE_AUTHORITY_COLLECTION,record_id:`knowledge-authority:${company_id}`},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function evaluateWorkforceKnowledgeUseRecord(raw={}){const {record}=await getWorkforceKnowledgeAuthority(raw);if(!record)throw new Error('workforce-knowledge-authority-not-found');return {decision:evaluateWorkforceKnowledgeUse(record,raw),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function recordWorkforceKnowledgeUseReceipt(raw={}){const {record}=await getWorkforceKnowledgeAuthority(raw);if(!record)throw new Error('workforce-knowledge-authority-not-found');const decision=evaluateWorkforceKnowledgeUse(record,raw);const receipt=buildWorkforceKnowledgeUseReceipt(record,decision,raw);await businessDatabaseReady;await database.putRecord({company_id:receipt.company_id,actor_id:'titan-zero-workforce-knowledge',operation_id:`knowledge-use:${receipt.receipt_id}`,idempotency_key:receipt.receipt_id},{module_id:'titan.workforce',collection:WORKFORCE_KNOWLEDGE_USE_RECEIPTS_COLLECTION,record_id:receipt.receipt_id,data:receipt,provenance:{source:'titan-workforce-knowledge-use',company_id:receipt.company_id,authority_effect:false}});workforceKnowledgeUseReceiptsRecorded+=1;return {receipt,decision,authority_granted:false,execution_permitted:false,grants_authority:false};}

async function saveWorkforceWorkerMemory(record){await businessDatabaseReady;await database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-memory',operation_id:`worker-memory:${record.worker_id}`,idempotency_key:`worker-memory:${record.company_id}:${record.worker_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_WORKER_MEMORY_COLLECTION,record_id:`worker-memory:${record.worker_id}`,data:record,provenance:{source:'titan-workforce-worker-memory',company_id:record.company_id,worker_id:record.worker_id,authority_effect:false}});return record;}
async function buildWorkforceWorkerMemoryRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('worker-memory-cross-company-active-context');const record=buildWorkforceWorkerMemorySnapshot({...raw,company_id});await saveWorkforceWorkerMemory(record);workforceWorkerMemorySnapshotsBuilt+=1;lastWorkforceWorkerMemory=summarizeWorkforceWorkerMemory(record);return {record,summary:lastWorkforceWorkerMemory,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getWorkforceWorkerMemory(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('worker-memory-cross-company-active-context');const worker_id=cleanText(raw.worker_id,'worker_id',180);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-memory',operation_id:`worker-memory:${worker_id}`},{module_id:'titan.workforce',collection:WORKFORCE_WORKER_MEMORY_COLLECTION,record_id:`worker-memory:${worker_id}`},{includeDeleted:true});if(row?.data?.company_id&&row.data.company_id!==company_id)throw new Error('worker-memory-cross-company-record');return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function recallWorkforceWorkerMemoryRecord(raw={}){const {record}=await getWorkforceWorkerMemory(raw);if(!record)throw new Error('worker-memory-not-found');return {recall:recallWorkforceWorkerMemory(record,raw),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function recordWorkforceWorkerMemoryRecallReceipt(raw={}){const {record}=await getWorkforceWorkerMemory(raw);if(!record)throw new Error('worker-memory-not-found');const recall=recallWorkforceWorkerMemory(record,raw);const receipt=buildWorkforceWorkerMemoryRecallReceipt(record,recall,raw);await businessDatabaseReady;await database.putRecord({company_id:receipt.company_id,actor_id:'titan-zero-workforce-memory',operation_id:`worker-memory-recall:${receipt.receipt_id}`,idempotency_key:receipt.receipt_id},{module_id:'titan.workforce',collection:WORKFORCE_WORKER_MEMORY_RECALL_RECEIPTS_COLLECTION,record_id:receipt.receipt_id,data:receipt,provenance:{source:'titan-workforce-worker-memory-recall',company_id:receipt.company_id,worker_id:receipt.worker_id,authority_effect:false}});workforceWorkerMemoryRecallReceiptsRecorded+=1;return {receipt,recall,authority_granted:false,execution_permitted:false,grants_authority:false};}


async function saveUnifiedWorkforce(record){await businessDatabaseReady;await database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-unification',operation_id:`human-ai-unification:${record.company_id}`,idempotency_key:`human-ai-unification:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_HUMAN_AI_UNIFICATION_COLLECTION,record_id:`human-ai-unification:${record.company_id}`,data:record,provenance:{source:'titan-workforce-human-ai-unification',company_id:record.company_id,authority_effect:false}});return record;}
async function buildUnifiedWorkforceRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('human-ai-unification-cross-company-active-context');const record=buildUnifiedWorkforceSnapshot({...raw,company_id});await saveUnifiedWorkforce(record);unifiedWorkforceSnapshotsBuilt+=1;lastUnifiedWorkforce=summarizeUnifiedWorkforce(record);return {record,summary:lastUnifiedWorkforce,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getUnifiedWorkforce(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('human-ai-unification-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-unification',operation_id:`human-ai-unification:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_HUMAN_AI_UNIFICATION_COLLECTION,record_id:`human-ai-unification:${company_id}`},{includeDeleted:true});if(row?.data?.company_id&&row.data.company_id!==company_id)throw new Error('human-ai-unification-cross-company-record');return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function evaluateUnifiedWorkforceAssignmentRecord(raw={}){const {record}=await getUnifiedWorkforce(raw);if(!record)throw new Error('human-ai-unification-not-found');return {evaluation:evaluateUnifiedWorkerAssignment(record,raw),authority_granted:false,execution_permitted:false,grants_authority:false};}


const snapshot=()=>Object.freeze({
  id:'titan-zero-workforce-runtime',
  protocol:'titan.workforce.runtime.v1',
  authority:'titan-zero',
  companyBoundary:'company_id',
  persistenceAuthority:'TitanBusinessDatabase',
  clientControlMode:'proposal_only',
  investigationSourceOfTruth:'deployment_workforce',
  preparedControlIntents,
  investigationPlans,
  lastControlIntent,
  lastInvestigation,
  observability:Object.freeze({operationClaims,duplicateOperationClaims,operationFailures,syncRecoveryCheckpoints,retryEvaluations,retriesScheduled,manualReviewsRequired,workforceGraphsBuilt,missionTeamsCreated,missionTeamTransitions,supervisorRecordsCreated,supervisorEscalationsAcknowledged,supervisorHandoversPrepared,chiefOfStaffSnapshotsBuilt,decisionRightsPoliciesSaved,decisionRightsEvaluations,workloadCapacitySnapshotsBuilt,skillCapabilityRegistriesBuilt,dynamicStaffingSnapshotsBuilt,lastDynamicStaffing,lastSkillCapabilityRegistry,lastChiefOfStaffCoordination,lastDecisionRightsEvaluation,lastWorkloadCapacity,lastOperation,lastSyncRecovery,lastRetryDecision,lastWorkforceGraph,lastMissionTeam,lastSupervisorCoordination,unifiedWorkforceSnapshotsBuilt,lastUnifiedWorkforce,grants_authority:false,authority_effect:false}),
  grants_authority:false,
  authority_effect:false,
});

globalThis.__TITAN_WORKFORCE_BACKGROUND_RUNTIME__=Object.freeze({snapshot,persistControlIntent,persistInvestigation,buildInvestigationInstallationHandoverRecord,getInvestigationInstallationHandover,buildMigrationUpgradeSafetyRecord,getMigrationUpgradeSafety,transitionMigrationUpgradeSafetyRecord,executeRegisteredWorkforceMigrations,buildWorkforceGraph,createMissionTeam,transitionMissionTeamRecord,getMissionTeamRecord,listMissionTeams,upsertSupervisorRecord,getSupervisorRecord,listSupervisorRecords,acknowledgeSupervisorEscalation,prepareSupervisorHandoverRecord,buildChiefOfStaffCoordination,getChiefOfStaffCoordination,saveDecisionRightsPolicy,getDecisionRightsPolicy,evaluateDecisionRights,buildWorkloadCapacity,getWorkloadCapacity,buildDynamicStaffing,getDynamicStaffing,claimWorkforceOperation,completeWorkforceOperation,getWorkforceOperation,classifyWorkforceFailure,evaluateWorkforceRetry,evaluateWorkerAuthorityDecision,prepareGovernedCommandEnvelope,assertAuthoritativeExecutionReceipt,assertPostActionVerification,authority_effect:false});

try{
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(message?.type==='TITAN_WORKFORCE_CONTROL_INTENT'){
      persistControlIntent(message.payload||message.intent||message.detail)
        .then(intent=>sendResponse({ok:true,state:'prepared',intent,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message}));
      return true;
    }
    if(message?.type==='TITAN_INVESTIGATION_PARTICIPATION'){
      persistInvestigation(message.payload||message.packet||message.detail)
        .then(packet=>sendResponse({ok:true,state:'registered',summary:investigationParticipationSummary(packet),authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message}));
      return true;
    }



    if(message?.type==='TITAN_WORKFORCE_SYNC_RECOVERY_CHECKPOINT'){
      persistWorkforceSyncRecovery(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SYNC_RECOVERY_GET'){
      getWorkforceSyncRecovery(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SYNC_RECOVERY_COMPLETE'){
      completeWorkforceSyncRecovery(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }


    if(message?.type==='TITAN_WORKFORCE_MISSION_TEAM_CREATE'){
      createMissionTeam(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_MISSION_TEAM_TRANSITION'){
      transitionMissionTeamRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_MISSION_TEAM_GET'){
      getMissionTeamRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_MISSION_TEAM_LIST'){
      listMissionTeams(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }


    if(message?.type==='TITAN_WORKFORCE_SUPERVISION_UPSERT'){
      upsertSupervisorRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SUPERVISION_GET'){
      getSupervisorRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SUPERVISION_LIST'){
      listSupervisorRecords(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SUPERVISION_ESCALATION_ACK'){
      acknowledgeSupervisorEscalation(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SUPERVISION_HANDOVER_PREPARE'){
      prepareSupervisorHandoverRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_CHIEF_OF_STAFF_BUILD'){
      buildChiefOfStaffCoordination(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_CHIEF_OF_STAFF_GET'){
      getChiefOfStaffCoordination(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_DECISION_RIGHTS_SAVE'){
      saveDecisionRightsPolicy(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_DECISION_RIGHTS_GET'){
      getDecisionRightsPolicy(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_DECISION_RIGHTS_EVALUATE'){
      evaluateDecisionRights(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }



    if(message?.type==='TITAN_WORKFORCE_SKILL_CAPABILITY_BUILD'){
      buildSkillCapabilityRegistryRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SKILL_CAPABILITY_GET'){
      getSkillCapabilityRegistryRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_CAPACITY_BUILD'){
      buildWorkloadCapacity(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_CAPACITY_GET'){
      getWorkloadCapacity(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_PERFORMANCE_BUILD'){
      buildPerformanceOutcomes(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_PERFORMANCE_GET'){
      getPerformanceOutcomes(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_DYNAMIC_STAFFING_BUILD'){
      buildDynamicStaffing(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_DYNAMIC_STAFFING_GET'){
      getDynamicStaffing(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_IMPROVEMENT_BUILD'){
      buildImprovementProposals(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_IMPROVEMENT_GET'){
      getImprovementProposals(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_INVESTIGATION_INSTALLATION_HANDOVER_BUILD'){
      buildInvestigationInstallationHandoverRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_INVESTIGATION_INSTALLATION_HANDOVER_GET'){
      getInvestigationInstallationHandover(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_BUSINESS_DISCOVERY_BUILD'){
      buildBusinessDiscoverySpecification(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_BUSINESS_DISCOVERY_GET'){
      getBusinessDiscoverySpecification(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_INSTALLATION_PLAN_BUILD'){
      buildInstallationPlanRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_INSTALLATION_PLAN_GET'){
      getInstallationPlan(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_COMMISSIONING_GATES_BUILD'){
      buildCommissioningGatesRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_COMMISSIONING_GATES_GET'){
      getCommissioningGates(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_LIVE_HOST_CERTIFICATION_BUILD'){
      buildLiveLaravelHostCertificationRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_LIVE_HOST_CERTIFICATION_GET'){
      getLiveLaravelHostCertification(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }


    if(message?.type==='TITAN_WORKFORCE_CROSS_VERSION_COMPATIBILITY_BUILD'){
      buildCrossVersionCompatibilityRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_CROSS_VERSION_COMPATIBILITY_GET'){
      getCrossVersionCompatibility(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_MIGRATION_UPGRADE_BUILD'){
      buildMigrationUpgradeSafetyRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_MIGRATION_UPGRADE_GET'){
      getMigrationUpgradeSafety(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_MIGRATION_UPGRADE_TRANSITION'){
      transitionMigrationUpgradeSafetyRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_MIGRATION_UPGRADE_EXECUTE_REGISTERED'){
      executeRegisteredWorkforceMigrations(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_UNINSTALL_REVERSIBILITY_BUILD'){
      buildUninstallReversibilityRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_UNINSTALL_REVERSIBILITY_GET'){
      getUninstallReversibility(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_UNINSTALL_REVERSIBILITY_TRANSITION'){
      transitionUninstallReversibilityRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_SECURITY_POSTURE_BUILD'){
      buildWorkforceSecurityPostureRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SECURITY_POSTURE_GET'){
      getWorkforceSecurityPosture(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SECURITY_ENVELOPE_PREPARE'){
      prepareAndClaimWorkforceSecurityEnvelope(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SECURITY_EVIDENCE_CHAIN'){
      buildWorkforceSecurityEvidenceChainRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }

    if(message?.type==='TITAN_WORKFORCE_PRIVACY_EVIDENCE_BUILD'){
      buildWorkforcePrivacyEvidenceControlsRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_PRIVACY_EVIDENCE_GET'){
      getWorkforcePrivacyEvidenceControls(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_PRIVACY_EVIDENCE_ACCESS'){
      evaluateWorkforceEvidenceAccessRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_PRIVACY_EVIDENCE_EXPORT'){
      prepareWorkforceEvidenceExportRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }
    if(message?.type==='TITAN_WORKFORCE_PRIVACY_EVIDENCE_DELETE'){
      prepareWorkforceEvidenceDeletionRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;
    }





async function saveExternalActorBoundary(record){await businessDatabaseReady;await database.putRecord({company_id:record.company_id,actor_id:'titan-zero-workforce-external',operation_id:`external-actor-boundary:${record.company_id}`,idempotency_key:`external-actor-boundary:${record.company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_EXTERNAL_ACTOR_BOUNDARY_COLLECTION,record_id:`external-actor-boundary:${record.company_id}`,data:record,provenance:{source:'titan-workforce-external-actor-boundary',company_id:record.company_id,authority_effect:false}});return record;}
async function buildExternalActorBoundaryRecord(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('external-actor-cross-company-active-context');const record=buildExternalActorBoundary({...raw,company_id});await saveExternalActorBoundary(record);return {record,summary:summarizeExternalActorBoundary(record),authority_granted:false,execution_permitted:false,grants_authority:false};}
async function getExternalActorBoundary(raw={}){const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('external-actor-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-external',operation_id:`external-actor-boundary:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_EXTERNAL_ACTOR_BOUNDARY_COLLECTION,record_id:`external-actor-boundary:${company_id}`},{includeDeleted:true});return {record:row?.data||null,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function evaluateExternalActorParticipationRecord(raw={}){const {record}=await getExternalActorBoundary(raw);if(!record)throw new Error('external-actor-boundary-not-found');const decision=evaluateExternalActorParticipation(record,raw);return {decision,authority_granted:false,execution_permitted:false,grants_authority:false};}
async function recordExternalActorParticipationReceipt(raw={}){const {record}=await getExternalActorBoundary(raw);if(!record)throw new Error('external-actor-boundary-not-found');const decision=evaluateExternalActorParticipation(record,raw);const receipt=buildExternalActorParticipationReceipt(record,decision,raw);await businessDatabaseReady;await database.putRecord({company_id:receipt.company_id,actor_id:'titan-zero-workforce-external',operation_id:`external-actor-receipt:${receipt.receipt_id}`,idempotency_key:receipt.receipt_id},{module_id:'titan.workforce',collection:WORKFORCE_EXTERNAL_ACTOR_RECEIPTS_COLLECTION,record_id:receipt.receipt_id,data:receipt,provenance:{source:'titan-workforce-external-actor-participation',company_id:receipt.company_id,authority_effect:false}});return {decision,receipt,authority_granted:false,execution_permitted:false,grants_authority:false};}
    if(message?.type==='TITAN_WORKFORCE_EXTERNAL_ACTOR_BOUNDARY_BUILD'){buildExternalActorBoundaryRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_EXTERNAL_ACTOR_BOUNDARY_GET'){getExternalActorBoundary(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_EXTERNAL_ACTOR_PARTICIPATION_EVALUATE'){evaluateExternalActorParticipationRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_EXTERNAL_ACTOR_PARTICIPATION_RECEIPT_RECORD'){recordExternalActorParticipationReceipt(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_NOTIFICATION_ESCALATION_BUILD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('notification-cross-company-active-context');const record=buildWorkforceNotificationEscalation({...raw,company_id});await businessDatabaseReady;await database.putRecord({company_id,actor_id:'titan-zero-workforce-notifications',operation_id:`notification-escalation:${company_id}`,idempotency_key:`notification-escalation:${company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_NOTIFICATION_ESCALATION_COLLECTION,record_id:`notification-escalation:${company_id}`,data:record,provenance:{source:'titan-workforce-notification-escalation',company_id,authority_effect:false}});return {record,summary:summarizeWorkforceNotificationEscalation(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_NOTIFICATION_ESCALATION_GET'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('notification-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-notifications',operation_id:`notification-escalation:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_NOTIFICATION_ESCALATION_COLLECTION,record_id:`notification-escalation:${company_id}`},{includeDeleted:true});return {record:row?.data||null};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_NOTIFICATION_TRANSITION'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const ctx={company_id,actor_id:'titan-zero-workforce-notifications',operation_id:`notification-escalation:${company_id}`},key={module_id:'titan.workforce',collection:WORKFORCE_NOTIFICATION_ESCALATION_COLLECTION,record_id:`notification-escalation:${company_id}`};const row=await database.getRecord(ctx,key,{includeDeleted:true});if(!row?.data)throw new Error('notification-escalation-not-found');const record=transitionWorkforceNotification(row.data,{...raw,company_id});await database.putRecord(ctx,key,{module_id:'titan.workforce',collection:WORKFORCE_NOTIFICATION_ESCALATION_COLLECTION,record_id:key.record_id,data:record,provenance:{source:'titan-workforce-notification-transition',company_id,authority_effect:false}});return {record,summary:summarizeWorkforceNotificationEscalation(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_ESCALATION_DUE_EVALUATE'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-notifications',operation_id:`notification-escalation:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_NOTIFICATION_ESCALATION_COLLECTION,record_id:`notification-escalation:${company_id}`},{includeDeleted:true});if(!row?.data)throw new Error('notification-escalation-not-found');return {decision:evaluateWorkforceEscalationDue(row.data,{...raw,company_id})};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_HUMAN_AI_UNIFICATION_BUILD'){buildUnifiedWorkforceRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_HUMAN_AI_UNIFICATION_GET'){getUnifiedWorkforce(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_HUMAN_AI_ASSIGNMENT_EVALUATE'){evaluateUnifiedWorkforceAssignmentRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}

    if(message?.type==='TITAN_WORKFORCE_WORKER_MEMORY_BUILD'){buildWorkforceWorkerMemoryRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_WORKER_MEMORY_GET'){getWorkforceWorkerMemory(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_WORKER_MEMORY_RECALL'){recallWorkforceWorkerMemoryRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_WORKER_MEMORY_RECALL_RECEIPT_RECORD'){recordWorkforceWorkerMemoryRecallReceipt(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}

    if(message?.type==='TITAN_WORKFORCE_KNOWLEDGE_AUTHORITY_BUILD'){buildWorkforceKnowledgeAuthorityRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_KNOWLEDGE_AUTHORITY_GET'){getWorkforceKnowledgeAuthority(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_KNOWLEDGE_USE_EVALUATE'){evaluateWorkforceKnowledgeUseRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_KNOWLEDGE_USE_RECEIPT_RECORD'){recordWorkforceKnowledgeUseReceipt(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}

    if(message?.type==='TITAN_WORKFORCE_INTELLIGENCE_ROUTING_BUILD'){buildWorkforceIntelligenceRoutingRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_INTELLIGENCE_ROUTING_GET'){getWorkforceIntelligenceRouting(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_INTELLIGENCE_ROUTE_SELECT'){selectWorkforceIntelligenceRouteRecord(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_PROVIDER_RECEIPT_RECORD'){recordWorkforceProviderReceipt(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}

    if(message?.type==='TITAN_WORKFORCE_GRAPH_BUILD'){
      buildWorkforceGraph(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }

    if(message?.type==='TITAN_WORKFORCE_RETRY_EVALUATE'){
      evaluateWorkforceRetry(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }

    if(message?.type==='TITAN_WORKFORCE_OPERATION_CLAIM'){
      claimWorkforceOperation(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_OPERATION_COMPLETE'){
      completeWorkforceOperation(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_OPERATION_GET'){
      getWorkforceOperation(message.payload||message.detail||{})
        .then(result=>sendResponse({ok:true,...result,authority_effect:false}))
        .catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_AUTHORITY_EVALUATE'){
      try{
        const authorityDecision=evaluateWorkerAuthorityDecision(message.payload||message.context||message.detail);
        sendResponse({ok:true,authorityDecision,authority_effect:false});
      }catch(error){sendResponse({ok:false,error:error.message,authority_effect:false});}
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_E2E_CERTIFICATION_BUILD'){buildAndSaveWorkforceEndToEndCertification(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_E2E_CERTIFICATION_GET'){getWorkforceEndToEndCertification(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false})); return true;}
    if(message?.type==='TITAN_WORKFORCE_COMMAND_PREPARE'){
      try{
        const command=prepareGovernedCommandEnvelope(message.payload||message.command||message.detail);
        sendResponse({ok:true,state:'prepared',command,authority_effect:false});
      }catch(error){sendResponse({ok:false,error:error.message,authority_effect:false});}
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_RECEIPT_VERIFY'){
      try{
        const payload=message.payload||message.detail||{};
        const expected=payload.expected||{};
        assertAuthoritativeExecutionReceipt(payload.receipt,expected);
        assertPostActionVerification(payload.verification,{...expected,required:Boolean(payload.verification_required??expected.verification_required)});
        sendResponse({ok:true,verified:true,authority_effect:false});
      }catch(error){sendResponse({ok:false,error:error.message,authority_effect:false});}
      return true;
    }
    if(message?.type==='TITAN_WORKFORCE_SCHEDULE_RECURRENCE_BUILD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('schedule-cross-company-active-context');const record=buildWorkforceScheduleRecurrence({...raw,company_id});await businessDatabaseReady;await database.putRecord({company_id,actor_id:'titan-zero-workforce-scheduling',operation_id:`schedule-recurrence:${company_id}`,idempotency_key:`schedule-recurrence:${company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_SCHEDULE_RECURRENCE_COLLECTION,record_id:`schedule-recurrence:${company_id}`,data:record,provenance:{source:'titan-workforce-schedule-recurrence',company_id,authority_effect:false}});return {record,summary:summarizeWorkforceScheduleRecurrence(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_SCHEDULE_RECURRENCE_GET'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('schedule-cross-company-active-context');await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-scheduling',operation_id:`schedule-recurrence:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_SCHEDULE_RECURRENCE_COLLECTION,record_id:`schedule-recurrence:${company_id}`},{includeDeleted:true});return {record:row?.data||null};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_SCHEDULE_DUE_EVALUATE'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-scheduling',operation_id:`schedule-recurrence:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_SCHEDULE_RECURRENCE_COLLECTION,record_id:`schedule-recurrence:${company_id}`},{includeDeleted:true});if(!row?.data)throw new Error('schedule-recurrence-not-found');return {decision:evaluateWorkforceScheduleDue(row.data,{...raw,company_id})};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_FINANCIAL_GUARDRAILS_BUILD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('guardrail-cross-company-active-context');const record=buildWorkforceFinancialResourceGuardrails({...raw,company_id});await businessDatabaseReady;await database.putRecord({company_id,actor_id:'titan-zero-workforce-guardrails',operation_id:`financial-resource-guardrails:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_FINANCIAL_RESOURCE_GUARDRAILS_COLLECTION,record_id:`financial-resource-guardrails:${company_id}`,data:record,provenance:{source:'titan-workforce-financial-resource-guardrails',company_id,authority_effect:false}});return {record,summary:summarizeWorkforceFinancialResourceGuardrails(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_FINANCIAL_GUARDRAILS_GET'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-guardrails',operation_id:`financial-resource-guardrails:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_FINANCIAL_RESOURCE_GUARDRAILS_COLLECTION,record_id:`financial-resource-guardrails:${company_id}`},{includeDeleted:true});return {record:row?.data||null};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_RESOURCE_REQUEST_EVALUATE'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const ctx={company_id,actor_id:'titan-zero-workforce-guardrails',operation_id:`financial-resource-guardrails:${company_id}`},key={module_id:'titan.workforce',collection:WORKFORCE_FINANCIAL_RESOURCE_GUARDRAILS_COLLECTION,record_id:`financial-resource-guardrails:${company_id}`};const row=await database.getRecord(ctx,key,{includeDeleted:true});if(!row?.data)throw new Error('financial-resource-guardrails-not-found');return {decision:evaluateWorkforceResourceRequest(row.data,{...raw,company_id})};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_RESOURCE_RESERVATION_RECORD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const ctx={company_id,actor_id:'titan-zero-workforce-guardrails',operation_id:`financial-resource-guardrails:${company_id}`},key={module_id:'titan.workforce',collection:WORKFORCE_FINANCIAL_RESOURCE_GUARDRAILS_COLLECTION,record_id:`financial-resource-guardrails:${company_id}`};const row=await database.getRecord(ctx,key,{includeDeleted:true});if(!row?.data)throw new Error('financial-resource-guardrails-not-found');const record=recordWorkforceResourceReservation(row.data,{...raw,company_id});await database.putRecord(ctx,key,{...key,data:record,provenance:{source:'titan-workforce-resource-reservation',company_id,authority_effect:false}});return {record,summary:summarizeWorkforceFinancialResourceGuardrails(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_RESOURCE_CONSUMPTION_RECORD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const ctx={company_id,actor_id:'titan-zero-workforce-guardrails',operation_id:`financial-resource-guardrails:${company_id}`},key={module_id:'titan.workforce',collection:WORKFORCE_FINANCIAL_RESOURCE_GUARDRAILS_COLLECTION,record_id:`financial-resource-guardrails:${company_id}`};const row=await database.getRecord(ctx,key,{includeDeleted:true});if(!row?.data)throw new Error('financial-resource-guardrails-not-found');const record=recordWorkforceResourceConsumption(row.data,{...raw,company_id});await database.putRecord(ctx,key,{...key,data:record,provenance:{source:'titan-workforce-resource-consumption',company_id,authority_effect:false}});return {record,summary:summarizeWorkforceFinancialResourceGuardrails(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_BUILD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);if(current&&company_id!==current)throw new Error('risk-cross-company-active-context');const record=buildWorkforcePhysicalEnvironmentalRiskHooks({...raw,company_id});await businessDatabaseReady;await database.putRecord({company_id,actor_id:'titan-zero-workforce-risk',operation_id:`physical-environmental-risk:${company_id}`,idempotency_key:`physical-environmental-risk:${company_id}:${record.updated_at}`},{module_id:'titan.workforce',collection:WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_COLLECTION,record_id:`physical-environmental-risk:${company_id}`,data:record,provenance:{source:'titan-workforce-physical-environmental-risk',company_id,authority_effect:false}});return {record,summary:summarizeWorkforcePhysicalEnvironmentalRisk(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_GET'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const row=await database.getRecord({company_id,actor_id:'titan-zero-workforce-risk',operation_id:`physical-environmental-risk:${company_id}`},{module_id:'titan.workforce',collection:WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_COLLECTION,record_id:`physical-environmental-risk:${company_id}`},{includeDeleted:true});return {record:row?.data||null};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_EVALUATE'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const ctx={company_id,actor_id:'titan-zero-workforce-risk',operation_id:`physical-environmental-risk:${company_id}`},key={module_id:'titan.workforce',collection:WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_COLLECTION,record_id:`physical-environmental-risk:${company_id}`};const row=await database.getRecord(ctx,key,{includeDeleted:true});if(!row?.data)throw new Error('physical-environmental-risk-not-found');return {decision:evaluateWorkforcePhysicalEnvironmentalRisk(row.data,{...raw,company_id})};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_RISK_MITIGATION_RECORD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const ctx={company_id,actor_id:'titan-zero-workforce-risk',operation_id:`physical-environmental-risk:${company_id}`},key={module_id:'titan.workforce',collection:WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_COLLECTION,record_id:`physical-environmental-risk:${company_id}`};const row=await database.getRecord(ctx,key,{includeDeleted:true});if(!row?.data)throw new Error('physical-environmental-risk-not-found');const record=recordWorkforceRiskMitigation(row.data,{...raw,company_id});await database.putRecord(ctx,key,{...key,data:record,provenance:{source:'titan-workforce-risk-mitigation',company_id,authority_effect:false}});return {record,summary:summarizeWorkforcePhysicalEnvironmentalRisk(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_SCHEDULE_INSTANCE_RECORD'){(async()=>{const raw=message.payload||message.detail||{};const current=await activeCompanyId();const company_id=cleanText(raw.company_id||current,'company_id',128);await businessDatabaseReady;const ctx={company_id,actor_id:'titan-zero-workforce-scheduling',operation_id:`schedule-recurrence:${company_id}`},key={module_id:'titan.workforce',collection:WORKFORCE_SCHEDULE_RECURRENCE_COLLECTION,record_id:`schedule-recurrence:${company_id}`};const row=await database.getRecord(ctx,key,{includeDeleted:true});if(!row?.data)throw new Error('schedule-recurrence-not-found');const record=recordWorkforceScheduleInstance(row.data,{...raw,company_id});await database.putRecord(ctx,key,{module_id:'titan.workforce',collection:WORKFORCE_SCHEDULE_RECURRENCE_COLLECTION,record_id:key.record_id,data:record,provenance:{source:'titan-workforce-schedule-instance-record',company_id,authority_effect:false}});return {record,summary:summarizeWorkforceScheduleRecurrence(record)};})().then(result=>sendResponse({ok:true,...result,authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_BROWSER_LIVE_SMOKE_BUILD'){buildAndSaveWorkforceBrowserLiveSmokeCertification(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_BROWSER_LIVE_SMOKE_GET'){getWorkforceBrowserLiveSmokeCertification(message.payload||message.detail||{}).then(result=>sendResponse({ok:true,...result,authority_effect:false})).catch(error=>sendResponse({ok:false,error:error.message,authority_effect:false}));return true;}
    if(message?.type==='TITAN_WORKFORCE_RUNTIME'&&message?.action==='snapshot'){
      sendResponse({ok:true,workforceRuntime:snapshot()}); return true;
    }
  });
}catch(_){}
