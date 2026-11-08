// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-cleaning-workforce.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero Cleaning Vertical Workforce
 * Cleaning-domain specialists layered over the shared Titan Client Workforce.
 * Domain roles do not create authority. Consequential mutations remain approval/
 * receipt governed and company-scoped by the parent Workforce runtime.
 */
(() => {
  const mk = (id, name, department, purpose, capabilities, opts={}) => ({
    id, roleDefinitionId:id, role_definition_id:id, name,
    displayName:`Cleaning · ${name}`, icon:'🧹', department,
    division_key:department, purpose, description:purpose,
    capabilities, operational_domains:capabilities,
    autonomy:'governed', riskCeiling:opts.riskCeiling||'LOW', risk_ceiling:opts.riskCeiling||'LOW',
    min_business_tier:opts.minTier||'SOLO', vertical:'cleaning', verticals:['cleaning'],
    companyBoundary:'company_id', company_boundary:'company_id',
    activationConfersAuthority:false, activation_confers_authority:false,
    source:'Titan Zero Cleaning Vertical Workforce v1',
    evidenceRequired:opts.evidenceRequired||[],
    approvalRequiredFor:opts.approvalRequiredFor||[],
    tags:opts.tags||[]
  });

  const SPECIALISTS = [
    mk('titan.cleaning.scope_assessor','Cleaning Scope Assessor','sales',
      'Inspect customer details, photos and site information to define cleaning scope, exclusions, access needs and estimate inputs.',
      ['cleaning_scope','photo_scope','room_area_assessment','condition_notes','access_requirements','quote_inputs'],
      {evidenceRequired:['customer_scope','site_or_photo_evidence']}),
    mk('titan.cleaning.quote_specialist','Cleaning Quote Specialist','sales',
      'Turn an approved cleaning scope into a transparent cleaning quote with inclusions, exclusions, options and assumptions.',
      ['cleaning_quote','labour_estimate','service_options','scope_assumptions','quote_followup'],
      {approvalRequiredFor:['discount_outside_policy','price_override']}),
    mk('titan.cleaning.crew_planner','Cleaner Crew Planner','work',
      'Plan cleaner count, estimated labour, sequence, zones, skills, equipment and handoffs for a cleaning job.',
      ['crew_planning','labour_planning','zone_assignment','equipment_plan','job_sequence','handoff_plan']),
    mk('titan.cleaning.quality_inspector','Cleaning Quality Inspector','work',
      'Review checklist and visual evidence for missed areas, quality defects, rework needs and completion readiness.',
      ['cleaning_qc','photo_qa','missed_area_detection','checklist_verification','rework_request','completion_gate'],
      {evidenceRequired:['checklist','before_after_photos']}),
    mk('titan.cleaning.bond_specialist','Bond & End-of-Lease Specialist','work',
      'Coordinate end-of-lease and bond-clean scope, property-specific checklist, evidence and rework readiness.',
      ['bond_clean','end_of_lease','property_checklist','oven_clean','window_clean','rework_readiness'],
      {evidenceRequired:['property_scope','completion_photos']}),
    mk('titan.cleaning.airbnb_turnover','Airbnb Turnover Coordinator','work',
      'Coordinate short-stay turnovers including time windows, linen, amenities, damage observations and guest-ready verification.',
      ['airbnb_turnover','linen_turnover','amenities','guest_ready','damage_observation','turnover_timing'],
      {evidenceRequired:['turnover_checklist','guest_ready_photos']}),
    mk('titan.cleaning.commercial_coordinator','Commercial Cleaning Coordinator','work',
      'Coordinate recurring commercial sites, zones, service frequencies, access constraints, consumables and site standards.',
      ['commercial_cleaning','site_zones','service_frequency','site_access','site_standards','consumables']),
    mk('titan.cleaning.chemicals_sds','Cleaning Chemicals & SDS Coordinator','safety',
      'Keep chemical use aligned with product labels and current SDS information, including PPE, dilution, storage and incompatibility warnings.',
      ['sds','chemical_register','ppe','dilution_guidance','storage','chemical_compatibility','spill_response_reference'],
      {riskCeiling:'MEDIUM',evidenceRequired:['product_identity','current_sds'],approvalRequiredFor:['new_chemical_use']}),
    mk('titan.cleaning.consumables','Cleaning Consumables Coordinator','assets',
      'Forecast and replenish cleaning chemicals, cloths, liners, paper goods, amenities and other consumables using job demand and par levels.',
      ['consumable_forecast','par_levels','reorder','van_stock','chemical_stock','linen_stock']),
    mk('titan.cleaning.recurring_optimizer','Recurring Cleaning Optimiser','work',
      'Optimise recurring domestic or commercial cleaning frequency, task rotation, visit duration and service consistency from verified outcomes.',
      ['recurring_cleaning','frequency_optimisation','task_rotation','duration_review','service_consistency']),
    mk('titan.cleaning.keys_access','Keys & Access Coordinator','operations',
      'Manage bounded cleaning-site access instructions, key custody references, alarm/access handoffs and return confirmation without exposing secrets unnecessarily.',
      ['key_custody','site_access','alarm_handoff','access_window','key_return','access_exception'],
      {riskCeiling:'MEDIUM',evidenceRequired:['access_authorisation']}),
    mk('titan.cleaning.service_recovery','Cleaning Service Recovery Specialist','customer',
      'Investigate cleaning complaints, compare promised scope to evidence, propose rework and coordinate customer recovery.',
      ['cleaning_complaint','scope_comparison','rework_plan','customer_recovery','quality_evidence'],
      {evidenceRequired:['customer_issue','original_scope','completion_evidence']}),
    mk('titan.cleaning.deep_clean_specialist','Deep Cleaning Specialist','work',
      'Plan high-detail deep cleaning, task sequencing, dwell-time dependencies and high-soil-area treatment using approved products and methods.',
      ['deep_clean','detail_cleaning','high_soil_areas','task_sequence','product_constraints']),
    mk('titan.cleaning.carpet_upholstery','Carpet & Upholstery Coordinator','work',
      'Scope carpet and upholstery cleaning with material/condition notes, method constraints, drying considerations and evidence requirements.',
      ['carpet_cleaning','upholstery_cleaning','material_condition','method_constraints','drying_plan']),
    mk('titan.cleaning.linen_laundry','Linen & Laundry Coordinator','assets',
      'Coordinate linen counts, clean/dirty separation, laundry handoff, shortages, damage and replenishment for turnover services.',
      ['linen_inventory','laundry_handoff','shortage_detection','linen_damage','replenishment']),
    mk('titan.cleaning.environmental_efficiency','Cleaning Resource Efficiency Coordinator','environment',
      'Measure and reduce avoidable water, chemical, energy, consumable and waste intensity without compromising cleaning outcomes or safety.',
      ['water_efficiency','chemical_efficiency','energy_efficiency','waste_reduction','resource_intensity','verified_outcomes'])
  ];

  const byId = Object.fromEntries(SPECIALISTS.map(w=>[w.id,w]));
  const BUILT_IN_SPECIALIST_IDS = new Set(SPECIALISTS.map(w=>w.id));
  const BUILT_IN_SPECIALIST_NAMES = new Set(SPECIALISTS.map(w=>String(w.name||'').replace(/\s+/g,' ').trim().toLowerCase()));
  const MARKETPLACE_STORE = 'titanCleaningWorkforceMarketplaceV1';
  const LEGACY_COMPANY_BOUNDARY_KEYS = ['tenant_id','tenantId','tenant_company_id','business_id','businessId','account_id','accountId'];
  const hasLegacyCompanyBoundary = value => !!value && typeof value==='object' && LEGACY_COMPANY_BOUNDARY_KEYS.some(key=>Object.prototype.hasOwnProperty.call(value,key));

  const marketplaceSpecialist = product => mk(
    product.id,
    product.name,
    product.department||'work',
    product.purpose||product.description||'Optional cleaning workforce specialist installed from the company marketplace.',
    Array.isArray(product.capabilities)?product.capabilities:[],
    {
      riskCeiling:product.risk_ceiling||'LOW',
      evidenceRequired:Array.isArray(product.evidence_required)?product.evidence_required:[],
      approvalRequiredFor:Array.isArray(product.approval_required_for)?product.approval_required_for:[],
      tags:['marketplace',...(Array.isArray(product.tags)?product.tags:[])]
    }
  );

  async function performMarketplaceSpecialistSync(){
    try{
      if(!globalThis.chrome?.storage?.local) return {added:0,removed:0,total:SPECIALISTS.length,reason:'storage-unavailable'};
      const stored=await chrome.storage.local.get(['titanBusinessProfile',MARKETPLACE_STORE]);
      const profile=stored.titanBusinessProfile||{};
      if(hasLegacyCompanyBoundary(profile)) return {added:0,removed:0,total:SPECIALISTS.length,reason:'legacy-company-boundary-rejected'};
      const company_id=String(profile.company_id||'').trim();
      if(!company_id) return {added:0,removed:0,total:SPECIALISTS.length,reason:'company_id-required'};
      const root=stored[MARKETPLACE_STORE]||{};
      const state=root[company_id];
      if(!state || hasLegacyCompanyBoundary(state) || String(state.company_id||'').trim()!==company_id) return {added:0,removed:0,total:SPECIALISTS.length,reason:'company-state-unavailable'};

      const products=Array.isArray(window.TitanCleaningWorkforceProducts?.products)?window.TitanCleaningWorkforceProducts.products:[];
      const wanted=[];
      const seenIds=new Set(BUILT_IN_SPECIALIST_IDS);
      const seenNames=new Set(BUILT_IN_SPECIALIST_NAMES);
      for(const product of products){
        if(!product || typeof product!=='object') continue;
        const id=String(product.id||'').trim();
        const lifecycle=state.products?.[id];
        if(!lifecycle || typeof lifecycle!=='object' || hasLegacyCompanyBoundary(lifecycle)) continue;
        if(lifecycle.company_id!==undefined && String(lifecycle.company_id||'').trim()!==company_id) continue;
        const status=lifecycle.status;
        if(!['purchased','installed'].includes(status)) continue;
        const name=String(product.name||'').replace(/\s+/g,' ').trim();
        const normalizedName=name.toLowerCase();
        if(!id || !name || seenIds.has(id) || seenNames.has(normalizedName)) continue;
        seenIds.add(id);
        seenNames.add(normalizedName);
        wanted.push(product);
      }

      const wantedIds=new Set(wanted.map(p=>p.id));
      let removed=0;
      for(let i=SPECIALISTS.length-1;i>=0;i--){
        const item=SPECIALISTS[i];
        if(item.marketplace===true && (!wantedIds.has(item.id) || String(item.company_id||'')!==company_id)){
          SPECIALISTS.splice(i,1);
          if(byId[item.id]===item) delete byId[item.id];
          removed++;
        }
      }

      let added=0;
      const reconciled=[];
      for(const product of wanted){
        let item=byId[product.id];
        if(item && item.marketplace===true && String(item.company_id||'')===company_id){
          item.marketplace_status=state.products?.[product.id]?.status||'purchased';
        }else if(item){
          continue;
        }else{
          item=marketplaceSpecialist(product);
          item.marketplace=true;
          item.marketplace_status=state.products?.[product.id]?.status||'purchased';
          item.company_id=company_id;
          item.purchaseConfersAuthority=false;
          item.purchase_confers_authority=false;
          item.installationConfersAuthority=false;
          item.installation_confers_authority=false;
          item.marketplaceStatusConfersAuthority=false;
          item.marketplace_status_confers_authority=false;
          item.identityConfersAuthority=false;
          item.identity_confers_authority=false;
          item.rosterPresenceConfersAuthority=false;
          item.roster_presence_confers_authority=false;
          item.grantsAuthority=false;
          item.grants_authority=false;
          byId[item.id]=item;
          added++;
        }
        reconciled.push(item);
      }

      for(let i=SPECIALISTS.length-1;i>=0;i--) if(SPECIALISTS[i].marketplace===true) SPECIALISTS.splice(i,1);
      SPECIALISTS.push(...reconciled);
      return {added,removed,total:SPECIALISTS.length,company_id};
    }catch(error){
      return {added:0,removed:0,total:SPECIALISTS.length,error:String(error?.message||error)};
    }
  }


  let marketplaceSyncQueue=Promise.resolve();
  function syncMarketplaceSpecialists(){
    marketplaceSyncQueue=marketplaceSyncQueue.then(
      ()=>performMarketplaceSpecialistSync(),
      ()=>performMarketplaceSpecialistSync()
    );
    return marketplaceSyncQueue;
  }

  const scheduleMarketplaceRehydration = changes => {
    if(!changes || (changes.titanBusinessProfile===undefined && changes[MARKETPLACE_STORE]===undefined)) return;
    syncMarketplaceSpecialists();
  };

  const JOB_TYPES = {
    domestic_recurring:{id:'domestic_recurring',label:'Domestic recurring clean',checklist:['Confirm agreed rooms and exclusions','Kitchen surfaces and sink','Bathrooms and toilets','Dust reachable agreed surfaces','Vacuum and mop agreed floors','Reset agreed rooms','Record exceptions or damage observations'],requiredEvidence:['completed checklist','exceptions/issue evidence when present']},
    deep_clean:{id:'deep_clean',label:'Deep clean',checklist:['Confirm detailed scope and exclusions','High-detail kitchen clean','High-detail bathroom clean','Edges, skirtings and detail dusting','High-soil areas per approved method','Floors and finishing pass','Quality inspection'],requiredEvidence:['scope reference','completion checklist','before/after photos for nominated high-soil areas']},
    bond_end_of_lease:{id:'bond_end_of_lease',label:'Bond / end-of-lease clean',checklist:['Confirm property scope and agent/customer requirements','Kitchen including oven where included','Bathrooms and toilets','Inside cupboards where included','Windows/glass where included','Walls/marks where included','Floors and carpet scope','Final room-by-room inspection'],requiredEvidence:['property checklist','before/after photos','exclusions and pre-existing condition notes']},
    airbnb_turnover:{id:'airbnb_turnover',label:'Airbnb / short-stay turnover',checklist:['Confirm checkout/check-in window','Strip and replace linen','Bathrooms reset','Kitchen reset','Whole-property clean to turnover standard','Restock approved amenities','Observe/report damage or missing items','Guest-ready final inspection'],requiredEvidence:['turnover checklist','guest-ready photos','damage/missing-item evidence when present']},
    commercial:{id:'commercial',label:'Commercial cleaning',checklist:['Confirm site zones and access window','Complete frequency-based zone tasks','Amenities/restrooms','Waste and recycling tasks in scope','Floors and touchpoints in scope','Restock site consumables where authorised','Record site hazards/issues','Supervisor/QA exception review'],requiredEvidence:['site checklist','exception evidence','consumable record when replenished']},
    move_in:{id:'move_in',label:'Move-in clean',checklist:['Confirm empty/occupied areas','Kitchen and storage interiors in scope','Bathrooms','Dust/detail surfaces','Floors','Final readiness inspection'],requiredEvidence:['completion checklist','readiness photos where requested']},
    office:{id:'office',label:'Office clean',checklist:['Workstations/common areas in scope','Kitchen/break areas','Restrooms','Bins/recycling','Floors','Touchpoints per agreed scope','Final exception check'],requiredEvidence:['site checklist','issue evidence when present']}
  };

  const ROUTES = [
    ['titan.cleaning.quote_specialist',/\b(quote|quotation|price|pricing|send estimate)\b/i],
    ['titan.cleaning.chemicals_sds',/\b(sds|safety data sheet|chemical|dilution|ppe|mixing|spill|product label)\b/i],
    ['titan.cleaning.keys_access',/\b(key|keys|alarm code|access code|site access|lockbox|entry instruction|access instruction)\b/i],
    ['titan.cleaning.quality_inspector',/\b(missed area|missed areas|quality|qc|completion photo|completion photos|inspect|inspection|rework|final check)\b/i],
    ['titan.cleaning.crew_planner',/\b(cleaner crew|crew plan|labour hours|labor hours|how many cleaners|allocate cleaners|zone assignment)\b/i],
    ['titan.cleaning.consumables',/\b(consumable|microfibre|microfiber|liner|paper towel|toilet paper|reorder|stock|amenities|chemical stock)\b/i],
    ['titan.cleaning.recurring_optimizer',/\b(recurring|weekly|fortnightly|monthly|repeat clean|frequency|rotation)\b/i],
    ['titan.cleaning.scope_assessor',/\b(scope|assess|assessment|scope from|estimate inputs?|from (these )?photos?|rooms?|bedroom|bathroom|square metre|square meter|condition)\b/i],
    ['titan.cleaning.airbnb_turnover',/\b(airbnb|short[- ]?stay|turnover|guest[- ]?ready|check[- ]?in|check[- ]?out)\b/i],
    ['titan.cleaning.bond_specialist',/\b(bond clean|end[- ]?of[- ]?lease|end of lease|vacate clean|rental exit)\b/i],
    ['titan.cleaning.commercial_coordinator',/\b(commercial|office|site zones|facility clean|facilities clean)\b/i],
    ['titan.cleaning.deep_clean_specialist',/\b(deep clean|deep cleaning|high soil|detail clean)\b/i],
    ['titan.cleaning.carpet_upholstery',/\b(carpet|upholstery|sofa|rug|fabric clean)\b/i],
    ['titan.cleaning.linen_laundry',/\b(linen|laundry|towels|sheets|bedding)\b/i],
    ['titan.cleaning.service_recovery',/\b(complaint|unhappy|missed clean|failed clean|refund|service recovery)\b/i],
    ['titan.cleaning.environmental_efficiency',/\b(water use|water usage|chemical use|chemical usage|waste|environment|resource efficiency|energy use)\b/i]
  ];
  const route = (outcome, preferredId=null) => {
    if(preferredId && byId[preferredId]) return byId[preferredId];
    const text=String(outcome||'');
    for(const [id,re] of ROUTES) if(re.test(text)) return byId[id];
    return byId['titan.cleaning.scope_assessor'];
  };

  const classifyJobType = outcome => {
    const t=String(outcome||'').toLowerCase();
    if(/airbnb|short[- ]?stay|turnover/.test(t)) return JOB_TYPES.airbnb_turnover;
    if(/bond|end[- ]?of[- ]?lease|vacate/.test(t)) return JOB_TYPES.bond_end_of_lease;
    if(/deep clean/.test(t)) return JOB_TYPES.deep_clean;
    if(/commercial|office|facility/.test(t)) return JOB_TYPES.commercial;
    if(/move[- ]?in/.test(t)) return JOB_TYPES.move_in;
    if(/weekly|fortnightly|monthly|recurring/.test(t)) return JOB_TYPES.domestic_recurring;
    return null;
  };

  const executionContract = (worker, outcome) => {
    const job=classifyJobType(outcome);
    const evidence=[...(worker?.evidenceRequired||[]),...(job?.requiredEvidence||[])];
    return `CLEANING WORKFORCE ASSIGNMENT\nWorker: ${worker?.name||'Cleaning Worker'}\nDepartment: ${worker?.department||'cleaning'}\nCompany boundary: company_id\nCapabilities: ${(worker?.capabilities||[]).join(', ')}\n\nCleaning operating contract:\n- Work toward the requested operational outcome, not merely a conversational answer.\n- Confirm scope, inclusions, exclusions and access constraints before consequential action.\n- Use only products/methods permitted by the product label, current SDS, company policy and applicable requirements; never invent chemical compatibility or mixing instructions.\n- Preserve customer/property privacy and minimise exposure of keys, alarm/access codes and other secrets.\n- Record exceptions, pre-existing damage observations and blockers rather than silently treating them as completed work.\n- For quality/completion work, compare the promised scope, checklist and available before/after evidence.\n- Do not mark a cleaning job complete when required evidence is missing or material scope remains unresolved.\n- Do not claim a customer message, booking, purchase, refund, invoice or other mutation occurred without an authoritative execution result/receipt.\n- Escalate hazards, uncertain chemical use, damage, access problems and approval-required changes.\n${job?`- Job type: ${job.label}.\n- Checklist: ${job.checklist.join('; ')}.\n`:''}${evidence.length?`- Evidence expected: ${[...new Set(evidence)].join('; ')}.\n`:''}\nRequested outcome:\n${String(outcome||'').trim()}`;
  };

  const validateCompletion = ({jobType, checklistCompleted=[], evidence=[], unresolved=[]}={}) => {
    const jt=JOB_TYPES[jobType];
    const errors=[];
    if(!jt) errors.push('known-cleaning-job-type-required');
    if(jt && checklistCompleted.length < jt.checklist.length) errors.push('cleaning-checklist-incomplete');
    if(jt && (!Array.isArray(evidence) || evidence.length < jt.requiredEvidence.length)) errors.push('required-evidence-missing');
    if(Array.isArray(unresolved) && unresolved.length) errors.push('unresolved-cleaning-exceptions');
    return {valid:errors.length===0,errors};
  };

  const buildJobPlan = ({jobType,outcome='',rooms=[],constraints=[]}={}) => {
    const jt=JOB_TYPES[jobType]||classifyJobType(outcome)||JOB_TYPES.domestic_recurring;
    return {job_type:jt.id,label:jt.label,checklist:[...jt.checklist],required_evidence:[...jt.requiredEvidence],rooms:[...rooms],constraints:[...constraints],completion_requires_evidence:true};
  };

  window.TitanCleaningWorkforce={version:'1.0.0',specialists:SPECIALISTS,byId,jobTypes:JOB_TYPES,route,classifyJobType,executionContract,validateCompletion,buildJobPlan,syncMarketplaceSpecialists};
  try{
    chrome.storage.local.set({titanCleaningWorkforceVersion:'1.0.0',titanCleaningSpecialistCount:SPECIALISTS.length,titanCleaningJobTypeCount:Object.keys(JOB_TYPES).length});
    if(chrome.storage?.onChanged?.addListener) chrome.storage.onChanged.addListener((changes,areaName)=>{ if(areaName==='local') scheduleMarketplaceRehydration(changes); });
    syncMarketplaceSpecialists();
  }catch{}
})();
