// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-plumbing-workforce.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero Plumbing Vertical Workforce v1.0
 * Module-owned plumbing specialists layered over internal shared Workforce agents.
 * Role identity does not confer authority. Licensed/regulatory work remains gated.
 */
(() => {
  const mk=(id,name,department,purpose,capabilities,opts={})=>({
    id,roleDefinitionId:id,role_definition_id:id,name,displayName:`Plumbing · ${name}`,icon:'🔧',department,
    division_key:department,purpose,description:purpose,capabilities,operational_domains:capabilities,
    autonomy:'governed',riskCeiling:opts.riskCeiling||'LOW',risk_ceiling:opts.riskCeiling||'LOW',
    min_business_tier:'SOLO',vertical:'plumbing',verticals:['plumbing'],companyBoundary:'company_id',company_boundary:'company_id',
    activationConfersAuthority:false,activation_confers_authority:false,source:'Titan Workforce Verticals · Plumbing v1',
    evidenceRequired:opts.evidenceRequired||[],approvalRequiredFor:opts.approvalRequiredFor||[],licensedWork:opts.licensedWork!==false
  });

  const SPECIALISTS=[
    mk('titan.plumbing.scope_assessor','Plumbing Scope Assessor','sales','Define plumbing scope from customer symptoms, photos, site details, access constraints and known exclusions.',['plumbing_scope','photo_scope','site_details','access_constraints','quote_inputs'],{evidenceRequired:['customer_scope','site_or_photo_evidence'],licensedWork:false}),
    mk('titan.plumbing.quote_specialist','Plumbing Quote Specialist','sales','Prepare transparent plumbing quote inputs, options, assumptions, exclusions and provisional allowances from an approved scope.',['plumbing_quote','labour_estimate','parts_allowance','scope_assumptions','quote_options'],{approvalRequiredFor:['price_override','discount_outside_policy'],licensedWork:false}),
    mk('titan.plumbing.diagnostic_triage','Plumbing Diagnostic Triage Specialist','technical','Triage plumbing symptoms, urgency, evidence and likely job category without presenting remote diagnosis as licensed field confirmation.',['plumbing_diagnostic','symptom_triage','urgency','evidence_request','job_classification'],{riskCeiling:'MEDIUM',licensedWork:false}),
    mk('titan.plumbing.leak_water','Leak & Water Issue Coordinator','work','Coordinate leak, burst, water-loss and water-damage observations, urgent attendance and safe isolation boundaries.',['leak_triage','burst_pipe','water_loss','water_damage_observation','urgent_dispatch'],{riskCeiling:'HIGH',evidenceRequired:['site_observation']}),
    mk('titan.plumbing.drainage','Drainage & Blockage Coordinator','work','Scope blocked drains, recurring drainage symptoms, affected fixtures, access points and diagnostic evidence.',['blocked_drain','drainage_scope','affected_fixtures','access_points','diagnostic_evidence'],{evidenceRequired:['symptom_record']}),
    mk('titan.plumbing.hot_water','Hot Water Service Coordinator','work','Coordinate hot-water faults, unit identity, age, symptoms, service history and repair/replacement assessment inputs.',['hot_water','unit_identity','fault_symptoms','service_history','repair_replace_inputs'],{riskCeiling:'MEDIUM',evidenceRequired:['unit_identity','symptom_record']}),
    mk('titan.plumbing.fixture_sanitary','Fixture & Sanitary Coordinator','work','Coordinate taps, toilets, cisterns, sinks, showers and sanitary fixture repair/replacement scope and parts requirements.',['fixture_repair','tap_repair','toilet_repair','cistern','sanitary_fixture','parts_requirements'],{evidenceRequired:['fixture_identity_or_photo']}),
    mk('titan.plumbing.emergency','Emergency Plumbing Coordinator','operations','Triage urgent flooding, burst, uncontrolled leak, sewage overflow and loss-of-service events and coordinate priority dispatch.',['emergency_plumbing','flooding','burst_pipe','sewage_overflow','priority_dispatch','risk_isolation'],{riskCeiling:'HIGH',evidenceRequired:['emergency_observation']}),
    mk('titan.plumbing.quality_inspector','Plumbing Quality Inspector','quality','Review promised scope, field test results, photos, defects, leaks, cleanup and completion evidence before closure.',['plumbing_qc','test_result_review','photo_qa','defect_review','completion_gate'],{riskCeiling:'MEDIUM',evidenceRequired:['completion_photos','field_test_result']}),
    mk('titan.plumbing.parts_materials','Plumbing Materials & Parts Coordinator','assets','Plan and track plumbing pipe, fittings, valves, fixtures, seals, consumables and replacement parts against the approved job scope.',['plumbing_parts','materials_plan','fittings','valves','fixture_parts','stock_check'],{licensedWork:false}),
    mk('titan.plumbing.preventive_maintenance','Preventive Maintenance Coordinator','work','Plan recurring plumbing inspections and preventive maintenance from asset condition, service history and customer requirements.',['preventive_plumbing','maintenance_schedule','inspection_plan','service_history','recurring_service'],{licensedWork:false}),
    mk('titan.plumbing.compliance','Plumbing Compliance Coordinator','compliance','Track licensed-worker requirements, applicable certificates, inspection evidence and compliance handoffs without inventing jurisdictional requirements.',['plumbing_compliance','licensed_worker','certificate_tracking','inspection_evidence','compliance_handoff'],{riskCeiling:'HIGH',evidenceRequired:['licensed_worker_identity','required_compliance_evidence'],licensedWork:false}),
    mk('titan.plumbing.service_recovery','Plumbing Service Recovery Specialist','customer','Investigate plumbing complaints, compare scope with evidence and coordinate governed rework or customer recovery.',['plumbing_complaint','scope_comparison','rework_plan','customer_recovery'],{evidenceRequired:['customer_issue','original_scope','completion_evidence'],licensedWork:false}),
    mk('titan.plumbing.water_efficiency','Water Efficiency Coordinator','environment','Identify verified water-loss and efficiency opportunities from leaks, fixtures and measured consumption without compromising service or compliance.',['water_efficiency','leak_loss','fixture_efficiency','consumption_baseline','verified_savings'],{licensedWork:false})
  ];
  const byId=Object.fromEntries(SPECIALISTS.map(x=>[x.id,x]));

  const jt=(id,label,checklist,requiredEvidence,opts={})=>({id,label,checklist,requiredEvidence,licensedWorkerRequired:opts.licensedWorkerRequired!==false});
  const JOB_TYPES={
    leak_repair:jt('leak_repair','Leak / burst repair',['confirm affected area and urgency','record visible leak/water damage','confirm safe access and isolation status','licensed field worker diagnoses and repairs','perform appropriate field test','capture completion and residual-risk evidence'],['pre_work_observation','repair_evidence','field_test_result','completion_photos']),
    blocked_drain:jt('blocked_drain','Blocked drain',['record affected fixtures and symptom history','identify accessible inspection points','record overflow/sewage hazard if present','licensed field worker diagnoses blockage','record treatment/repair performed','verify flow and capture completion evidence'],['symptom_record','diagnostic_or_service_evidence','flow_verification']),
    hot_water:jt('hot_water','Hot water service',['capture unit make/model/type where safely available','record symptoms age and service history','identify urgent safety or leak concerns','licensed worker assesses unit','record repair/replacement recommendation and assumptions','verify service outcome and evidence'],['unit_identity','assessment_evidence','completion_or_recommendation_evidence']),
    fixture_repair:jt('fixture_repair','Fixture / sanitary repair',['confirm fixture and fault','record condition/photo','confirm approved repair/replacement scope','licensed worker performs applicable work','check operation and leaks','capture completion evidence'],['fixture_identity_or_photo','work_evidence','function_check']),
    emergency_callout:jt('emergency_callout','Emergency plumbing callout',['classify active hazard and occupancy impact','collect only safe observations','prioritise dispatch','record isolation status without unsafe remote instruction','licensed worker attends and stabilises','record residual risk and follow-up work'],['emergency_observation','attendance_evidence','stabilisation_or_followup_record']),
    preventive_maintenance:jt('preventive_maintenance','Preventive plumbing maintenance',['confirm asset/fixture list and service history','define inspection scope','identify known recurring faults','licensed worker performs required inspection/service','record defects and recommended follow-up','schedule next review from verified outcome'],['asset_or_fixture_record','inspection_evidence','maintenance_outcome'])
  };

  const classifyJobType=outcome=>{const t=String(outcome||'').toLowerCase();if(/emergency|flood|burst|uncontrolled|sewage overflow/.test(t))return JOB_TYPES.emergency_callout;if(/blocked|drain|sewer|slow drain/.test(t))return JOB_TYPES.blocked_drain;if(/hot water|heater|hws|cylinder/.test(t))return JOB_TYPES.hot_water;if(/toilet|cistern|tap|faucet|shower|sink|fixture/.test(t))return JOB_TYPES.fixture_repair;if(/prevent|maintenance|service plan|recurring/.test(t))return JOB_TYPES.preventive_maintenance;if(/leak|pipe|water loss/.test(t))return JOB_TYPES.leak_repair;return null;};

  const RULES=[
    [/\b(quote|quotation|price|estimate).*\b(assumption|exclusion|plumb|job)?/i,'titan.plumbing.quote_specialist'],
    [/\b(post.?repair|completion|test results?|quality|qc|defect|completion photos?)\b/i,'titan.plumbing.quality_inspector'],
    [/\b(scope|site details?|assess .*job)\b|\bphotos?\b.*\b(scope|customer notes?)\b/i,'titan.plumbing.scope_assessor'],
    [/\b(emergency|burst pipe|flooding|uncontrolled leak|sewage overflow|active water loss)\b/i,'titan.plumbing.emergency'],
    [/\b(blocked|drain|drainage|sewer|slow drain)\b/i,'titan.plumbing.drainage'],
    [/\b(hot water|heater|hws|cylinder)\b/i,'titan.plumbing.hot_water'],
    [/\b(toilet|cistern|tap|faucet|shower|sink|fixture|sanitary)\b/i,'titan.plumbing.fixture_sanitary'],
    [/\b(parts?|fittings?|valves?|materials?|stock|order)\b/i,'titan.plumbing.parts_materials'],
    [/\b(preventive|preventative|recurring|maintenance plan|scheduled maintenance)\b/i,'titan.plumbing.preventive_maintenance'],
    [/\b(compliance|certificate|licensed|licence|permit|inspection requirement)\b/i,'titan.plumbing.compliance'],
    [/\b(complaint|rework|unhappy|service recovery)\b/i,'titan.plumbing.service_recovery'],
    [/\b(water efficiency|water saving|consumption|water loss)\b/i,'titan.plumbing.water_efficiency'],
    [/\b(diagnos|triage|symptom|fault)\b/i,'titan.plumbing.diagnostic_triage']
  ];
  const route=(outcome,preferredId=null)=>{if(preferredId&&byId[preferredId])return byId[preferredId];const t=String(outcome||'');for(const [re,id] of RULES)if(re.test(t))return byId[id];return byId['titan.plumbing.diagnostic_triage'];};

  const executionContract=(worker,outcome)=>{const job=classifyJobType(outcome);const evidence=[...(worker?.evidenceRequired||[]),...(job?.requiredEvidence||[])];return `PLUMBING WORKFORCE ASSIGNMENT\nWorker: ${worker?.name||'Plumbing Worker'}\nCompany boundary: company_id\nCapabilities: ${(worker?.capabilities||[]).join(', ')}\n\nPlumbing operating contract:\n- Work toward the requested operational outcome and preserve evidence.\n- Treat remote observations as triage/scope inputs, not a substitute for licensed field diagnosis where licensed plumbing work is required.\n- Consequential regulated plumbing work must be performed or confirmed by an appropriately licensed/authorised worker under applicable local requirements.\n- Do not provide unsafe remote instructions for gas, electrical interfaces, contaminated sewage exposure, pressurised systems or other hazardous conditions.\n- Do not claim a repair, test, certificate, booking, purchase, message, invoice or other mutation happened without an authoritative result/receipt.\n- Do not mark work complete when required evidence, field verification, licensed-worker confirmation or material scope remains unresolved.\n- Escalate active flooding, sewage, gas suspicion, electrical interaction, structural damage and other hazards.\n${job?`- Job type: ${job.label}.\n- Checklist: ${job.checklist.join('; ')}.\n`:''}${evidence.length?`- Evidence expected: ${[...new Set(evidence)].join('; ')}.\n`:''}\nRequested outcome:\n${String(outcome||'').trim()}`;};

  const validateCompletion=({jobType,checklistCompleted=[],evidence=[],unresolved=[],licensedWorkerConfirmed=false}={})=>{const job=JOB_TYPES[jobType];const errors=[];if(!job)errors.push('known-plumbing-job-type-required');if(job&&checklistCompleted.length<job.checklist.length)errors.push('plumbing-checklist-incomplete');if(job&&evidence.length<job.requiredEvidence.length)errors.push('required-evidence-missing');if(job?.licensedWorkerRequired&&!licensedWorkerConfirmed)errors.push('licensed-worker-confirmation-required');if(unresolved?.length)errors.push('unresolved-plumbing-exceptions');return {valid:errors.length===0,errors};};
  const buildJobPlan=({jobType,outcome='',constraints=[]}={})=>{const job=JOB_TYPES[jobType]||classifyJobType(outcome)||JOB_TYPES.fixture_repair;return {job_type:job.id,label:job.label,checklist:[...job.checklist],required_evidence:[...job.requiredEvidence],licensed_worker_required:job.licensedWorkerRequired,constraints:[...constraints],company_boundary:'company_id'};};

  window.TitanPlumbingWorkforce={version:'1.0.0',specialists:SPECIALISTS,byId,jobTypes:JOB_TYPES,route,classifyJobType,executionContract,validateCompletion,buildJobPlan};
  try{chrome.storage.local.set({titanPlumbingWorkforceVersion:'1.0.0',titanPlumbingSpecialistCount:SPECIALISTS.length,titanPlumbingJobTypeCount:Object.keys(JOB_TYPES).length})}catch{}
})();
