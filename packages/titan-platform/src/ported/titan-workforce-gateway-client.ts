// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-workforce-gateway-client.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero -> Laravel Client Workforce Gateway. Client operations only; no deployment professional access. */
(() => {
  'use strict';
  const CONFIG_KEY='titanClientWorkforceGatewayConfigV1';
  const RECEIPT_KEY='titanClientWorkforceGatewayReceiptsV1';
  const CACHE_KEY='titanClientWorkforceGatewayReadCacheV1';
  const PROJECTION_CURSOR_KEY='titanClientWorkforceProjectionCursorV1';
  const OBSERVABILITY_KEY='titanClientWorkforceObservabilityV1';
  const DIAGNOSTIC_LOG_KEY='titanDiagnosticLog';
  const DIAGNOSTIC_LOG_MAX=1000;
  const REALTIME_MIN_POLL_MS=10000;
  const REALTIME_DEFAULT_POLL_MS=30000;
  const REALTIME_MAX_POLL_MS=300000;
  let realtimeController=null;
  const BACKEND_LINEAGE=Object.freeze({
    schema:'titan.workforce.gateway.backend-lineage-expectation.v1',
    gateway_cumulative_sha256:'13b7fbdf89ef65a7348bd36e50ff368d9a42177f92bc566e5aad3b0e572aa6f1',
    declared_parent_sha256:'f8de3ed1bf3350d0524079b5825c76ec27d8761d56eae2a1f60f708a4ec7cda9',
    parent_identity_status:'UNRESOLVED_PARENT_IDENTITY',
    rejects_product_substitution:true,
    grants_authority:false
  });
  const DEPLOYMENT_LINEAGE=Object.freeze({
    schema:'titan.workforce.gateway.deployment-lineage-expectation.v1',
    titan_code_gateway_cumulative_sha256:'abbd92867d99a77cae53a2f7d528a3c3e05fa1db4c0968c6fe49447f7a5f6949',
    titan_code_gateway_parent_sha256:'8746eb82b50c5d168046392a93bf5fbe4de050259fa89ba830684b3cb3e74a2f',
    codee_canonical_master:'Codee Master Step 12.zip',
    codee_canonical_sha256:'35d55b3211dabc0f3c6a5e5237ee61ed65520dc7c7effa203a2f8f87a27c3ee2',
    codee_relationship_status:'SEMANTIC_CONTEXT_NOT_PARENT_IDENTITY',
    archive_comparison:{codee_files:56,titan_code_files:572,shared_relative_paths:3,byte_identical_shared_paths:0},
    grants_authority:false
  });

  const GATEWAY_CONTRACT=Object.freeze({
    schema:'titan.workforce.gateway.contract.v2',
    request_schema:'titan.workforce.gateway.request.v2',
    receipt_schema:'titan.workforce.gateway.receipt.v2',
    projection_schema:'titan.workforce.gateway.projection.v2',
    required_identity_fields:['company_id','actor_id','source_surface','auth_context'],
    required_causality_fields:['trace_id','correlation_id','causation_id','idempotency_key'],
    grants_authority:false
  });
  const cleanList=(value,limit=50)=>Array.isArray(value)?value.slice(0,limit).map(v=>clean(v,240)).filter(Boolean):[];
  function buildEnvelope(input,{request_id,company_id,actor_id,operation,mode,trace_id}){
    const correlation_id=clean(input.correlation_id,160)||trace_id;
    const causation_id=clean(input.causation_id,160)||request_id;
    return {
      schema:GATEWAY_CONTRACT.request_schema,
      contract_schema:GATEWAY_CONTRACT.schema,
      request_id,company_id,actor_id,source_surface:'titan_zero',target_domain:'client_workforce',
      intent:operation,operation,mode,operation_id:clean(input.operation_id,180)||request_id,
      trace_id,correlation_id,causation_id,
      idempotency_key:clean(input.idempotency_key,200)||`titan-zero:${company_id}:${operation}:${request_id}`,
      mission_id:clean(input.mission_id||input.deployment_mission_id,160)||null,
      handover_id:clean(input.handover_id||input.client_workforce_handover_id,160)||null,
      evidence_refs:cleanList(input.evidence_refs),
      auth_context:{schema:'titan.workforce.gateway.auth-context.v1',requested_actor_id:actor_id,requested_company_id:company_id,binding_mode:actor_id==='authenticated'?'server_authenticated_actor':'explicit_actor',grants_authority:false},
      requested_at:new Date().toISOString(),grants_authority:false
    };
  }
  function verifyContractResponse(body,request,company_id){
    const receipt=body.receipt||body;
    const receiptSchema=receipt?.schema;
    if(![GATEWAY_CONTRACT.receipt_schema,'titan.workforce.gateway.receipt.v1'].includes(receiptSchema))throw new Error('invalid-workforce-gateway-receipt-schema');
    if(receipt.request_id!==request.request_id||receipt.company_id!==company_id||receipt.grants_authority!==false)throw new Error('invalid-workforce-gateway-receipt');
    for(const field of ['trace_id','correlation_id','causation_id','idempotency_key']){
      if(receipt[field]!=null&&String(receipt[field])!==String(request[field]))throw new Error(`workforce-gateway-${field}-mismatch`);
    }
    const authBinding=verifyAuthenticatedBinding(receipt,request,company_id);
    const projection=body.projection??null;
    if(projection!==null){
      if(![GATEWAY_CONTRACT.projection_schema,'titan.workforce.gateway.projection.v1'].includes(projection.schema))throw new Error('invalid-workforce-gateway-projection-schema');
      if(projection.company_id!==company_id)throw new Error('cross-company-workforce-projection-rejected');
      if(projection.authorized_company_id!=null&&String(projection.authorized_company_id)!==company_id)throw new Error('cross-company-workforce-authorized-scope-rejected');
      if(projection.grants_authority!==false)throw new Error('workforce-projection-authority-violation');
      if(projection.target_surface!=='titan_zero')throw new Error('workforce-projection-surface-mismatch');
      if(projection.authenticated_actor_id!=null&&authBinding.authenticated_actor_id&&String(projection.authenticated_actor_id)!==String(authBinding.authenticated_actor_id))throw new Error('workforce-projection-authenticated-actor-mismatch');
      for(const field of ['trace_id','correlation_id'])if(projection[field]!=null&&String(projection[field])!==String(request[field]))throw new Error(`workforce-projection-${field}-mismatch`);
    }
    return {receipt,projection,auth_binding:authBinding};
  }

  function verifyAuthenticatedBinding(receipt,request,company_id){
    const legacy=receipt?.schema==='titan.workforce.gateway.receipt.v1';
    const authenticated_actor_id=clean(receipt?.authenticated_actor_id||receipt?.actor_id,160);
    const authorized_company_id=clean(receipt?.authorized_company_id||receipt?.company_id,128);
    if(authorized_company_id&&authorized_company_id!==company_id)throw new Error('cross-company-workforce-authorized-scope-rejected');
    if(legacy&&!authenticated_actor_id)return {verified:false,status:'LEGACY_V1_AUTH_CONTEXT_UNVERIFIED',authenticated_actor_id:null,authorized_company_id:company_id,grants_authority:false};
    if(receipt?.schema===GATEWAY_CONTRACT.receipt_schema){
      if(!validActor(authenticated_actor_id))throw new Error('authenticated-actor-proof-required');
      if(request.actor_id!=='authenticated'&&authenticated_actor_id!==request.actor_id)throw new Error('authenticated-actor-mismatch');
      if(!authorized_company_id)throw new Error('authorized-company-proof-required');
      return {verified:true,status:'AUTHENTICATED_ACTOR_COMPANY_BOUND',authenticated_actor_id,authorized_company_id,grants_authority:false};
    }
    return {verified:Boolean(authenticated_actor_id),status:authenticated_actor_id?'LEGACY_V1_ACTOR_PRESENT_UNVERIFIED':'LEGACY_V1_AUTH_CONTEXT_UNVERIFIED',authenticated_actor_id:authenticated_actor_id||null,authorized_company_id:authorized_company_id||company_id,grants_authority:false};
  }

  const NON_EQUIVALENT_BACKEND_PRODUCTS=new Set(['titan workforce management','titan workforce manager','titan installation workforce','titan installed client workforce','titan investigation workforce','titan solution engineering workforce','titan ai workforce']);
  const READ=new Set(['client.workforce.status','client.workforce.roster','client.workforce.assignments','client.workforce.approvals','client.workforce.escalations','client.workforce.receipts','client.workforce.handover.get','client.workforce.change_request.list']);
  const PROPOSE=new Set(['client.workforce.control.propose','client.workforce.role_activation.propose','client.workforce.assignment_review.propose','client.workforce.change_request.propose']);
  const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(String(v||'').trim());
  const validActor=v=>/^[A-Za-z0-9._:@/-]{2,160}$/.test(String(v||'').trim());
  const uid=p=>`${p}-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2,10)}`}`;
  const clean=(v,n=160)=>String(v??'').trim().slice(0,n);
  function normalizeCompanyBoundaryInput(input={}){
    const candidates=[input.company_id,input.companyId,input.tenant_id,input.tenant_company_id,input.tenantCompanyId].map(v=>clean(v,128)).filter(Boolean);
    const unique=[...new Set(candidates)];
    if(!unique.length||!validCompany(unique[0]))throw new Error('company_id-required');
    if(unique.length!==1)throw new Error('conflicting-company-boundary-rejected');
    return unique[0];
  }
  const publicConfig=c=>({...c,token:c?.token?'configured':''});
  function sanitize(value,depth=0,seen=new WeakSet()){
    if(depth>7)return '[TRUNCATED]'; if(value==null||typeof value==='boolean'||typeof value==='number')return value;if(typeof value==='string')return value.slice(0,12000);if(typeof value!=='object')return String(value).slice(0,1000);if(seen.has(value))return '[Circular]';seen.add(value);
    if(Array.isArray(value))return value.slice(0,200).map(x=>sanitize(x,depth+1,seen));const out={};for(const [k,v] of Object.entries(value).slice(0,200)){if(/^(password|secret|token|api[_-]?key|authorization|cookie|credential)$/i.test(k)){out[k]='[REDACTED]';continue;}out[String(k).slice(0,120)]=sanitize(v,depth+1,seen);}return out;
  }
  function connectivityState(){
    try{if(globalThis.navigator&&globalThis.navigator.onLine===false)return 'offline';}catch(_){}
    return 'online';
  }
  async function observeWorkforce(level,event,detail={}){
    try{
      const company_id=clean(detail.company_id,128)||await companyId().catch(()=>null);
      const safeDetail=sanitize({...detail,company_id:company_id||null,grants_authority:false,authority_effect:false});
      delete safeDetail.token;delete safeDetail.authorization;delete safeDetail.request_body;delete safeDetail.response_body;
      const now=new Date().toISOString();
      let managerRecorded=false;
      if(company_id){
        try{
          const response=await new Promise((resolve,reject)=>chrome.runtime.sendMessage({type:'TITAN_OBSERVABILITY',action:'record',event:{company_id,event_type:String(event||'workforce-event'),component:'workforce-gateway',severity:String(level||'info'),source:'client-workforce-gateway',correlation_id:clean(detail.correlation_id,160)||null,operation_id:clean(detail.operation_id,180)||null,causation_id:clean(detail.request_id,160)||null,actor_id:'titan-zero-workforce-gateway',payload:safeDetail,tags:['workforce','gateway'],grants_authority:false,authority_effect:false}},r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r);}));
          managerRecorded=response?.ok===true;
        }catch(_){managerRecorded=false;}
      }
      const data=await chrome.storage.local.get([DIAGNOSTIC_LOG_KEY,OBSERVABILITY_KEY]);
      const root=data[OBSERVABILITY_KEY]&&typeof data[OBSERVABILITY_KEY]==='object'?data[OBSERVABILITY_KEY]:{};
      if(company_id){
        const prior=root[company_id]&&typeof root[company_id]==='object'?root[company_id]:{};
        const failures=Number(prior.failures||0)+(level==='error'?1:0);
        root[company_id]={...prior,schema:'titan.workforce.observability.v1',company_id,last_event:String(event||'workforce-event'),last_event_at:now,last_level:String(level||'info'),manager_observability_recorded:managerRecorded,connectivity:connectivityState(),transport:detail.transport||detail.mode||prior.transport||null,projection_revision:detail.projection_revision??prior.projection_revision??null,projection_cursor:detail.projection_cursor??prior.projection_cursor??null,retry_count:Number(detail.retry_count??prior.retry_count??0),last_operation_id:clean(detail.operation_id,180)||prior.last_operation_id||null,last_request_id:clean(detail.request_id,160)||prior.last_request_id||null,last_trace_id:clean(detail.trace_id,160)||prior.last_trace_id||null,last_correlation_id:clean(detail.correlation_id,160)||prior.last_correlation_id||null,last_receipt_id:clean(detail.receipt_id,180)||prior.last_receipt_id||null,last_failure_category:clean(detail.failure_category,80)||prior.last_failure_category||null,last_failure_class:clean(detail.failure_class,80)||prior.last_failure_class||null,last_retry_disposition:clean(detail.retry_disposition,80)||prior.last_retry_disposition||null,last_error:level==='error'?clean(detail.error||detail.message,500):prior.last_error||null,failures,grants_authority:false,authority_effect:false};
      }
      const update={[OBSERVABILITY_KEY]:root};
      if(!managerRecorded){const log=Array.isArray(data[DIAGNOSTIC_LOG_KEY])?data[DIAGNOSTIC_LOG_KEY]:[];log.push({ts:now,level:String(level||'info'),source:'client-workforce-gateway',message:String(event||'workforce-event'),detail:safeDetail});update[DIAGNOSTIC_LOG_KEY]=log.slice(-DIAGNOSTIC_LOG_MAX);}
      await chrome.storage.local.set(update);
    }catch(_){ }
  }
  async function workforceHealth(){
    const company_id=await companyId();const d=await chrome.storage.local.get([OBSERVABILITY_KEY]);const root=d[OBSERVABILITY_KEY]&&typeof d[OBSERVABILITY_KEY]==='object'?d[OBSERVABILITY_KEY]:{};return sanitize(root[company_id]||{schema:'titan.workforce.observability.v1',company_id,status:'no-events',grants_authority:false,authority_effect:false});
  }
  async function readCache(operation){
    const company_id=await companyId();const d=await chrome.storage.local.get([CACHE_KEY]);const root=d[CACHE_KEY]&&typeof d[CACHE_KEY]==='object'?d[CACHE_KEY]:{};const company=root[company_id]&&typeof root[company_id]==='object'?root[company_id]:{};const entry=company[operation];
    if(!entry)return null;return {...entry,company_id,operation,cache_status:'CACHED_OFFLINE_READ',grants_authority:false};
  }
  async function writeCache(operation,result){
    if(!READ.has(operation))return;const company_id=await companyId();const d=await chrome.storage.local.get([CACHE_KEY]);const root=d[CACHE_KEY]&&typeof d[CACHE_KEY]==='object'?d[CACHE_KEY]:{};const company=root[company_id]&&typeof root[company_id]==='object'?root[company_id]:{};company[operation]={data:sanitize(result?.data??null),projection:sanitize(result?.projection??null),cached_at:new Date().toISOString(),grants_authority:false};root[company_id]=company;await chrome.storage.local.set({[CACHE_KEY]:root});
  }
  function createRequest(input={}){
    const company_id=normalizeCompanyBoundaryInput(input),actor_id=clean(input.actor_id,160),operation=clean(input.operation,180);if(!validActor(actor_id))throw new Error('actor_id-required');
    if(operation.startsWith('deployment.'))throw new Error('operation-denied');const read=READ.has(operation),propose=PROPOSE.has(operation);if(!read&&!propose)throw new Error('operation-denied');const request_id=clean(input.request_id,160)||uid('wf-client');const trace_id=clean(input.trace_id,160)||uid('trace');
    return {...buildEnvelope(input,{request_id,company_id,actor_id,operation,mode:read?'read':'propose',trace_id}),payload:sanitize(input.payload||{}),backend_lineage_expectation:{...BACKEND_LINEAGE},deployment_lineage_expectation:{...DEPLOYMENT_LINEAGE}};
  }
  function verifyBackendLineageProof(proof){
    if(proof==null)return {verified:false,status:'UNVERIFIED_HOST_LINEAGE',reason:'backend-lineage-proof-not-returned'};
    if(typeof proof!=='object'||Array.isArray(proof))throw new Error('invalid-workforce-backend-lineage-proof');
    const product=clean(proof.product||proof.product_name||proof.canonical_product,180).toLowerCase();
    if(product&&NON_EQUIVALENT_BACKEND_PRODUCTS.has(product))throw new Error('workforce-backend-product-substitution-rejected');
    const cumulative=clean(proof.gateway_cumulative_sha256||proof.cumulative_sha256,80).toLowerCase();
    const parent=clean(proof.declared_parent_sha256||proof.parent_sha256,80).toLowerCase();
    if(cumulative&&cumulative!==BACKEND_LINEAGE.gateway_cumulative_sha256)throw new Error('workforce-backend-cumulative-mismatch');
    if(parent&&parent!==BACKEND_LINEAGE.declared_parent_sha256)throw new Error('workforce-backend-parent-mismatch');
    const verified=cumulative===BACKEND_LINEAGE.gateway_cumulative_sha256&&parent===BACKEND_LINEAGE.declared_parent_sha256;
    return {verified,status:verified?'GATEWAY_LINEAGE_HASH_MATCH_PARENT_IDENTITY_STILL_UNRESOLVED':'PARTIAL_BACKEND_LINEAGE_PROOF',product:product||null,gateway_cumulative_sha256:cumulative||null,declared_parent_sha256:parent||null,parent_identity_status:BACKEND_LINEAGE.parent_identity_status,grants_authority:false};
  }

  function verifyDeploymentLineageProof(proof){
    if(proof==null)return {verified:false,status:'UNVERIFIED_DEPLOYMENT_LINEAGE',reason:'deployment-lineage-proof-not-returned',grants_authority:false};
    if(typeof proof!=='object'||Array.isArray(proof))throw new Error('invalid-deployment-lineage-proof');
    const gateway=clean(proof.titan_code_gateway_cumulative_sha256||proof.gateway_cumulative_sha256,80).toLowerCase();
    const parent=clean(proof.titan_code_gateway_parent_sha256||proof.parent_sha256,80).toLowerCase();
    const codee=clean(proof.codee_canonical_sha256,80).toLowerCase();
    if(gateway&&gateway!==DEPLOYMENT_LINEAGE.titan_code_gateway_cumulative_sha256)throw new Error('deployment-gateway-cumulative-mismatch');
    if(parent&&parent!==DEPLOYMENT_LINEAGE.titan_code_gateway_parent_sha256)throw new Error('deployment-gateway-parent-mismatch');
    if(codee&&codee!==DEPLOYMENT_LINEAGE.codee_canonical_sha256)throw new Error('codee-canonical-mismatch');
    const gatewayVerified=gateway===DEPLOYMENT_LINEAGE.titan_code_gateway_cumulative_sha256&&parent===DEPLOYMENT_LINEAGE.titan_code_gateway_parent_sha256;
    const codeeContextVerified=codee===DEPLOYMENT_LINEAGE.codee_canonical_sha256;
    return {verified:gatewayVerified||codeeContextVerified,status:gatewayVerified&&codeeContextVerified?'DEPLOYMENT_GATEWAY_AND_CODEE_CONTEXT_VERIFIED':gatewayVerified?'TITAN_CODE_GATEWAY_LINEAGE_VERIFIED_CODEE_CONTEXT_UNPROVEN':codeeContextVerified?'CODEE_CONTEXT_VERIFIED_TITAN_CODE_PARENT_UNPROVEN':'PARTIAL_DEPLOYMENT_LINEAGE_PROOF',gateway_lineage_verified:gatewayVerified,codee_context_verified:codeeContextVerified,codee_relationship_status:DEPLOYMENT_LINEAGE.codee_relationship_status,grants_authority:false};
  }

  const PROPOSAL_STATES=Object.freeze(['prepared','submitted','evaluated','approved','rejected','scheduled','executing','verified','completed','failed','reversed']);
  function normalizeProposalLifecycle(input={},expected={}){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('workforce-proposal-lifecycle-required');
    const company_id=clean(input.company_id,128),intent_id=clean(input.intent_id,180),state=clean(input.state,60);
    if(!validCompany(company_id))throw new Error('company_id-required');
    if(expected.company_id&&company_id!==String(expected.company_id))throw new Error('workforce-proposal-company-mismatch');
    if(!intent_id)throw new Error('workforce-proposal-intent-id-required');
    if(!PROPOSAL_STATES.includes(state))throw new Error('workforce-proposal-state-invalid');
    if(input.grants_authority!==false)throw new Error('workforce-proposal-authority-violation');
    return {schema:'titan.workforce.proposal-lifecycle.v1',company_id,intent_id,state,proposal_id:clean(input.proposal_id,180)||null,authority_decision:input.authority_decision||null,approval_refs:cleanList(input.approval_refs),evidence_refs:cleanList(input.evidence_refs),operation_id:clean(input.operation_id,180)||intent_id,idempotency_key:clean(input.idempotency_key,200)||`workforce-proposal:${company_id}:${intent_id}`,trace_id:clean(input.trace_id,160)||null,correlation_id:clean(input.correlation_id,160)||null,causation_id:clean(input.causation_id,160)||null,risk:clean(input.risk,80)||'none',expected_effect:sanitize(input.expected_effect??null),reversibility:clean(input.reversibility,80)||'unknown',compensation_capability:clean(input.compensation_capability,180)||null,grants_authority:false,direct_mutation:false};
  }
  function runtimeMessage(type,payload){return new Promise((resolve,reject)=>{try{chrome.runtime.sendMessage({type,payload},response=>{const err=chrome.runtime.lastError;if(err)return reject(new Error(err.message));if(!response?.ok)return reject(new Error(response?.error||'workforce-runtime-request-failed'));resolve(response);});}catch(error){reject(error);}});}
  async function claimOperation({company_id,operation_id,idempotency_key,operation,phase}){
    return runtimeMessage('TITAN_WORKFORCE_OPERATION_CLAIM',{company_id,operation_id,idempotency_key,operation,phase});
  }
  async function completeOperation({company_id,operation_id,idempotency_key,state,phase,delivery_status,receipt,result,error,failure_category,failure_class,retry_disposition,retry_count,next_retry_at,requires_review}){
    return runtimeMessage('TITAN_WORKFORCE_OPERATION_COMPLETE',{company_id,operation_id,idempotency_key,state,phase,delivery_status,receipt:sanitize(receipt??null),result:sanitize(result??null),error:error?String(error).slice(0,1000):null,failure_category:clean(failure_category,80)||null,failure_class:clean(failure_class,80)||null,retry_disposition:clean(retry_disposition,80)||null,retry_count:Number(retry_count||0),next_retry_at:Number.isFinite(Number(next_retry_at))?Number(next_retry_at):null,requires_review:requires_review===true});
  }
  async function evaluateRetry(input={}){return runtimeMessage('TITAN_WORKFORCE_RETRY_EVALUATE',input);}
  const waitFor=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(60000,Number(ms)||0))));
  function normalizeAuthorityEvaluationInput(input={},company_id,actor_id){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('workforce-authority-context-required');
    const capability=clean(input.capability||input.requirement?.capability,180);
    if(!capability)throw new Error('workforce-authority-capability-required');
    const workerInput=input.worker&&typeof input.worker==='object'?input.worker:{};
    const requirementInput=input.requirement&&typeof input.requirement==='object'?input.requirement:{};
    const worker_id=clean(workerInput.worker_id||workerInput.actor_id||actor_id,180);
    if(!worker_id)throw new Error('workforce-authority-worker-required');
    return {
      company_id,operation_id:clean(input.operation_id,180)||null,action_id:clean(input.action_id,180)||null,
      worker:{company_id,worker_id,worker_type:clean(workerInput.worker_type,120)||'advanced-intelligence-worker',surface:clean(workerInput.surface,80)||'zero',identity_confers_authority:false},
      requirement:{...requirementInput,company_id,capability,variant:clean(requirementInput.variant||input.variant,120)||null,workflow:clean(requirementInput.workflow||input.workflow,160)||null,context_ref:clean(requirementInput.context_ref||input.context_ref,180)||null,operation:clean(requirementInput.operation||input.operation,120)||'execute',effect:clean(requirementInput.effect||input.effect,80)||'read',required_permissions:cleanList(requirementInput.required_permissions||input.required_permissions),required_entitlements:cleanList(requirementInput.required_entitlements||input.required_entitlements),required_evidence:cleanList(requirementInput.required_evidence||input.required_evidence),minimum_autonomy_score:Number(requirementInput.minimum_autonomy_score??input.minimum_autonomy_score??0),approval_policy:clean(requirementInput.approval_policy||input.approval_policy,160)||null,reversibility:clean(requirementInput.reversibility||input.reversibility,80)||'unknown',identity_confers_authority:false},
      permissions:cleanList(input.permissions),entitlements:cleanList(input.entitlements),policy_allows:input.policy_allows===true,governance_allows:input.governance_allows===true,assurance_allows:input.assurance_allows===true,
      risk:clean(input.risk,80)||'none',evidence:sanitize(input.evidence||{}),approval:sanitize(input.approval||{company_id,status:'not_required'}),autonomy_snapshot:sanitize(input.autonomy_snapshot||null),connectivity:clean(input.connectivity,40)||connectivityState(),
      predictive_phase:clean(input.predictive_phase,40)||null,local_safety_cap:input.local_safety_cap??null,previous_effective_score:input.previous_effective_score??null,previous_snapshot_id:clean(input.previous_snapshot_id,180)||null,max_snapshot_age_ms:input.max_snapshot_age_ms??null,
      identity_confers_authority:false,role_confers_authority:false,activation_confers_authority:false,model_choice_confers_authority:false,grants_authority:false
    };
  }
  async function evaluateProposalAuthority(input={}){
    const company_id=await companyId();const config=await getConfig();
    const context=normalizeAuthorityEvaluationInput(input,company_id,config.actor_id);
    const response=await runtimeMessage('TITAN_WORKFORCE_AUTHORITY_EVALUATE',context);
    const decision=response.authorityDecision;
    if(!decision||decision.company_id!==company_id)throw new Error('workforce-authority-decision-invalid');
    void observeWorkforce(decision.decision==='ALLOW'?'info':'warn','authority-evaluated',{company_id,operation_id:context.operation_id,action_id:context.action_id,decision:decision.decision,risk:context.risk,connectivity:context.connectivity});
    return {authority_decision:decision,company_id,grants_authority:false};
  }
  async function prepareApprovedCommand(lifecycleInput={}){
    let lifecycle=normalizeProposalLifecycle(lifecycleInput,{company_id:await companyId()});
    if(!['approved','scheduled','executing'].includes(lifecycle.state))throw new Error('workforce-proposal-not-approved-for-command');
    if(!lifecycle.authority_decision&&lifecycleInput.authority_context){
      const evaluated=await evaluateProposalAuthority({...lifecycleInput.authority_context,operation_id:lifecycle.operation_id,action_id:lifecycleInput.action_id||lifecycle.intent_id,capability:lifecycleInput.capability||lifecycleInput.action||'titan.workforce.control',risk:lifecycle.risk,evidence:{...(lifecycleInput.authority_context.evidence||{}),refs:lifecycle.evidence_refs},approval:lifecycleInput.authority_context.approval||{company_id:lifecycle.company_id,status:lifecycle.approval_refs.length?'approved':'not_required'}});
      lifecycle={...lifecycle,authority_decision:evaluated.authority_decision};
    }
    if(connectivityState()!=='online')throw new Error('workforce-protected-command-offline-contraction');
    if(!lifecycle.authority_decision)throw new Error('workforce-authority-decision-required');
    if(lifecycle.authority_decision.decision!=='ALLOW')throw new Error(`workforce-authority-not-allowed:${lifecycle.authority_decision.decision||'unknown'}`);
    const config=await getConfig();
    const action_id=clean(lifecycleInput.action_id||lifecycle.intent_id,180);
    const capability=clean(lifecycleInput.capability||lifecycleInput.action||'titan.workforce.control',180);
    const commandOperationId=`command:${lifecycle.operation_id}`;
    const commandIdempotencyKey=`command:${lifecycle.idempotency_key}`;
    const claim=await claimOperation({company_id:lifecycle.company_id,operation_id:commandOperationId,idempotency_key:commandIdempotencyKey,operation:capability,phase:'command-prepare'});
    if(claim.duplicate){
      if(claim.record?.state==='command_prepared'&&claim.record?.result?.command)return {lifecycle,command:claim.record.result.command,duplicate:true,suppressed:true,operation_ledger:claim.record,grants_authority:false};
      throw new Error(`workforce-command-duplicate-suppressed:${claim.record?.state||'unknown'}`);
    }
    try{
      const response=await runtimeMessage('TITAN_WORKFORCE_COMMAND_PREPARE',{company_id:lifecycle.company_id,actor_id:config.actor_id,action_id,capability,variant:clean(lifecycleInput.variant,120)||null,operation_id:lifecycle.operation_id,idempotency_key:lifecycle.idempotency_key,authority_decision:lifecycle.authority_decision,approval_refs:lifecycle.approval_refs,evidence_refs:lifecycle.evidence_refs,trace_id:lifecycle.trace_id,correlation_id:lifecycle.correlation_id,causation_id:lifecycle.causation_id,risk:lifecycle.risk,expected_effect:lifecycle.expected_effect,reversibility:lifecycle.reversibility,compensation_capability:lifecycle.compensation_capability});
      const completed=await completeOperation({company_id:lifecycle.company_id,operation_id:commandOperationId,idempotency_key:commandIdempotencyKey,state:'command_prepared',phase:'command-prepare',delivery_status:'local-prepared',result:{command:response.command}});
      return {lifecycle,command:response.command,duplicate:false,operation_ledger:completed.record,grants_authority:false};
    }catch(error){
      await completeOperation({company_id:lifecycle.company_id,operation_id:commandOperationId,idempotency_key:commandIdempotencyKey,state:'failed',phase:'command-prepare',delivery_status:'local-failed',error:String(error?.message||error)}).catch(()=>null);
      throw error;
    }
  }
  async function verifyGovernedExecution({receipt,verification,expected={},verification_required=false}={}){
    const company_id=await companyId();
    const response=await runtimeMessage('TITAN_WORKFORCE_RECEIPT_VERIFY',{receipt,verification,expected:{...expected,company_id},verification_required});
    return {verified:response.verified===true,company_id,grants_authority:false};
  }

  const PROJECTION_COMPONENTS=Object.freeze({
    workforce_profile:'client.workforce.status',
    roster:'client.workforce.roster',
    assignments:'client.workforce.assignments',
    approval_waits:'client.workforce.approvals',
    escalations:'client.workforce.escalations',
    handover:'client.workforce.handover.get',
    change_requests:'client.workforce.change_request.list'
  });
  function normalizeProjectionRevision(value){
    if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:null;
  }
  function projectionMeta(result,operation){
    const projection=result?.projection&&typeof result.projection==='object'?result.projection:{};
    const data=result?.data&&typeof result.data==='object'&&!Array.isArray(result.data)?result.data:{};
    const revision=normalizeProjectionRevision(projection.projection_revision??projection.revision??data.projection_revision??data.revision??result?.receipt?.projection_revision);
    const cursor=clean(projection.projection_cursor??projection.cursor??data.projection_cursor??data.cursor??result?.receipt?.projection_cursor,240)||null;
    return {operation,revision,cursor,versioned:revision!==null||cursor!==null,grants_authority:false};
  }
  async function nextProjectionSyncGeneration(company_id){
    const started_at_ms=Date.now();
    const d=await chrome.storage.local.get([PROJECTION_CURSOR_KEY]);
    const root=d[PROJECTION_CURSOR_KEY]&&typeof d[PROJECTION_CURSOR_KEY]==='object'?d[PROJECTION_CURSOR_KEY]:{};
    const previous=Number(root[company_id]?.generation||0);
    const generation=Math.max(previous+1,started_at_ms);
    root[company_id]={generation,started_at_ms,updated_at:new Date().toISOString(),grants_authority:false};
    await chrome.storage.local.set({[PROJECTION_CURSOR_KEY]:root});
    return {generation,started_at_ms};
  }
  async function getBackendLineage(){
    const url=chrome.runtime?.getURL?.('titan-workforce/gateway/backend-lineage.json');
    if(!url)return {...BACKEND_LINEAGE};
    try{const response=await fetch(url,{cache:'no-store'});if(!response?.ok)return {...BACKEND_LINEAGE};const body=await response.json();return body?.schema==='titan.workforce.gateway.backend-lineage.v1'?sanitize(body):{...BACKEND_LINEAGE};}catch{return {...BACKEND_LINEAGE};}
  }
  const clampPollMs=value=>Math.min(REALTIME_MAX_POLL_MS,Math.max(REALTIME_MIN_POLL_MS,Number.isFinite(Number(value))?Number(value):REALTIME_DEFAULT_POLL_MS));
  let volatileToken='';
  function endpointTrust(endpoint){const raw=String(endpoint||'').trim(),testHarness=!chrome.runtime?.id;if(!raw)return {configured:false,trusted:false,reason:'endpoint-required'};if(/^[a-z]+:\/\/[^/]*@/i.test(raw))return {configured:true,trusted:false,reason:'url-credentials-forbidden'};if(raw.includes('#'))return {configured:true,trusted:false,reason:'url-fragment-forbidden'};if(/your-titan-app|example\.com|placeholder/i.test(raw)||(/example\.test/i.test(raw)&&!testHarness))return {configured:true,trusted:false,reason:'placeholder-endpoint-forbidden'};const m=raw.match(/^(https?):\/\/([^/:?#]+)(?::\d+)?(?:[/?]|$)/i);if(!m)return {configured:true,trusted:false,reason:'endpoint-invalid'};const protocol=m[1].toLowerCase(),h=m[2].toLowerCase(),local=h==='localhost'||h==='127.0.0.1'||h==='::1'||h.endsWith('.local');if(protocol!=='https'&&!(local&&protocol==='http'))return {configured:true,trusted:false,reason:'https-required'};return {configured:true,trusted:true,reason:null,endpoint:raw,local_dev:local&&protocol==='http',test_fixture:testHarness&&/\.test(?:[:/]|$)/i.test(raw)};}
  async function bodySha256(value){try{if(!globalThis.crypto?.subtle)return null;const bytes=new TextEncoder().encode(JSON.stringify(value));const out=await globalThis.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(out)].map(x=>x.toString(16).padStart(2,'0')).join('');}catch{return null;}}
  async function prepareGatewaySecurityEnvelope(input={}){if(!chrome.runtime?.id){const now=Date.now(),nonce=globalThis.crypto?.randomUUID?.()||`test-${now}-${Math.random()}`;return {schema:'titan.workforce.security-envelope.v1',company_id:input.company_id,operation:input.operation,request_id:input.request_id,idempotency_key:input.idempotency_key,nonce,issued_at:now,expires_at:now+120000,request_digest:`test:${input.request_id}:${nonce}`,body_hash:input.body_hash||null,privileged:false,grants_authority:false};}const response=await runtimeMessage('TITAN_WORKFORCE_SECURITY_ENVELOPE_PREPARE',input);return response.envelope;}
  async function sessionToken(){try{if(chrome.storage?.session){const d=await chrome.storage.session.get(['titanClientWorkforceGatewaySessionSecretV1']);return String(d.titanClientWorkforceGatewaySessionSecretV1||'').trim();}}catch(_){ }return volatileToken;}
  async function getConfig(){const d=await chrome.storage.local.get([CONFIG_KEY]);const c=d[CONFIG_KEY]||{};const legacy=String(c.token||'').trim();const token=(await sessionToken())||legacy;return {enabled:c.enabled!==false,endpoint:String(c.endpoint||'').trim(),realtime_endpoint:String(c.realtime_endpoint||'').trim(),poll_interval_ms:clampPollMs(c.poll_interval_ms),token,actor_id:clean(c.actor_id||'authenticated',160),secret_persisted_locally:Boolean(legacy)};}
  async function saveConfig(next={}){const current=await getConfig();const token=String(next.token??current.token??'').trim();volatileToken=token;try{if(chrome.storage?.session)await chrome.storage.session.set({titanClientWorkforceGatewaySessionSecretV1:token});}catch(_){ }const merged={enabled:next.enabled!==false,endpoint:String(next.endpoint??current.endpoint??'').trim(),realtime_endpoint:String(next.realtime_endpoint??current.realtime_endpoint??'').trim(),poll_interval_ms:clampPollMs(next.poll_interval_ms??current.poll_interval_ms),token:'',actor_id:clean(next.actor_id??current.actor_id,160)};await chrome.storage.local.set({[CONFIG_KEY]:merged});return publicConfig({...merged,token});}
  async function companyId(){const d=await chrome.storage.local.get(['titanBusinessProfile']);const id=String(d.titanBusinessProfile?.company_id||'').trim();if(!validCompany(id))throw new Error('company_id-required');return id;}
  async function recordReceipt(receipt){const d=await chrome.storage.local.get([RECEIPT_KEY]);const all=Array.isArray(d[RECEIPT_KEY])?d[RECEIPT_KEY]:[];const company_id=await companyId();const keep=all.filter(x=>x?.company_id!==company_id);const mine=[...all.filter(x=>x?.company_id===company_id),receipt].slice(-200);await chrome.storage.local.set({[RECEIPT_KEY]:[...keep,...mine]});return receipt;}
  async function receipts(){const d=await chrome.storage.local.get([RECEIPT_KEY]);const id=await companyId();return (Array.isArray(d[RECEIPT_KEY])?d[RECEIPT_KEY]:[]).filter(x=>x?.company_id===id).slice(-200);}
  async function send(operation,payload={}){
    const config=await getConfig(),company_id=await companyId();if(!config.enabled)throw new Error('workforce-gateway-disabled');if(!validActor(config.actor_id))throw new Error('actor_id-required');
    if(connectivityState()!=='online'){
      if(READ.has(operation)){const cached=await readCache(operation);if(cached)return {request:null,receipt:null,projection:cached.projection||null,data:cached.data??cached.projection??null,backend_lineage:{verified:false,status:'OFFLINE_CACHED_READ'},deployment_lineage:{verified:false,status:'OFFLINE_CACHED_READ'},auth_binding:{verified:false,status:'OFFLINE_CACHED_READ_UNVERIFIED_AUTH',grants_authority:false},offline:true,cached:true,grants_authority:false};throw new Error('workforce-offline-cache-miss');}
      throw new Error('workforce-offline-proposal-send-denied');
    }
    if(!config.endpoint)throw new Error('workforce-gateway-endpoint-required');const endpointSecurity=endpointTrust(config.endpoint);if(!endpointSecurity.trusted)throw new Error(`workforce-gateway-untrusted-endpoint:${endpointSecurity.reason}`);
    const intent=payload?.intent&&typeof payload.intent==='object'?payload.intent:null;
    const stableOperationId=clean(payload?.operation_id||intent?.operation_id||intent?.intent_id,180)||undefined;
    const stableIdempotencyKey=clean(payload?.idempotency_key||intent?.idempotency_key||(intent?.intent_id?`workforce-control:${intent.intent_id}`:''),200)||undefined;
    const request=createRequest({company_id,actor_id:config.actor_id,operation,payload,operation_id:stableOperationId,idempotency_key:stableIdempotencyKey});
    const requestBodyHash=await bodySha256(request);const securityEnvelope=await prepareGatewaySecurityEnvelope({company_id,operation,request_id:request.request_id,idempotency_key:request.idempotency_key,privileged:false,body_hash:requestBodyHash});if(!securityEnvelope?.request_digest)throw new Error('workforce-security-envelope-required');
    void observeWorkforce('info','gateway-request-prepared',{company_id,operation,operation_id:request.operation_id,request_id:request.request_id,trace_id:request.trace_id,correlation_id:request.correlation_id});
    let claim=null;
    if(PROPOSE.has(operation)){
      claim=await claimOperation({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,operation,phase:'gateway-proposal'});
      if(claim.duplicate){
        void observeWorkforce('info','gateway-duplicate-suppressed',{company_id,operation,operation_id:request.operation_id,request_id:request.request_id,trace_id:request.trace_id,correlation_id:request.correlation_id});
        if(claim.record?.receipt)return {request,receipt:claim.record.receipt,projection:null,data:claim.record.result??null,duplicate:true,suppressed:true,operation_ledger:claim.record,backend_lineage:{verified:false,status:'DUPLICATE_SUPPRESSED'},deployment_lineage:{verified:false,status:'DUPLICATE_SUPPRESSED'},auth_binding:{verified:false,status:'DUPLICATE_SUPPRESSED',grants_authority:false},offline:false,cached:false,grants_authority:false};
        throw new Error(`workforce-operation-duplicate-suppressed:${claim.record?.state||'unknown'}`);
      }
    }
    const headers={'Content-Type':'application/json','Accept':'application/json','X-Request-Id':request.request_id,'X-Idempotency-Key':request.idempotency_key,'X-Titan-Nonce':securityEnvelope.nonce,'X-Titan-Issued-At':String(securityEnvelope.issued_at),'X-Titan-Request-Digest':securityEnvelope.request_digest};if(config.token)headers.Authorization=`Bearer ${config.token}`;
    const readOnly=READ.has(operation);let response=null,body={},retryCount=0;
    while(true){
      try{response=await fetch(config.endpoint,{method:'POST',headers,body:JSON.stringify(request),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}catch(error){
        const retry=await evaluateRetry({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,operation_kind:readOnly?'read':'proposal',phase:'after_dispatch',dispatch_proven:readOnly?false:null,error_code:'network_error',error:String(error?.message||error),retry_count:retryCount,max_retries:3}).catch(()=>null);
        const decision=retry?.decision||{};const classification=retry?.classification||{};
        void observeWorkforce('error','gateway-failure-classified',{company_id,operation,operation_id:request.operation_id,request_id:request.request_id,trace_id:request.trace_id,correlation_id:request.correlation_id,error:String(error?.message||error),failure_category:classification.category,failure_class:classification.failure_class,retry_disposition:decision.disposition,retry_count:decision.retry_count,requires_review:decision.requires_review});
        if(readOnly&&decision.retry_allowed===true){retryCount=Number(decision.retry_count||retryCount+1);await waitFor(Math.max(0,Number(decision.next_retry_at||0)-Date.now()));continue;}
        if(claim)await completeOperation({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,state:'delivery_unknown',phase:'gateway-proposal',delivery_status:'unknown',error:String(error?.message||error),failure_category:classification.category,failure_class:classification.failure_class,retry_disposition:decision.disposition,retry_count:decision.retry_count,next_retry_at:decision.next_retry_at,requires_review:decision.requires_review}).catch(()=>null);
        throw new Error(`workforce-gateway-network:${String(error?.message||error)}`);
      }
      const text=await response.text();body={};
      if(text){try{body=JSON.parse(text);}catch{
        const retry=await evaluateRetry({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,operation_kind:readOnly?'read':'proposal',phase:'response_received',dispatch_proven:readOnly?false:true,error_code:'invalid_response',http_status:response.status,retry_count:retryCount,max_retries:3}).catch(()=>null);
        const decision=retry?.decision||{};const classification=retry?.classification||{};
        if(claim)await completeOperation({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,state:'delivery_unknown',phase:'gateway-proposal',delivery_status:'response-invalid',error:'workforce-gateway-invalid-json',failure_category:classification.category,failure_class:classification.failure_class,retry_disposition:decision.disposition,retry_count:decision.retry_count,next_retry_at:decision.next_retry_at,requires_review:true}).catch(()=>null);
        throw new Error('workforce-gateway-invalid-json');
      }}
      if(!response.ok||body?.ok===false){
        const errorText=String(body?.error||body?.reason||`workforce-gateway-http-${response.status}`).slice(0,1000);
        const retry=await evaluateRetry({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,operation_kind:readOnly?'read':'proposal',phase:'response_received',dispatch_proven:readOnly?false:true,http_status:response.status,error:errorText,retry_count:retryCount,max_retries:3}).catch(()=>null);
        const decision=retry?.decision||{};const classification=retry?.classification||{};
        void observeWorkforce(decision.requires_review?'error':'warn','gateway-failure-classified',{company_id,operation,operation_id:request.operation_id,request_id:request.request_id,trace_id:request.trace_id,correlation_id:request.correlation_id,http_status:response.status,error:errorText,failure_category:classification.category,failure_class:classification.failure_class,retry_disposition:decision.disposition,retry_count:decision.retry_count,requires_review:decision.requires_review});
        if(readOnly&&decision.retry_allowed===true){retryCount=Number(decision.retry_count||retryCount+1);await waitFor(Math.max(0,Number(decision.next_retry_at||0)-Date.now()));continue;}
        if(claim){const ambiguous=classification.failure_class==='unknown_effect_outcome'||classification.failure_class==='timeout_after_dispatch'||classification.failure_class==='provider_response_lost'||classification.failure_class==='effect_status_unknown';await completeOperation({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,state:ambiguous?'delivery_unknown':'gateway_rejected',phase:'gateway-proposal',delivery_status:ambiguous?'unknown':'rejected',result:body,error:errorText,failure_category:classification.category,failure_class:classification.failure_class,retry_disposition:decision.disposition,retry_count:decision.retry_count,next_retry_at:decision.next_retry_at,requires_review:decision.requires_review}).catch(()=>null);}
        throw new Error(errorText);
      }
      break;
    }
    const backend_lineage=verifyBackendLineageProof(body.backend_lineage??null);const deployment_lineage=verifyDeploymentLineageProof(body.deployment_lineage??null);const {receipt,projection,auth_binding}=verifyContractResponse(body,request,company_id);
    await recordReceipt({...receipt,backend_lineage_status:backend_lineage.status,deployment_lineage_status:deployment_lineage.status,auth_binding_status:auth_binding.status});
    let operationLedger=claim?.record||null;
    if(claim){const completed=await completeOperation({company_id,operation_id:request.operation_id,idempotency_key:request.idempotency_key,state:'receipt_verified',phase:'gateway-proposal',delivery_status:'receipt-verified',receipt,result:body.data??projection?.data??projection??null});operationLedger=completed.record;}
    const result={request,receipt,projection,data:body.data??projection?.data??projection??null,backend_lineage,deployment_lineage,auth_binding,operation_ledger:operationLedger,duplicate:false,offline:false,cached:false,retry_count:retryCount,grants_authority:false};
    void observeWorkforce('info','gateway-receipt-verified',{company_id,operation,operation_id:request.operation_id,request_id:request.request_id,trace_id:request.trace_id,correlation_id:request.correlation_id,receipt_id:receipt.receipt_id||receipt.id||null,retry_count:retryCount,backend_lineage_status:backend_lineage.status,deployment_lineage_status:deployment_lineage.status,auth_binding_status:auth_binding.status});
    await writeCache(operation,result);return result;
  }
  async function createMissionTeam(input={}){
    const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('mission-team-workforce-graph-required');
    const response=await runtimeMessage('TITAN_WORKFORCE_MISSION_TEAM_CREATE',{...input,company_id,graph,grants_authority:false});
    if(response.record?.company_id!==company_id||response.grants_authority!==false)throw new Error('invalid-mission-team-create-response');return response;
  }
  async function transitionMissionTeam(input={}){
    const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_MISSION_TEAM_TRANSITION',{...input,company_id,grants_authority:false});
    if(response.record?.company_id!==company_id||response.grants_authority!==false)throw new Error('invalid-mission-team-transition-response');return response;
  }
  async function getMissionTeam(mission_team_id){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_MISSION_TEAM_GET',{company_id,mission_team_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-mission-team-response');return response.record||null;}
  async function listMissionTeams(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_MISSION_TEAM_LIST',{company_id,grants_authority:false});return Array.isArray(response.records)?response.records.filter(x=>x?.company_id===company_id):[];}

  async function upsertSupervisorCoordination(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('supervision-workforce-graph-required');const response=await runtimeMessage('TITAN_WORKFORCE_SUPERVISION_UPSERT',{...input,company_id,graph,grants_authority:false});if(response.record?.company_id!==company_id||response.grants_authority!==false)throw new Error('invalid-supervision-upsert-response');return response;}
  async function getSupervisorCoordination(supervisor_worker_id){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_SUPERVISION_GET',{company_id,supervisor_worker_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-supervision-response');return response.record||null;}
  async function listSupervisorCoordination(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_SUPERVISION_LIST',{company_id,grants_authority:false});return Array.isArray(response.records)?response.records.filter(x=>x?.company_id===company_id):[];}
  async function acknowledgeSupervisorEscalation(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_SUPERVISION_ESCALATION_ACK',{...input,company_id,grants_authority:false});if(response.record?.company_id!==company_id)throw new Error('cross-company-supervision-ack-response');return response;}
  async function prepareSupervisorHandover(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('supervision-workforce-graph-required');const response=await runtimeMessage('TITAN_WORKFORCE_SUPERVISION_HANDOVER_PREPARE',{...input,company_id,graph,grants_authority:false});if(response.record?.company_id!==company_id)throw new Error('cross-company-supervision-handover-response');return response;}

  async function buildChiefOfStaffCoordination(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('chief-of-staff-workforce-graph-required');const response=await runtimeMessage('TITAN_WORKFORCE_CHIEF_OF_STAFF_BUILD',{...input,company_id,graph,grants_authority:false});if(response.record?.company_id!==company_id||response.grants_authority!==false)throw new Error('invalid-chief-of-staff-response');return response;}
  async function getChiefOfStaffCoordination(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_CHIEF_OF_STAFF_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-chief-of-staff-response');return response.record||null;}

  async function saveDecisionRightsPolicy(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_DECISION_RIGHTS_SAVE',{...input,company_id,grants_authority:false});if(response.policy?.company_id!==company_id||response.execution_permitted!==false)throw new Error('invalid-decision-rights-save-response');return response.policy;}
  async function getDecisionRightsPolicy(policy_id='workforce-default'){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_DECISION_RIGHTS_GET',{company_id,policy_id,grants_authority:false});if(response.policy&&response.policy.company_id!==company_id)throw new Error('cross-company-decision-rights-response');return response.policy||null;}
  async function evaluateDecisionRight(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('decision-rights-workforce-graph-required');const response=await runtimeMessage('TITAN_WORKFORCE_DECISION_RIGHTS_EVALUATE',{...input,company_id,graph,grants_authority:false});if(response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('decision-rights-authority-boundary-invalid');return response.evaluation;}

  async function buildSkillCapabilityRegistry(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('skill-capability-workforce-graph-required');const projection=input.projection||{};const response=await runtimeMessage('TITAN_WORKFORCE_SKILL_CAPABILITY_BUILD',{...input,company_id,graph,projection:{...sanitize(projection),company_id},grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-skill-capability-response');return response;}
  async function getSkillCapabilityRegistry(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_SKILL_CAPABILITY_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-skill-capability-response');return response.record||null;}

  async function buildWorkloadCapacity(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('workload-capacity-workforce-graph-required');const projection=input.projection||{};const response=await runtimeMessage('TITAN_WORKFORCE_CAPACITY_BUILD',{...input,company_id,graph,projection:{...sanitize(projection),company_id},grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-workload-capacity-response');return response;}
  async function getWorkloadCapacity(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_CAPACITY_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-workload-capacity-response');return response.record||null;}
  async function buildPerformanceOutcomes(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('performance-workforce-graph-required');const projection=input.projection||{};const response=await runtimeMessage('TITAN_WORKFORCE_PERFORMANCE_BUILD',{...input,company_id,graph,projection:{...sanitize(projection),company_id},grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-performance-response');return response;}
  async function getPerformanceOutcomes(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_PERFORMANCE_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-performance-response');return response.record||null;}
  async function buildDynamicStaffing(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('dynamic-staffing-workforce-graph-required');const projection=input.projection||{};const response=await runtimeMessage('TITAN_WORKFORCE_DYNAMIC_STAFFING_BUILD',{...input,company_id,graph,projection:{...sanitize(projection),company_id},grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-dynamic-staffing-response');return response;}
  async function getDynamicStaffing(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_DYNAMIC_STAFFING_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-dynamic-staffing-response');return response.record||null;}
  async function buildImprovementProposals(input={}){const company_id=await companyId();const graph=input.graph||input.workforce_graph;if(!graph)throw new Error('improvement-workforce-graph-required');const response=await runtimeMessage('TITAN_WORKFORCE_IMPROVEMENT_BUILD',{...input,company_id,graph,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-improvement-proposal-response');return response;}
  async function getImprovementProposals(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_IMPROVEMENT_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-improvement-proposal-response');return response.record||null;}
  async function buildInvestigationInstallationHandover(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_INVESTIGATION_INSTALLATION_HANDOVER_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-investigation-installation-handover-response');return response;}
  async function getInvestigationInstallationHandover(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_INVESTIGATION_INSTALLATION_HANDOVER_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-investigation-installation-handover-response');return response.record||null;}
  async function buildBusinessDiscoverySpecification(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_BUSINESS_DISCOVERY_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-business-discovery-response');return response;}
  async function getBusinessDiscoverySpecification(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_BUSINESS_DISCOVERY_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-business-discovery-response');return response.record||null;}
  async function buildInstallationPlan(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_INSTALLATION_PLAN_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-installation-plan-response');return response;}
  async function getInstallationPlan(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_INSTALLATION_PLAN_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-installation-plan-response');return response.record||null;}
  async function buildCommissioningGates(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_COMMISSIONING_GATES_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-commissioning-gates-response');return response;}
  async function getCommissioningGates(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_COMMISSIONING_GATES_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-commissioning-gates-response');return response.record||null;}
  async function buildLiveLaravelHostCertification(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_LIVE_HOST_CERTIFICATION_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-live-host-certification-response');return response;}
  async function getLiveLaravelHostCertification(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_LIVE_HOST_CERTIFICATION_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-live-host-certification-response');return response.record||null;}
  async function buildWorkforceBrowserLiveSmokeCertification(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_BROWSER_LIVE_SMOKE_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-browser-live-smoke-response');return response;}
  async function getWorkforceBrowserLiveSmokeCertification(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_BROWSER_LIVE_SMOKE_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-browser-live-smoke-response');return response.record||null;}
  async function buildCrossVersionCompatibility(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_CROSS_VERSION_COMPATIBILITY_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-cross-version-compatibility-response');return response;}
  async function getCrossVersionCompatibility(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_CROSS_VERSION_COMPATIBILITY_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-cross-version-compatibility-response');return response.record||null;}
  async function buildMigrationUpgradeSafety(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_MIGRATION_UPGRADE_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-migration-upgrade-response');return response;}
  async function getMigrationUpgradeSafety(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_MIGRATION_UPGRADE_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-migration-upgrade-response');return response.record||null;}
  async function transitionMigrationUpgradeSafety(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_MIGRATION_UPGRADE_TRANSITION',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-migration-upgrade-transition-response');return response;}
  async function executeRegisteredWorkforceMigrations(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_MIGRATION_UPGRADE_EXECUTE_REGISTERED',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-migration-upgrade-execution-response');return response;}
  async function probeLiveLaravelHostCertification(input={}){
    const company_id=await companyId(),config=await getConfig();let commissioning=input.commissioning_gates||input.commissioning||null;
    if(!commissioning&&input.commissioning_gate_set_id)commissioning=await getCommissioningGates({commissioning_gate_set_id:input.commissioning_gate_set_id}).catch(()=>null);
    if(!commissioning)throw new Error('live-host-certification-commissioning-required');
    const probes=Array.isArray(input.probes)?input.probes.map(x=>sanitize(x)):[];const byId=new Map(probes.map(x=>[x?.probe_id,x]));
    if(config.endpoint&&connectivityState()==='online'){
      try{const observed=await send('client.workforce.status',{});const now=Date.now();const receipt=observed?.receipt||{};const auth=observed?.auth_binding||{};const request=observed?.request||{};
        byId.set('host-reachability',{company_id,probe_id:'host-reachability',state:'PASSED',evidence_refs:[clean(receipt.receipt_id||receipt.id||request.request_id,240)||`request:${request.request_id||now}`],verifier_ref:'titan-zero-safe-live-read-probe',observed_at:now,live_observed:true,synthetic:false,details:{http_reached:true,request_id:request.request_id||null}});
        byId.set('authenticated-company-binding',{company_id,probe_id:'authenticated-company-binding',state:auth.verified===true&&auth.authorized_company_id===company_id?'PASSED':'FAILED',evidence_refs:[clean(receipt.receipt_id||receipt.id||request.request_id,240)||`request:${request.request_id||now}`],verifier_ref:'titan-zero-safe-live-read-probe',observed_at:now,live_observed:true,synthetic:false,details:{authorized_company_id:auth.authorized_company_id||null,authenticated_actor_id:auth.authenticated_actor_id||null,verified:auth.verified===true}});
        if(receipt.authoritative===true&&(receipt.receipt_id||receipt.id))byId.set('authoritative-receipt',{company_id,probe_id:'authoritative-receipt',state:'PASSED',evidence_refs:[`receipt:${receipt.receipt_id||receipt.id}`],verifier_ref:'titan-zero-safe-live-read-probe',observed_at:now,live_observed:true,synthetic:false,details:{authoritative:true,receipt_id:receipt.receipt_id||receipt.id}});
      }catch(error){const now=Date.now();byId.set('host-reachability',{company_id,probe_id:'host-reachability',state:'FAILED',evidence_refs:[`live-read-failure:${now}`],verifier_ref:'titan-zero-safe-live-read-probe',observed_at:now,live_observed:true,synthetic:false,details:{error:String(error?.message||error).slice(0,500)}});}
    }
    return buildLiveLaravelHostCertification({commissioning_gates:commissioning,endpoint:config.endpoint,probes:[...byId.values()],host:{endpoint:config.endpoint}});
  }


  async function buildWorkforceEndToEndCertification(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_E2E_CERTIFICATION_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-workforce-e2e-certification-response');return response;}
  async function getWorkforceEndToEndCertification(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_E2E_CERTIFICATION_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-workforce-e2e-certification-response');return response.record||null;}
  async function buildUninstallReversibility(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_UNINSTALL_REVERSIBILITY_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-uninstall-reversibility-response');return response;}
  async function getUninstallReversibility(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_UNINSTALL_REVERSIBILITY_GET',{...sanitize(input),company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-uninstall-reversibility-response');return response.record||null;}
  async function transitionUninstallReversibility(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_UNINSTALL_REVERSIBILITY_TRANSITION',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-uninstall-reversibility-transition-response');return response;}

  async function buildWorkforceSecurityPosture(input={}){const company_id=await companyId(),config=await getConfig();const response=await runtimeMessage('TITAN_WORKFORCE_SECURITY_POSTURE_BUILD',{...sanitize(input),company_id,endpoint:config.endpoint,realtime_endpoint:config.realtime_endpoint,secret_persisted_locally:config.secret_persisted_locally===true,replay_protection_enabled:true,integrity_envelope_enabled:true,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-workforce-security-posture-response');return response;}
  async function getWorkforceSecurityPosture(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_SECURITY_POSTURE_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-workforce-security-posture-response');return response.record||null;}
  async function buildWorkforceSecurityEvidenceChain(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_SECURITY_EVIDENCE_CHAIN',{...sanitize(input),company_id,grants_authority:false});if(response.chain?.company_id!==company_id)throw new Error('cross-company-workforce-security-evidence-response');return response.chain;}
  async function buildWorkforcePrivacyEvidenceControls(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_PRIVACY_EVIDENCE_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-workforce-privacy-evidence-response');return response;}
  async function getWorkforcePrivacyEvidenceControls(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_PRIVACY_EVIDENCE_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-workforce-privacy-evidence-response');return response.record||null;}
  async function evaluateWorkforceEvidenceAccess(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_PRIVACY_EVIDENCE_ACCESS',{...sanitize(input),company_id,grants_authority:false});return response.decision;}
  async function prepareWorkforceEvidenceExport(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_PRIVACY_EVIDENCE_EXPORT',{...sanitize(input),company_id,grants_authority:false});return response.decision;}
  async function prepareWorkforceEvidenceDeletion(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_PRIVACY_EVIDENCE_DELETE',{...sanitize(input),company_id,grants_authority:false});return response.decision;}


  async function buildWorkforceIntelligenceRouting(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_INTELLIGENCE_ROUTING_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-workforce-intelligence-routing-response');return response;}
  async function getWorkforceIntelligenceRouting(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_INTELLIGENCE_ROUTING_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-workforce-intelligence-routing-response');return response.record||null;}
  async function selectWorkforceIntelligenceRoute(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_INTELLIGENCE_ROUTE_SELECT',{...sanitize(input),company_id,grants_authority:false});if(response.selection?.company_id!==company_id)throw new Error('cross-company-workforce-intelligence-selection-response');return response.selection;}
  async function recordWorkforceProviderReceipt(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_PROVIDER_RECEIPT_RECORD',{...sanitize(input),company_id,grants_authority:false});if(response.receipt?.company_id!==company_id)throw new Error('cross-company-workforce-provider-receipt-response');return response.receipt;}


  async function buildWorkforceKnowledgeAuthority(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_KNOWLEDGE_AUTHORITY_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-workforce-knowledge-authority-response');return response;}
  async function getWorkforceKnowledgeAuthority(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_KNOWLEDGE_AUTHORITY_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-workforce-knowledge-authority-response');return response.record||null;}
  async function evaluateWorkforceKnowledgeUse(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_KNOWLEDGE_USE_EVALUATE',{...sanitize(input),company_id,grants_authority:false});if(response.decision?.company_id!==company_id)throw new Error('cross-company-workforce-knowledge-use-response');return response.decision;}
  async function recordWorkforceKnowledgeUseReceipt(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_KNOWLEDGE_USE_RECEIPT_RECORD',{...sanitize(input),company_id,grants_authority:false});if(response.receipt?.company_id!==company_id)throw new Error('cross-company-workforce-knowledge-receipt-response');return response.receipt;}

  async function buildUnifiedWorkforce(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_HUMAN_AI_UNIFICATION_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-human-ai-unification-response');return response;}
  async function getUnifiedWorkforce(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_HUMAN_AI_UNIFICATION_GET',{company_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-human-ai-unification-response');return response.record||null;}
  async function evaluateUnifiedWorkforceAssignment(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_HUMAN_AI_ASSIGNMENT_EVALUATE',{...sanitize(input),company_id,grants_authority:false});if(response.evaluation?.company_id!==company_id)throw new Error('cross-company-human-ai-assignment-evaluation-response');return response.evaluation;}

  async function buildWorkforceWorkerMemory(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_WORKER_MEMORY_BUILD',{...sanitize(input),company_id,grants_authority:false});if(response.record?.company_id!==company_id||response.authority_granted!==false||response.execution_permitted!==false||response.grants_authority!==false)throw new Error('invalid-workforce-worker-memory-response');return response;}
  async function getWorkforceWorkerMemory(worker_id){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_WORKER_MEMORY_GET',{company_id,worker_id,grants_authority:false});if(response.record&&response.record.company_id!==company_id)throw new Error('cross-company-workforce-worker-memory-response');return response.record||null;}
  async function recallWorkforceWorkerMemory(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_WORKER_MEMORY_RECALL',{...sanitize(input),company_id,grants_authority:false});if(response.recall?.company_id!==company_id)throw new Error('cross-company-workforce-worker-memory-recall-response');return response.recall;}
  async function recordWorkforceWorkerMemoryRecallReceipt(input={}){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_WORKER_MEMORY_RECALL_RECEIPT_RECORD',{...sanitize(input),company_id,grants_authority:false});if(response.receipt?.company_id!==company_id)throw new Error('cross-company-workforce-worker-memory-receipt-response');return response.receipt;}

  async function buildWorkforceGraph(projection={}){
    const company_id=clean(projection.company_id,128)||await companyId();
    if(company_id!==await companyId())throw new Error('workforce-graph-cross-company-rejected');
    const response=await runtimeMessage('TITAN_WORKFORCE_GRAPH_BUILD',{projection:{...sanitize(projection),company_id,grants_authority:false}});
    return response.graph;
  }
  async function refreshProjection(){
    const id=await companyId();
    const sync=await nextProjectionSyncGeneration(id);
    const operations=Object.values(PROJECTION_COMPONENTS),results={},errors=[];
    for(const op of operations){try{results[op]=await send(op,{});}catch(error){errors.push({operation:op,error:String(error?.message||error)});}}
    const data=op=>results[op]?.data;
    const component_cursors={};
    for(const [component,op] of Object.entries(PROJECTION_COMPONENTS))component_cursors[component]=projectionMeta(results[op],op);
    const revisions=Object.values(component_cursors).map(x=>x.revision).filter(Number.isSafeInteger);
    const projection_revision=revisions.length?Math.max(...revisions):0;
    const projection={
      schema:'titan.client.workforce.manager-projection.v2',company_id:id,
      projection_revision,projection_cursor:`local-sync:${sync.generation}`,
      sync_generation:sync.generation,sync_started_at_ms:sync.started_at_ms,component_cursors,
      workforce_profile:data('client.workforce.status')&&typeof data('client.workforce.status')==='object'?{company_id:id,...data('client.workforce.status')}:null,
      roster:data('client.workforce.roster')||[],
      assignments:Array.isArray(data('client.workforce.assignments'))?data('client.workforce.assignments'):(data('client.workforce.assignments')?.assignments||[]),
      approval_waits:Array.isArray(data('client.workforce.approvals'))?data('client.workforce.approvals'):(data('client.workforce.approvals')?.approval_waits||[]),
      escalations:Array.isArray(data('client.workforce.escalations'))?data('client.workforce.escalations'):(data('client.workforce.escalations')?.escalations||[]),
      handover:data('client.workforce.handover.get')||null,
      change_requests:data('client.workforce.change_request.list')||[],
      errors,projected_at:new Date().toISOString(),connectivity:connectivityState(),offline:connectivityState()!=='online',grants_authority:false
    };
    try{projection.workforce_graph=await buildWorkforceGraph(projection);}catch(error){errors.push({operation:'workforce.graph.build',error:String(error?.message||error)});projection.workforce_graph=null;}
    void observeWorkforce(errors.length?'warn':'info','projection-refresh',{company_id:id,projection_revision,projection_cursor:projection.projection_cursor,error_count:errors.length,transport:'polling',graph_nodes:projection.workforce_graph?.nodes?.length||0,graph_edges:projection.workforce_graph?.edges?.length||0});
    return projection;
  }
  function normalizeRealtimeProjectionEvent(event,company_id){
    if(!event||typeof event!=='object'||Array.isArray(event))throw new Error('invalid-workforce-realtime-event');
    const schema=clean(event.schema,120);
    if(schema&&schema!=='titan.workforce.gateway.realtime.projection.v1')throw new Error('invalid-workforce-realtime-event-schema');
    const payload=event.projection&&typeof event.projection==='object'?event.projection:event;
    if(String(payload.company_id||event.company_id||'')!==company_id)throw new Error('cross-company-workforce-realtime-event-rejected');
    if((payload.grants_authority??event.grants_authority)!==false)throw new Error('workforce-realtime-event-authority-violation');
    if(payload.target_surface!=null&&payload.target_surface!=='titan_zero')throw new Error('workforce-realtime-event-surface-mismatch');
    const component=clean(event.component||payload.component,80);
    const componentMap={status:'workforce_profile',workforce_profile:'workforce_profile',roster:'roster',assignments:'assignments',approvals:'approval_waits',approval_waits:'approval_waits',escalations:'escalations',handover:'handover',change_requests:'change_requests'};
    if(component){
      const target=componentMap[component];if(!target)throw new Error('invalid-workforce-realtime-component');
      const revision=normalizeProjectionRevision(event.revision??event.projection_revision??payload.revision??payload.projection_revision);
      const cursor=clean(event.cursor??event.projection_cursor??payload.cursor??payload.projection_cursor,240)||null;
      return {schema:'titan.client.workforce.manager-projection.v2',company_id,source:'realtime',partial:true,components:[target],[target]:sanitize(event.data??payload.data??payload[target]??null),component_cursors:{[target]:{operation:`realtime:${component}`,revision,cursor,versioned:revision!==null||Boolean(cursor),grants_authority:false}},projection_revision:revision??0,projection_cursor:cursor,projected_at:clean(event.projected_at||payload.projected_at,80)||new Date().toISOString(),grants_authority:false};
    }
    return {...payload,company_id,source:'realtime',grants_authority:false};
  }

  async function checkpointSyncRecovery(input={}){
    const company_id=clean(input.company_id,128)||await companyId();
    const cursorRaw=await chrome.storage.local.get([PROJECTION_CURSOR_KEY]);const cursorRoot=cursorRaw[PROJECTION_CURSOR_KEY]&&typeof cursorRaw[PROJECTION_CURSOR_KEY]==='object'?cursorRaw[PROJECTION_CURSOR_KEY]:{};const cursorState=cursorRoot[company_id]||{};
    const payload={company_id,mode:input.mode||realtimeController?.mode||'polling',projection_revision:Number(cursorState.projection_revision||0),projection_cursor:cursorState.projection_cursor||null,sync_generation:Number(cursorState.sync_generation||0),sync_started_at_ms:Number(cursorState.sync_started_at_ms||0),poll_interval_ms:Number(input.poll_interval_ms||30000),retry_count:Number(input.retry_count||0),last_event_at:input.last_event_at||realtimeController?.last_event_at||null,last_error:input.last_error||realtimeController?.last_error||null,connectivity:connectivityState(),grants_authority:false};
    const response=await runtimeMessage('TITAN_WORKFORCE_SYNC_RECOVERY_CHECKPOINT',payload);
    void observeWorkforce(input.last_error?'warn':'info','sync-recovery-checkpoint',{company_id,transport:payload.mode,projection_revision:payload.projection_revision,projection_cursor:payload.projection_cursor,retry_count:payload.retry_count,error:payload.last_error||null});
    return response.recovery||null;
  }
  async function getSyncRecovery(){const company_id=await companyId();const response=await runtimeMessage('TITAN_WORKFORCE_SYNC_RECOVERY_GET',{company_id});return response.recovery||null;}
  async function completeSyncRecovery(){const company_id=await companyId();return runtimeMessage('TITAN_WORKFORCE_SYNC_RECOVERY_COMPLETE',{company_id});}

  function stopRealtimeSync(){
    const current=realtimeController;
    realtimeController=null;
    if(current?.poll_timer)clearTimeout(current.poll_timer);
    try{current?.abort_controller?.abort();}catch(_){ }
    return {stopped:Boolean(current),grants_authority:false};
  }
  async function startRealtimeSync({onProjection,onStatus}={}){
    stopRealtimeSync();
    const config=await getConfig(),company_id=await companyId();
    if(!config.enabled||!config.endpoint)return {started:false,mode:'disabled',reason:'gateway-not-configured',company_id,grants_authority:false};const primaryTrust=endpointTrust(config.endpoint);if(!primaryTrust.trusted)return {started:false,mode:'blocked',reason:`untrusted-endpoint:${primaryTrust.reason}`,company_id,grants_authority:false};if(config.realtime_endpoint){const rtTrust=endpointTrust(config.realtime_endpoint);if(!rtTrust.trusted)return {started:false,mode:'blocked',reason:`untrusted-realtime-endpoint:${rtTrust.reason}`,company_id,grants_authority:false};}
    const priorRecovery=await getSyncRecovery().catch(()=>null);
    const controller={company_id,mode:config.realtime_endpoint?'realtime':'polling',stopped:false,poll_timer:null,abort_controller:null,last_event_at:priorRecovery?.last_event_at||null,last_error:priorRecovery?.last_error||null,retry_count:Number(priorRecovery?.retry_count||0),recovered_from_restart:Boolean(priorRecovery),grants_authority:false};
    realtimeController=controller;
    const emitStatus=status=>{try{onStatus?.({...status,company_id,grants_authority:false});}catch(_){}};
    const deliver=async projection=>{if(controller.stopped||realtimeController!==controller)return null;controller.last_event_at=new Date().toISOString();const result=onProjection?await onProjection(projection):projection;await checkpointSyncRecovery({company_id,mode:controller.mode,poll_interval_ms:config.poll_interval_ms,retry_count:controller.retry_count,last_event_at:controller.last_event_at,last_error:controller.last_error}).catch(()=>null);return result;};
    const schedulePoll=(delay=config.poll_interval_ms)=>{
      if(controller.stopped||realtimeController!==controller)return;
      controller.poll_timer=setTimeout(async()=>{
        try{
          if(connectivityState()==='online'){
            const projection=await refreshProjection();
            await deliver(projection);
            emitStatus({mode:'polling',status:'SYNCED',projected_at:projection.projected_at});
          }else emitStatus({mode:'polling',status:'OFFLINE'});
        }catch(error){controller.retry_count+=1;controller.last_error=String(error?.message||error);void checkpointSyncRecovery({company_id,mode:'polling',poll_interval_ms:config.poll_interval_ms,retry_count:controller.retry_count,last_error:controller.last_error}).catch(()=>{});emitStatus({mode:'polling',status:'ERROR',error:controller.last_error});}
        schedulePoll(config.poll_interval_ms);
      },Math.max(0,delay));
    };
    const fallbackToPolling=error=>{
      if(controller.stopped||realtimeController!==controller)return;
      controller.mode='polling';controller.retry_count+=1;controller.last_error=String(error?.message||error||'realtime-unavailable');void checkpointSyncRecovery({company_id,mode:'polling',poll_interval_ms:config.poll_interval_ms,retry_count:controller.retry_count,last_error:controller.last_error}).catch(()=>{});
      void observeWorkforce('warn','realtime-fallback',{company_id,transport:'polling',retry_count:controller.retry_count,error:controller.last_error});
      emitStatus({mode:'polling',status:'FALLBACK',error:controller.last_error});
      schedulePoll(0);
    };
    if(!config.realtime_endpoint||typeof fetch!=='function'||typeof ReadableStream==='undefined'||typeof TextDecoder==='undefined'){
      schedulePoll(0);await checkpointSyncRecovery({company_id,mode:'polling',poll_interval_ms:config.poll_interval_ms,retry_count:controller.retry_count}).catch(()=>null);emitStatus({mode:'polling',status:controller.recovered_from_restart?'RECOVERED':'STARTED'});return {started:true,mode:'polling',company_id,poll_interval_ms:config.poll_interval_ms,recovered_from_restart:controller.recovered_from_restart,grants_authority:false};
    }
    const abortController=typeof AbortController!=='undefined'?new AbortController():null;controller.abort_controller=abortController;
    (async()=>{
      try{
        if(connectivityState()!=='online')throw new Error('workforce-realtime-offline');
        const headers={'Accept':'text/event-stream','X-Titan-Company-Id':company_id};if(config.token)headers.Authorization=`Bearer ${config.token}`;
        const response=await fetch(config.realtime_endpoint,{method:'GET',headers,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abortController?.signal});
        if(!response.ok||!response.body?.getReader)throw new Error(`workforce-realtime-http-${response.status||0}`);
        await checkpointSyncRecovery({company_id,mode:'realtime',poll_interval_ms:config.poll_interval_ms,retry_count:controller.retry_count}).catch(()=>null);void observeWorkforce('info','realtime-connected',{company_id,transport:'realtime',retry_count:controller.retry_count});emitStatus({mode:'realtime',status:controller.recovered_from_restart?'RECOVERED_CONNECTED':'CONNECTED'});
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        while(!controller.stopped&&realtimeController===controller){
          const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
          let split;while((split=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');if(!data)continue;let parsed;try{parsed=JSON.parse(data);}catch{throw new Error('workforce-realtime-invalid-json');}const projection=normalizeRealtimeProjectionEvent(parsed,company_id);await deliver(projection);}
        }
        if(!controller.stopped)fallbackToPolling(new Error('workforce-realtime-stream-ended'));
      }catch(error){if(!controller.stopped&&error?.name!=='AbortError')fallbackToPolling(error);}
    })();
    return {started:true,mode:'realtime',company_id,poll_interval_ms:config.poll_interval_ms,realtime_endpoint:config.realtime_endpoint,recovered_from_restart:controller.recovered_from_restart,grants_authority:false};
  }
  function operationForIntent(intent){if(intent?.action==='propose_role_activation')return 'client.workforce.role_activation.propose';if(intent?.action==='request_assignment_review')return 'client.workforce.assignment_review.propose';return 'client.workforce.control.propose';}
  async function submitPreparedIntents(intents=[]){const prepared=intents.filter(x=>x?.state==='prepared').slice(0,100);if(connectivityState()!=='online')return prepared.map(intent=>({intent_id:intent.intent_id,ok:true,queued:true,state:'prepared',reason:'offline-contraction-local-intent-retained',grants_authority:false}));const out=[];for(const intent of prepared){try{const result=await send(operationForIntent(intent),{intent});out.push({intent_id:intent.intent_id,ok:true,queued:false,receipt:result.receipt,grants_authority:false});}catch(error){out.push({intent_id:intent.intent_id,ok:false,error:String(error?.message||error),grants_authority:false});}}return out;}
  async function buildExternalActorBoundary(payload={}){return sendRuntime('TITAN_WORKFORCE_EXTERNAL_ACTOR_BOUNDARY_BUILD',{...payload,company_id:await companyId()});}
  async function getExternalActorBoundary(payload={}){return sendRuntime('TITAN_WORKFORCE_EXTERNAL_ACTOR_BOUNDARY_GET',{...payload,company_id:await companyId()}).then(x=>x.record||null);}
  async function evaluateExternalActorParticipation(payload={}){return sendRuntime('TITAN_WORKFORCE_EXTERNAL_ACTOR_PARTICIPATION_EVALUATE',{...payload,company_id:await companyId()});}
  async function recordExternalActorParticipationReceipt(payload={}){return sendRuntime('TITAN_WORKFORCE_EXTERNAL_ACTOR_PARTICIPATION_RECEIPT_RECORD',{...payload,company_id:await companyId()});}
  async function buildWorkforceNotificationEscalation(payload={}){return sendRuntime('TITAN_WORKFORCE_NOTIFICATION_ESCALATION_BUILD',{...payload,company_id:await companyId()});}
  async function getWorkforceNotificationEscalation(payload={}){return sendRuntime('TITAN_WORKFORCE_NOTIFICATION_ESCALATION_GET',{...payload,company_id:await companyId()}).then(x=>x.record||null);}
  async function transitionWorkforceNotification(payload={}){return sendRuntime('TITAN_WORKFORCE_NOTIFICATION_TRANSITION',{...payload,company_id:await companyId()});}
  async function evaluateWorkforceEscalationDue(payload={}){return sendRuntime('TITAN_WORKFORCE_ESCALATION_DUE_EVALUATE',{...payload,company_id:await companyId()});}
  async function buildWorkforceScheduleRecurrence(payload={}){return sendRuntime('TITAN_WORKFORCE_SCHEDULE_RECURRENCE_BUILD',{...payload,company_id:await companyId()});}
  async function getWorkforceScheduleRecurrence(payload={}){return sendRuntime('TITAN_WORKFORCE_SCHEDULE_RECURRENCE_GET',{...payload,company_id:await companyId()}).then(x=>x.record||null);}
  async function evaluateWorkforceScheduleDue(payload={}){return sendRuntime('TITAN_WORKFORCE_SCHEDULE_DUE_EVALUATE',{...payload,company_id:await companyId()});}
  async function recordWorkforceScheduleInstance(payload={}){return sendRuntime('TITAN_WORKFORCE_SCHEDULE_INSTANCE_RECORD',{...payload,company_id:await companyId()});}
  async function buildWorkforceFinancialResourceGuardrails(payload={}){return sendRuntime('TITAN_WORKFORCE_FINANCIAL_GUARDRAILS_BUILD',{...payload,company_id:await companyId()});}
  async function getWorkforceFinancialResourceGuardrails(payload={}){return sendRuntime('TITAN_WORKFORCE_FINANCIAL_GUARDRAILS_GET',{...payload,company_id:await companyId()}).then(x=>x.record||null);}
  async function evaluateWorkforceResourceRequest(payload={}){return sendRuntime('TITAN_WORKFORCE_RESOURCE_REQUEST_EVALUATE',{...payload,company_id:await companyId()});}
  async function recordWorkforceResourceReservation(payload={}){return sendRuntime('TITAN_WORKFORCE_RESOURCE_RESERVATION_RECORD',{...payload,company_id:await companyId()});}
  async function recordWorkforceResourceConsumption(payload={}){return sendRuntime('TITAN_WORKFORCE_RESOURCE_CONSUMPTION_RECORD',{...payload,company_id:await companyId()});}
  async function buildWorkforcePhysicalEnvironmentalRisk(payload={}){return sendRuntime('TITAN_WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_BUILD',{...payload,company_id:await companyId()});}
  async function getWorkforcePhysicalEnvironmentalRisk(payload={}){return sendRuntime('TITAN_WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_GET',{...payload,company_id:await companyId()}).then(x=>x.record||null);}
  async function evaluateWorkforcePhysicalEnvironmentalRisk(payload={}){return sendRuntime('TITAN_WORKFORCE_PHYSICAL_ENVIRONMENTAL_RISK_EVALUATE',{...payload,company_id:await companyId()});}
  async function recordWorkforceRiskMitigation(payload={}){return sendRuntime('TITAN_WORKFORCE_RISK_MITIGATION_RECORD',{...payload,company_id:await companyId()});}
  window.TitanClientWorkforceGateway={READ:[...READ],PROPOSE:[...PROPOSE],PROPOSAL_STATES:[...PROPOSAL_STATES],GATEWAY_CONTRACT:{...GATEWAY_CONTRACT},BACKEND_LINEAGE:{...BACKEND_LINEAGE},DEPLOYMENT_LINEAGE:{...DEPLOYMENT_LINEAGE},connectivityState,observeWorkforce,workforceHealth,readCache,writeCache,buildEnvelope,verifyAuthenticatedBinding,verifyContractResponse,normalizeCompanyBoundaryInput,createRequest,verifyBackendLineageProof,verifyDeploymentLineageProof,normalizeProposalLifecycle,normalizeAuthorityEvaluationInput,evaluateProposalAuthority,claimOperation,completeOperation,evaluateRetry,prepareApprovedCommand,verifyGovernedExecution,normalizeProjectionRevision,projectionMeta,nextProjectionSyncGeneration,normalizeRealtimeProjectionEvent,checkpointSyncRecovery,getSyncRecovery,completeSyncRecovery,startRealtimeSync,stopRealtimeSync,getBackendLineage,getConfig,saveConfig,send,createMissionTeam,transitionMissionTeam,getMissionTeam,listMissionTeams,upsertSupervisorCoordination,getSupervisorCoordination,listSupervisorCoordination,acknowledgeSupervisorEscalation,prepareSupervisorHandover,buildChiefOfStaffCoordination,getChiefOfStaffCoordination,saveDecisionRightsPolicy,getDecisionRightsPolicy,evaluateDecisionRight,buildSkillCapabilityRegistry,getSkillCapabilityRegistry,buildWorkloadCapacity,getWorkloadCapacity,buildPerformanceOutcomes,getPerformanceOutcomes,buildDynamicStaffing,getDynamicStaffing,buildImprovementProposals,getImprovementProposals,buildInvestigationInstallationHandover,getInvestigationInstallationHandover,buildBusinessDiscoverySpecification,getBusinessDiscoverySpecification,buildInstallationPlan,getInstallationPlan,buildCommissioningGates,getCommissioningGates,buildLiveLaravelHostCertification,getLiveLaravelHostCertification,probeLiveLaravelHostCertification,buildWorkforceEndToEndCertification,getWorkforceEndToEndCertification,buildWorkforceBrowserLiveSmokeCertification,getWorkforceBrowserLiveSmokeCertification,buildCrossVersionCompatibility,getCrossVersionCompatibility,buildMigrationUpgradeSafety,getMigrationUpgradeSafety,transitionMigrationUpgradeSafety,executeRegisteredWorkforceMigrations,buildUninstallReversibility,getUninstallReversibility,transitionUninstallReversibility,buildWorkforceSecurityPosture,getWorkforceSecurityPosture,buildWorkforceSecurityEvidenceChain,buildWorkforcePrivacyEvidenceControls,getWorkforcePrivacyEvidenceControls,evaluateWorkforceEvidenceAccess,prepareWorkforceEvidenceExport,prepareWorkforceEvidenceDeletion,buildWorkforceIntelligenceRouting,getWorkforceIntelligenceRouting,selectWorkforceIntelligenceRoute,recordWorkforceProviderReceipt,buildWorkforceKnowledgeAuthority,getWorkforceKnowledgeAuthority,evaluateWorkforceKnowledgeUse,recordWorkforceKnowledgeUseReceipt,buildUnifiedWorkforce,getUnifiedWorkforce,evaluateUnifiedWorkforceAssignment,buildExternalActorBoundary,getExternalActorBoundary,evaluateExternalActorParticipation,recordExternalActorParticipationReceipt,buildWorkforceNotificationEscalation,getWorkforceNotificationEscalation,transitionWorkforceNotification,evaluateWorkforceEscalationDue,buildWorkforceScheduleRecurrence,getWorkforceScheduleRecurrence,evaluateWorkforceScheduleDue,recordWorkforceScheduleInstance,buildWorkforceFinancialResourceGuardrails,getWorkforceFinancialResourceGuardrails,evaluateWorkforceResourceRequest,recordWorkforceResourceReservation,recordWorkforceResourceConsumption,buildWorkforcePhysicalEnvironmentalRisk,getWorkforcePhysicalEnvironmentalRisk,evaluateWorkforcePhysicalEnvironmentalRisk,recordWorkforceRiskMitigation,buildWorkforceWorkerMemory,getWorkforceWorkerMemory,recallWorkforceWorkerMemory,recordWorkforceWorkerMemoryRecallReceipt,buildWorkforceGraph,refreshProjection,submitPreparedIntents,receipts,publicConfig};
})();
