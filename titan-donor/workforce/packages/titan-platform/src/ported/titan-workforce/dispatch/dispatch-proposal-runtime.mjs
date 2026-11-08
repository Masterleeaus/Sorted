const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const uniq=v=>[...new Set(list(v).map(x=>clean(x)).filter(Boolean))].sort();
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const workerId=n=>clean(String(n?.node_id||'').replace(/^worker:/,''));
const capabilityId=n=>clean(String(n||'').replace(/^capability:/,''));

function assertGraph(graph,company_id){
  if(graph?.schema!=='titan.workforce.graph.v1'||graph?.company_id!==company_id)throw new Error('dispatch-workforce-graph-required');
}
function assertCapacity(snapshot,company_id){
  if(!snapshot)return;
  if(snapshot?.schema!=='titan.workforce.workload-capacity.v1'||snapshot?.company_id!==company_id)throw new Error('dispatch-cross-company-capacity-rejected');
}
function workerCapabilities(graph,id){
  return uniq(list(graph.edges)
    .filter(e=>e?.company_id===graph.company_id&&e?.type==='HAS_CAPABILITY'&&e?.from===`worker:${id}`)
    .map(e=>capabilityId(e.to)));
}
function capacityFor(snapshot,id){
  const row=list(snapshot?.worker_capacity).find(x=>clean(x?.worker_id)===id);
  return row?{
    available_units:Number(row.available_units||0),
    utilization:Number(row.utilization||0),
    capacity_state:clean(row.state,40)||null,
    overloaded:clean(row.state,40).toUpperCase()==='OVERLOADED'
  }:{available_units:null,utilization:null,capacity_state:null,overloaded:false};
}
function actorType(node={}){return clean(node?.attributes?.actor_type||node?.actor_type||node?.worker_type,80).toLowerCase();}
function isHuman(node={}){const t=actorType(node);return ['human','person','employee','contractor','field_worker','technician','crew'].includes(t);}
function stableProposalId(company_id,work_item_id){return `dispatch:${company_id}:${work_item_id}`;}

export function buildDispatchProposal(input={},graph={},capacitySnapshot=null){
  const company_id=clean(input.company_id,128);
  if(!validCompany(company_id))throw new Error('dispatch-company_id-required');
  assertGraph(graph,company_id);assertCapacity(capacitySnapshot,company_id);
  const work_item_id=clean(input.work_item_id||input.work_item?.work_item_id);
  if(!work_item_id)throw new Error('dispatch-work_item_id-required');
  if(input.work_item?.company_id&&clean(input.work_item.company_id,128)!==company_id)throw new Error('dispatch-cross-company-work-item-rejected');

  const required_capabilities=uniq(input.required_capabilities||input.work_item?.required_capabilities||[]);
  const required_human=input.required_human===true||input.work_item?.required_human===true;
  const excluded=new Set(uniq(input.excluded_worker_ids||[]));
  const preferred=new Set(uniq(input.preferred_worker_ids||[]));
  const demand=Math.max(0,Number(input.demand_units??input.work_item?.demand_units??1)||1);

  const workers=list(graph.nodes).filter(n=>n?.kind==='worker'&&n?.company_id===company_id).sort((a,b)=>workerId(a).localeCompare(workerId(b)));
  const candidates=workers.map(node=>{
    const worker_id=workerId(node);const caps=workerCapabilities(graph,worker_id);const missing=required_capabilities.filter(c=>!caps.includes(c));const capacity=capacityFor(capacitySnapshot,worker_id);
    const reasons=[];
    if(!worker_id)reasons.push('worker-id-missing');
    if(excluded.has(worker_id))reasons.push('explicitly-excluded');
    if(required_human&&!isHuman(node))reasons.push('human-required');
    if(missing.length)reasons.push('missing-required-capability');
    if(capacity.overloaded)reasons.push('worker-overloaded');
    if(capacity.available_units!=null&&capacity.available_units<demand)reasons.push('insufficient-capacity');
    const eligible=reasons.length===0;
    const capability_score=required_capabilities.length?((required_capabilities.length-missing.length)/required_capabilities.length):1;
    const capacity_score=capacity.available_units==null?0:Math.min(1,capacity.available_units/Math.max(1,demand));
    const preference_score=preferred.has(worker_id)?1:0;
    const score=Number((capability_score*100+capacity_score*20+preference_score*5-(capacity.utilization??0)*10).toFixed(4));
    return {worker_id,label:clean(node.label)||worker_id,actor_type:actorType(node)||null,eligible,reasons,required_capabilities,worker_capabilities:caps,missing_capabilities:missing,demand_units:demand,...capacity,score,ranking_factors:{capability_score,capacity_score,preference_score,utilization:capacity.utilization},identity_confers_authority:false,grants_authority:false};
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.worker_id.localeCompare(b.worker_id));

  const selected_candidate=candidates.find(c=>c.eligible)||null;
  return {
    schema:'titan.workforce.dispatch.proposal.v1',
    dispatch_proposal_id:clean(input.dispatch_proposal_id)||stableProposalId(company_id,work_item_id),
    company_id,work_item_id,trace_id:clean(input.trace_id||input.work_item?.trace_id)||null,correlation_id:clean(input.correlation_id||input.work_item?.correlation_id)||null,
    state:selected_candidate?'PROPOSED':'NO_ELIGIBLE_CANDIDATE',required_capabilities,required_human,demand_units:demand,candidates,selected_candidate,
    next_step:selected_candidate?'SUBMIT_ASSIGNMENT_DECISION_FOR_GOVERNED_REVIEW':'ESCALATE_NO_ELIGIBLE_CANDIDATE',
    requires_approval:true,requires_existing_authority_evaluation:true,automatic_assignment:false,automatic_reassignment:false,execution_permitted:false,identity_confers_authority:false,role_confers_authority:false,grants_authority:false,authority_effect:false
  };
}

export function toAssignmentDecisionDraft(proposal={}){
  if(proposal?.schema!=='titan.workforce.dispatch.proposal.v1')throw new Error('dispatch-proposal-required');
  if(!proposal.selected_candidate?.worker_id)throw new Error('dispatch-selected-candidate-required');
  return {
    assignment_id:`assignment:${proposal.dispatch_proposal_id}`,
    company_id:proposal.company_id,
    work_item_id:proposal.work_item_id,
    worker_id:proposal.selected_candidate.worker_id,
    eligibility_checks:[{name:'dispatch_candidate_eligible',passed:proposal.selected_candidate.eligible===true,reasons:[...proposal.selected_candidate.reasons]}],
    ranking_factors:{...proposal.selected_candidate.ranking_factors,dispatch_score:proposal.selected_candidate.score},
    decision_state:'proposed',
    source_dispatch_proposal_id:proposal.dispatch_proposal_id,
    requires_approval:true,
    execution_permitted:false,
    identity_confers_authority:false,
    grants_authority:false
  };
}

export function summarizeDispatchProposal(proposal={}){
  return {company_id:proposal.company_id,work_item_id:proposal.work_item_id,state:proposal.state,candidate_count:list(proposal.candidates).length,eligible_candidate_count:list(proposal.candidates).filter(x=>x?.eligible).length,selected_worker_id:proposal.selected_candidate?.worker_id||null,requires_approval:true,automatic_assignment:false,execution_permitted:false,grants_authority:false};
}
