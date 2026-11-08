import { runDispatchGoldenEvaluation } from './dispatch-golden-evaluation-runtime.mjs';

const text=v=>String(v??'').trim();
const LEGACY=new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId','organisation_id','organization_id']);
function rejectLegacy(v,path='$'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=text(v);if(!/^[A-Za-z0-9._:-]{2,128}$/.test(id))throw new Error('dispatch-release-company_id-required');return id;}
function check(name,status,evidence={}){return Object.freeze({name,status,evidence:Object.freeze(evidence)});}
function normalizeStatus(v){const s=text(v).toUpperCase();return s||'UNKNOWN';}
function resultStatus(checks){if(checks.some(x=>x.status==='BLOCKED'))return 'BLOCKED';if(checks.some(x=>x.status==='REVIEW'))return 'REVIEW_REQUIRED';return 'CERTIFIED';}

export function certifyDispatchRelease(input={}){
  rejectLegacy(input);
  const company_id=company(input.company_id);
  const checks=[];

  const manager=input.manager_baseline||{};
  const managerCompanyNeutral = !manager.company_id || text(manager.company_id)===company_id;
  if(!managerCompanyNeutral) throw new Error('dispatch-release-cross-company-manager-evidence');
  checks.push(check('manager-baseline-observed',text(manager.artifact)&&text(manager.sha256)&&Number(manager.merge)>=1?'PASS':'REVIEW',{merge:manager.merge??null,artifact:text(manager.artifact)||null}));

  const golden=runDispatchGoldenEvaluation({...input.golden_input,company_id});
  checks.push(check('dispatch-golden-evaluation',golden.status==='PASS'?'PASS':golden.status==='BLOCKED'?'BLOCKED':'REVIEW',{status:golden.status}));
  checks.push(check('dispatch-authority-boundary',golden.direct_mutation===false&&golden.execution_permitted===false&&golden.grants_authority===false&&golden.automatic_assignment===false&&golden.automatic_reassignment===false?'PASS':'BLOCKED'));

  const jobs=input.jobs_handoff||{};
  if(jobs.company_id&&text(jobs.company_id)!==company_id)throw new Error('dispatch-release-cross-company-jobs-handoff');
  const jobsOwner = jobs.canonical_owner==='Titan Field' || jobs.canonical_jobs_owned_elsewhere===true || /JOBS/i.test(text(jobs.owner||jobs.worker||jobs.source));
  const jobsNeutral = jobs.execution_permitted!==true && jobs.authority_granted!==true && jobs.grants_authority!==true;
  checks.push(check('jobs-handoff-boundary',jobsOwner&&jobsNeutral?'PASS':'REVIEW',{owner:jobs.canonical_owner||jobs.owner||jobs.worker||null,status:normalizeStatus(jobs.status||jobs.pass_status)}));

  const scheduling=input.scheduling_handoff||{};
  if(scheduling.company_id&&text(scheduling.company_id)!==company_id)throw new Error('dispatch-release-cross-company-scheduling-handoff');
  const schedulingExternal = scheduling.canonical_scheduling_owned_elsewhere===true || /SCHEDUL/i.test(text(scheduling.owner||scheduling.worker||scheduling.source));
  const schedulingNeutral = scheduling.execution_permitted!==true && scheduling.authority_granted!==true && scheduling.grants_authority!==true;
  const schedulingReplaySafe = scheduling.duplicate_replay_suppression!=='FAIL' && scheduling.company_isolation!=='FAIL';
  checks.push(check('scheduling-handoff-boundary',schedulingExternal&&schedulingNeutral&&schedulingReplaySafe?'PASS':'REVIEW',{owner:scheduling.owner||scheduling.worker||null,status:normalizeStatus(scheduling.status||scheduling.pass_status)}));

  const reconstruction=input.reconstruction||{};
  if(reconstruction.company_id&&text(reconstruction.company_id)!==company_id)throw new Error('dispatch-release-cross-company-reconstruction');
  const exact = reconstruction.exact===true || reconstruction.exact_reconstruction===true || reconstruction.status==='PASS';
  checks.push(check('exact-reconstruction',exact?'PASS':'BLOCKED',{base_files:reconstruction.base_files??null,target_files:reconstruction.target_files??null}));

  const collision=input.collision||{};
  const protectedTouched=Array.isArray(collision.protected_hotspots_touched)?collision.protected_hotspots_touched:[];
  const unresolved=Array.isArray(collision.unresolved)?collision.unresolved:[];
  checks.push(check('collision-and-hotspot-release',protectedTouched.length===0&&unresolved.length===0?'PASS':'BLOCKED',{protected_hotspots_touched:protectedTouched.length,unresolved:unresolved.length}));

  const donor=input.donor||{};
  const directTransplant=donor.direct_source_transplant===true||donor.direct_transplant_this_pass===true;
  const licenseStatus=String(donor.license_status||'').trim().toUpperCase();
  const licensed=['VERIFIED','VERIFIED_FOR_DIRECT_COMMERCIAL_REUSE','LICENSE_VERIFIED'].includes(licenseStatus);
  checks.push(check('donor-license-boundary',!directTransplant||licensed?'PASS':'BLOCKED',{direct_transplant:directTransplant,license_status:donor.license_status||'UNRESOLVED'}));

  const status=resultStatus(checks);
  return Object.freeze({
    schema:'titan.workforce.dispatch.release-certification.v1',company_id,status,checks:Object.freeze(checks),golden,
    ready_for_manager_merge:status==='CERTIFIED',recommended_convergence_class:status==='CERTIFIED'?'CLEAN_ADDITIVE_FORWARD_PORT':'REVIEW_REQUIRED',
    canonical_jobs_owned_elsewhere:true,canonical_scheduling_owned_elsewhere:true,communications_owned_elsewhere:true,persistence_owned_elsewhere:true,
    automatic_assignment:false,automatic_reassignment:false,automatic_customer_contact:false,auto_replay:false,direct_mutation:false,execution_permitted:false,identity_confers_authority:false,grants_authority:false
  });
}

export function summarizeDispatchReleaseCertification(v={}){
  return Object.freeze({company_id:v.company_id||null,status:v.status||null,ready_for_manager_merge:v.ready_for_manager_merge===true,recommended_convergence_class:v.recommended_convergence_class||null,checks:Array.isArray(v.checks)?v.checks.map(x=>({name:x.name,status:x.status})):[],execution_permitted:false,grants_authority:false});
}
