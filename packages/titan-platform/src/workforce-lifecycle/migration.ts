import { assertTitanWorkforceLifecycleCompany, type TitanWorkforceLifecycleState } from './contracts.js';

export const TITAN_WORKFORCE_MIGRATION_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle-migration.contract.v1',
  companyBoundary: 'company_id' as const,
  platformManagerAuthorityRequired: true as const,
  agentMaySelfUpgrade: false as const,
  registeredMigrationsOnly: true as const,
  backupRequired: true as const,
  rollbackCheckpointRequired: true as const,
  dataPreservationRequired: true as const,
  authorityNeutralRequired: true as const,
  automaticEffectReplay: false as const,
  automaticAuthorityChange: false as const,
  migrationGrantsAuthority: false as const,
});

export type TitanWorkforceMigrationPhase = 'PREPARED'|'APPLYING'|'VERIFYING'|'RECOVERY_REQUIRED'|'ROLLBACK_REQUIRED'|'COMPLETED'|'ROLLED_BACK'|'BLOCKED';
export type TitanWorkforceMigrationEvent = 'START'|'APPLIED'|'VERIFIED'|'INTERRUPT'|'FAIL'|'ROLLBACK_REQUIRED'|'ROLLED_BACK'|'BLOCK';

export type TitanWorkforceMigrationStep = Readonly<{
  migration_id: string;
  registered: boolean;
  data_preserving: boolean;
  authority_neutral: boolean;
  reversible: boolean;
  rollback_ref: string | null;
}>;

export type TitanWorkforceMigrationPlan = Readonly<{
  schema: 'titan.workforce.lifecycle-migration.v1';
  company_id: string;
  agent_key: string;
  migration_run_id: string;
  source_version: string;
  target_version: string;
  source_configuration_revision: number;
  target_configuration_revision: number;
  lifecycle_state_at_plan: TitanWorkforceLifecycleState;
  active_work_count_at_plan: number;
  backup_ref: string | null;
  rollback_ref: string | null;
  migrations: readonly TitanWorkforceMigrationStep[];
  phase: TitanWorkforceMigrationPhase;
  blockers: readonly string[];
  interrupted_upgrade_detected: boolean;
  requires_manual_review: boolean;
  effect_state: 'NONE'|'UNKNOWN'|'VERIFIED'|'ROLLED_BACK';
  checkpoint_id: string | null;
  execution_permitted: false;
  migration_grants_authority: false;
  automatic_effect_replay: false;
  automatic_authority_change: false;
}>;

const SEMVER_RE=/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const LEGACY_KEYS=new Set(['tenant_id','tenant_company_id','tenant','tenantCompanyId','organisation_id','organization_id']);
function clean(v:unknown,n=240){return String(v??'').trim().slice(0,n);}
function id(v:unknown,field:string){const x=clean(v,180).toLowerCase();if(!/^[a-z0-9][a-z0-9._:-]{0,179}$/.test(x))throw new Error(`${field}-invalid`);return x;}
function version(v:unknown,field:string){const x=clean(v,80);if(!SEMVER_RE.test(x))throw new Error(`${field}-semver-required`);return x;}
function parts(v:string){return v.split(/[+-]/,1)[0].split('.').map(Number);}
function cmp(a:string,b:string){const A=parts(a),B=parts(b);for(let i=0;i<3;i++){if(A[i]!==B[i])return A[i]-B[i];}return 0;}
function count(v:unknown){const n=Number(v??0);if(!Number.isInteger(n)||n<0)throw new Error('active_work_count-invalid');return n;}
function revision(v:unknown,field:string){const n=Number(v);if(!Number.isInteger(n)||n<0)throw new Error(`${field}-invalid`);return n;}
function rejectLegacy(v:unknown,path='migration'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const [k,x] of Object.entries(v as Record<string,unknown>)){if(LEGACY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function normalizeStep(raw:Record<string,unknown>,index:number):TitanWorkforceMigrationStep{
 const migration_id=id(raw.migration_id??raw.id??`migration-${index+1}`,'migration_id');
 return Object.freeze({migration_id,registered:raw.registered===true,data_preserving:raw.data_preserving!==false,authority_neutral:raw.authority_neutral!==false,reversible:raw.reversible===true,rollback_ref:clean(raw.rollback_ref,400)||null});
}

export function buildTitanWorkforceMigrationPlan(input:{
  company_id:string; agent_key:string; source_version:string; target_version:string;
  source_configuration_revision:number; target_configuration_revision:number;
  lifecycle_state:TitanWorkforceLifecycleState; active_work_count?:number;
  backup_ref?:string|null; rollback_ref?:string|null; rollback_mode?:boolean;
  irreversible_change_approved?:boolean; migrations?:readonly Record<string,unknown>[];
  previous_checkpoint?:Partial<TitanWorkforceMigrationPlan>|null;
}):TitanWorkforceMigrationPlan{
 rejectLegacy(input);
 const company_id=assertTitanWorkforceLifecycleCompany(input.company_id); const agent_key=id(input.agent_key,'agent_key');
 const source_version=version(input.source_version,'source_version'), target_version=version(input.target_version,'target_version');
 const source_configuration_revision=revision(input.source_configuration_revision,'source_configuration_revision');
 const target_configuration_revision=revision(input.target_configuration_revision,'target_configuration_revision');
 const active=count(input.active_work_count); const backup_ref=clean(input.backup_ref,400)||null; const rollback_ref=clean(input.rollback_ref,400)||null;
 const migrations=Object.freeze((input.migrations??[]).map((m,i)=>normalizeStep(m,i))); const blockers:string[]=[];
 if(cmp(source_version,target_version)>0 && input.rollback_mode!==true)blockers.push('target-version-older-than-source');
 if(target_configuration_revision<source_configuration_revision && input.rollback_mode!==true)blockers.push('target-configuration-revision-older-than-source');
 if(!backup_ref)blockers.push('pre-upgrade-backup-required');
 if(!rollback_ref)blockers.push('rollback-checkpoint-required');
 if(migrations.some(m=>!m.registered))blockers.push('unregistered-migration-requested');
 if(migrations.some(m=>!m.data_preserving))blockers.push('migration-must-preserve-data');
 if(migrations.some(m=>!m.authority_neutral))blockers.push('migration-cannot-change-authority');
 if(migrations.some(m=>!m.reversible&&!m.rollback_ref)&&input.irreversible_change_approved!==true)blockers.push('irreversible-migration-not-approved');
 if(active>0)blockers.push('active-work-must-drain-before-upgrade');
 if(!['REGISTERED','PAUSED','DISABLED'].includes(input.lifecycle_state))blockers.push(`lifecycle-state-not-upgrade-safe:${input.lifecycle_state}`);
 const previous=input.previous_checkpoint??null;
 if(previous?.company_id&&previous.company_id!==company_id)throw new Error('cross-company-migration-checkpoint');
 if(previous?.agent_key&&previous.agent_key!==agent_key)throw new Error('migration-checkpoint-agent-mismatch');
 const previousPhase=String(previous?.phase??'');
 const interrupted=Boolean(previous&&['APPLYING','VERIFYING','RECOVERY_REQUIRED'].includes(previousPhase));
 const rollbackPending=Boolean(previous&&previousPhase==='ROLLBACK_REQUIRED');
 const requires_manual_review=(interrupted||rollbackPending)&&previous?.effect_state==='UNKNOWN';
 const phase:TitanWorkforceMigrationPhase=blockers.length?'BLOCKED':rollbackPending?'ROLLBACK_REQUIRED':interrupted?'RECOVERY_REQUIRED':'PREPARED';
 const restoredEffect=(interrupted||rollbackPending)?(previous?.effect_state??'UNKNOWN'):'NONE';
 return Object.freeze({schema:'titan.workforce.lifecycle-migration.v1',company_id,agent_key,migration_run_id:`${agent_key}:${source_version}->${target_version}:r${source_configuration_revision}->${target_configuration_revision}`,source_version,target_version,source_configuration_revision,target_configuration_revision,lifecycle_state_at_plan:input.lifecycle_state,active_work_count_at_plan:active,backup_ref,rollback_ref,migrations,phase,blockers:Object.freeze([...new Set(blockers)].sort()),interrupted_upgrade_detected:interrupted,requires_manual_review,effect_state:restoredEffect as TitanWorkforceMigrationPlan['effect_state'],checkpoint_id:previous?.checkpoint_id??null,execution_permitted:false,migration_grants_authority:false,automatic_effect_replay:false,automatic_authority_change:false});
}

export function transitionTitanWorkforceMigration(plan:TitanWorkforceMigrationPlan,event:{company_id:string;type:TitanWorkforceMigrationEvent;checkpoint_id?:string;effect_state?:'NONE'|'UNKNOWN'|'VERIFIED'|'ROLLED_BACK'}):TitanWorkforceMigrationPlan{
 const company_id=assertTitanWorkforceLifecycleCompany(event.company_id); if(company_id!==plan.company_id)throw new Error('cross-company-migration-transition');
 const allowed:Record<TitanWorkforceMigrationPhase,readonly TitanWorkforceMigrationEvent[]>={PREPARED:['START','BLOCK'],APPLYING:['APPLIED','INTERRUPT','FAIL'],VERIFYING:['VERIFIED','INTERRUPT','FAIL'],RECOVERY_REQUIRED:['START','ROLLBACK_REQUIRED','BLOCK'],ROLLBACK_REQUIRED:['ROLLED_BACK','BLOCK'],COMPLETED:[],ROLLED_BACK:[],BLOCKED:[]};
 if(!allowed[plan.phase].includes(event.type))throw new Error(`migration-invalid-transition:${plan.phase}:${event.type}`);
 let phase:TitanWorkforceMigrationPhase=plan.phase,effect=plan.effect_state;
 if(event.type==='START')phase='APPLYING'; else if(event.type==='APPLIED')phase='VERIFYING'; else if(event.type==='VERIFIED'){phase='COMPLETED';effect='VERIFIED';} else if(event.type==='INTERRUPT'){phase='RECOVERY_REQUIRED';effect=event.effect_state??'UNKNOWN';} else if(event.type==='FAIL'||event.type==='ROLLBACK_REQUIRED'){phase='ROLLBACK_REQUIRED';effect=event.effect_state??'UNKNOWN';} else if(event.type==='ROLLED_BACK'){phase='ROLLED_BACK';effect='ROLLED_BACK';} else if(event.type==='BLOCK')phase='BLOCKED';
 return Object.freeze({...plan,phase,effect_state:effect,checkpoint_id:clean(event.checkpoint_id,240)||`${plan.migration_run_id}:${phase.toLowerCase()}`,interrupted_upgrade_detected:phase==='RECOVERY_REQUIRED',requires_manual_review:phase==='RECOVERY_REQUIRED'&&effect==='UNKNOWN',execution_permitted:false,migration_grants_authority:false,automatic_effect_replay:false,automatic_authority_change:false});
}
