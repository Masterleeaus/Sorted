const LEGACY_COMPANY_KEYS=Object.freeze(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const text=v=>String(v??'').trim();
const array=v=>Array.isArray(v)?v:[];
const clone=v=>v==null?v:globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));

function assertNoLegacy(value,path='packet'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((child,i)=>assertNoLegacy(child,`${path}[${i}]`));return;}
  for(const [key,child] of Object.entries(value)){
    if(LEGACY_COMPANY_KEYS.includes(key))throw new Error(`legacy-company-boundary:${path}.${key}`);
    assertNoLegacy(child,`${path}.${key}`);
  }
}

export function normalizeInvestigationParticipationPacket(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new TypeError('investigation-packet-required');
  assertNoLegacy(input);
  if(input.schema!=='titan.deployment.investigation-participation-manager.v1') throw new Error('investigation-packet-schema-invalid');
  if(!text(input.company_id)) throw new Error('company_id-required');
  if(!text(input.deployment_mission_id)) throw new Error('deployment_mission_id-required');
  if(!text(input.participation_plan_id)) throw new Error('participation_plan_id-required');
  if(input.source_of_truth!=='deployment_workforce') throw new Error('source-of-truth-must-be-deployment-workforce');
  if(input.manager_surface!=='titan_zero_chrome') throw new Error('manager-surface-invalid');
  if(input.direct_mutation!==false||input.grants_authority!==false) throw new Error('investigation-packet-authority-invalid');
  const participants=array(input.participants).map(p=>normalizeParticipant(p,input.company_id));
  const ids=new Set();
  for(const participant of participants){
    if(ids.has(participant.participant_actor_id)) throw new Error('investigation-participant-duplicate');
    ids.add(participant.participant_actor_id);
  }
  const leads=participants.filter(p=>p.participation_role==='investigation_lead');
  if(leads.length!==1) throw new Error('investigation-lead-exactly-one-required');
  const participantById=new Map(participants.map(p=>[p.participant_actor_id,p]));
  const assignments=array(input.assignments).map(a=>normalizeAssignment(a,input,participantById));
  return Object.freeze({
    ...clone(input),
    participants:Object.freeze(participants),
    assignments:Object.freeze(assignments),
    direct_mutation:false,
    grants_authority:false,
    authority_effect:false,
  });
}

function normalizeParticipant(p,companyId){
  if(!p||typeof p!=='object'||Array.isArray(p)) throw new Error('investigation-participant-invalid');
  assertNoLegacy(p,'participant');
  const id=text(p.participant_actor_id); if(!id) throw new Error('investigation-participant-actor-required');
  if(p.identity_ref?.company_id&&text(p.identity_ref.company_id)!==companyId) throw new Error('investigation-participant-cross-company');
  if(p.company_id&&text(p.company_id)!==companyId) throw new Error('investigation-participant-cross-company');
  if(p.grants_authority!==false||p.direct_mutation!==false) throw new Error('investigation-participant-authority-invalid');
  return Object.freeze({
    participant_actor_id:id,
    actor_type:text(p.actor_type),
    participation_role:text(p.participation_role),
    display_name:text(p.display_name)||id,
    competencies:Object.freeze(array(p.competencies).map(text).filter(Boolean)),
    allowed_question_ids:Object.freeze(array(p.allowed_question_ids).map(text).filter(Boolean)),
    allowed_topics:Object.freeze(array(p.allowed_topics).map(text).filter(Boolean)),
    status:text(p.status)||'active',
    grants_authority:false,
    direct_mutation:false,
    authority_effect:false,
  });
}

function normalizeAssignment(a,packet,participantById){
  if(!a||typeof a!=='object'||Array.isArray(a)) throw new Error('investigation-assignment-invalid');
  assertNoLegacy(a,'assignment');
  if(a.company_id&&text(a.company_id)!==packet.company_id) throw new Error('investigation-assignment-cross-company');
  if(a.deployment_mission_id&&text(a.deployment_mission_id)!==packet.deployment_mission_id) throw new Error('investigation-assignment-mission-mismatch');
  if(a.participation_plan_id&&text(a.participation_plan_id)!==packet.participation_plan_id) throw new Error('investigation-assignment-plan-mismatch');
  const actor=text(a.participant_actor_id);
  const participant=participantById.get(actor);
  if(!participant) throw new Error('investigation-assignment-participant-unknown');
  if(a.grants_authority!==false||a.direct_mutation!==false) throw new Error('investigation-assignment-authority-invalid');
  const question_id=text(a.question_id);
  const topic=text(a.topic);
  if(participant.participation_role==='deployment_external_contributor'){
    const questions=participant.allowed_question_ids;
    const topics=participant.allowed_topics;
    if((questions.length&&!questions.includes(question_id))||(topics.length&&!topics.includes(topic))) throw new Error('external-contributor-scope-invalid');
  }
  return Object.freeze({
    assignment_id:text(a.assignment_id),
    question_id,
    participant_actor_id:actor,
    topic,
    state:text(a.state)||'assigned',
    required_evidence:Object.freeze(array(a.required_evidence).map(text).filter(Boolean)),
    grants_authority:false,
    direct_mutation:false,
    authority_effect:false,
  });
}

export function investigationParticipationSummary(packet){
  const p=normalizeInvestigationParticipationPacket(packet);
  const assigned=p.assignments.filter(a=>a.state==='assigned').length;
  const external=p.participants.filter(x=>x.participation_role==='deployment_external_contributor').length;
  const lead=p.participants.find(x=>x.participation_role==='investigation_lead');
  return Object.freeze({
    company_id:p.company_id,
    deployment_mission_id:p.deployment_mission_id,
    participation_plan_id:p.participation_plan_id,
    investigation_lead_actor_id:lead?.participant_actor_id||null,
    participants:p.participants.length,
    assignments:assigned,
    external_contributors:external,
    source_of_truth:p.source_of_truth,
    authority_effect:false,
  });
}
