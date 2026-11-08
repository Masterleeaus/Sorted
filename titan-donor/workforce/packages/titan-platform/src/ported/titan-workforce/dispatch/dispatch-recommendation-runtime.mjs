import {buildDispatchProposal,toAssignmentDecisionDraft} from './dispatch-proposal-runtime.mjs';

const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const norm=v=>clean(v,80).toLowerCase().replace(/\s+/g,'_');
const rad=d=>d*Math.PI/180;

function assertCompany(company_id){if(!validCompany(company_id))throw new Error('dispatch-recommendation-company_id-required');}
function companyRows(values,company_id,label){
  const rows=list(values);const foreign=rows.find(x=>x?.company_id&&clean(x.company_id,128)!==company_id);
  if(foreign)throw new Error(`dispatch-recommendation-cross-company-${label}-rejected`);
  return rows.filter(x=>!x?.company_id||clean(x.company_id,128)===company_id);
}
function locate(v={}){
  const src=v.location||v.service_location||v.geo||v.coordinates||{};
  const lat=finite(v.latitude??v.lat??src.latitude??src.lat);const lon=finite(v.longitude??v.lng??v.lon??src.longitude??src.lng??src.lon);
  if(lat==null||lon==null||Math.abs(lat)>90||Math.abs(lon)>180)return null;
  return {lat,lon};
}
function distanceKm(a,b){
  if(!a||!b)return null;const R=6371;const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return Number((2*R*Math.asin(Math.sqrt(h))).toFixed(3));
}
function availabilityFor(rows,worker_id,start,end){
  const matches=rows.filter(x=>clean(x.worker_id)===worker_id);
  if(!matches.length)return {known:false,available:true,reason:null};
  const covering=matches.some(x=>{
    if(x.available===false||['unavailable','leave','blocked'].includes(norm(x.state||x.status)))return false;
    const s=finite(x.start_ms??x.start_at_ms),e=finite(x.end_ms??x.end_at_ms);
    if(start==null&&end==null)return x.available!==false;
    return (s==null||start==null||s<=start)&&(e==null||end==null||e>=end);
  });
  return {known:true,available:covering,reason:covering?null:'outside-worker-availability'};
}
function workerLocation(rows,worker_id){return locate(rows.find(x=>clean(x.worker_id)===worker_id)||{});}
function queueItem(queue,work_item_id){return list(queue?.items).find(x=>clean(x.work_item_id)===work_item_id)||null;}

export function buildDispatchRecommendation(input={},graph={},capacitySnapshot=null){
  const company_id=clean(input.company_id,128);assertCompany(company_id);
  const work_item=input.work_item||{};const work_item_id=clean(input.work_item_id||work_item.work_item_id);
  if(!work_item_id)throw new Error('dispatch-recommendation-work_item_id-required');
  if(work_item.company_id&&clean(work_item.company_id,128)!==company_id)throw new Error('dispatch-recommendation-cross-company-work-item-rejected');
  if(input.queue&&input.queue.company_id!==company_id)throw new Error('dispatch-recommendation-cross-company-queue-rejected');
  const qItem=input.queue?queueItem(input.queue,work_item_id):null;
  if(input.queue&&!qItem)throw new Error('dispatch-recommendation-work-item-not-in-queue');
  const nonDispatchable=qItem&&!["READY","UPCOMING"].includes(qItem.queue_state);
  const availability=companyRows(input.worker_availability,company_id,'availability');
  const locations=companyRows(input.worker_locations,company_id,'worker-location');
  const serviceLocation=locate(work_item)||locate(input.service_location||{});
  const start=finite(work_item.service_window_start_ms??qItem?.service_window_start_ms);
  const end=finite(work_item.service_window_end_ms??qItem?.service_window_end_ms);
  const proposal=buildDispatchProposal({...input,company_id,work_item_id,work_item},graph,capacitySnapshot);
  const enriched=proposal.candidates.map(c=>{
    const av=availabilityFor(availability,c.worker_id,start,end);const km=distanceKm(workerLocation(locations,c.worker_id),serviceLocation);
    const reasons=[...c.reasons];if(!av.available)reasons.push(av.reason);
    const eligible=c.eligible&&av.available;
    const geography_score=km==null?0:Math.max(0,1-Math.min(km,100)/100);
    const availability_score=av.known?(av.available?1:0):0;
    const recommendation_score=Number((c.score+availability_score*15+geography_score*10).toFixed(4));
    return {...c,eligible,reasons,availability_known:av.known,available_for_service_window:av.available,distance_km:km,recommendation_score,ranking_factors:{...c.ranking_factors,availability_score,geography_score},identity_confers_authority:false,grants_authority:false};
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.recommendation_score-a.recommendation_score||((a.distance_km??Number.MAX_SAFE_INTEGER)-(b.distance_km??Number.MAX_SAFE_INTEGER))||a.worker_id.localeCompare(b.worker_id));
  const selected_candidate=nonDispatchable?null:(enriched.find(x=>x.eligible)||null);
  const state=nonDispatchable?'NOT_DISPATCHABLE':selected_candidate?'RECOMMENDED':'NO_ELIGIBLE_CANDIDATE';
  return {
    schema:'titan.workforce.dispatch.recommendation.v1',dispatch_recommendation_id:`dispatch-recommendation:${company_id}:${work_item_id}`,
    company_id,work_item_id,state,queue_state:qItem?.queue_state||null,service_window_start_ms:start,service_window_end_ms:end,service_location:serviceLocation,
    ranking_policy:['eligibility','capability','capacity','availability','geography_if_present','preference','utilization','worker_id'],candidates:enriched,selected_candidate,
    next_step:state==='RECOMMENDED'?'SUBMIT_ASSIGNMENT_DECISION_FOR_GOVERNED_REVIEW':state==='NOT_DISPATCHABLE'?'KEEP_IN_DISPATCH_QUEUE':'ESCALATE_NO_ELIGIBLE_CANDIDATE',
    requires_approval:true,requires_existing_authority_evaluation:true,automatic_assignment:false,automatic_reassignment:false,execution_permitted:false,identity_confers_authority:false,role_confers_authority:false,grants_authority:false,authority_effect:false,
    evidence_policy:{availability_is_advisory_input:true,geography_optional:true,missing_geography_not_disqualifying:true,canonical_scheduler_not_replaced:true}
  };
}

export function toRecommendedAssignmentDecisionDraft(recommendation={}){
  if(recommendation?.schema!=='titan.workforce.dispatch.recommendation.v1')throw new Error('dispatch-recommendation-required');
  if(!recommendation.selected_candidate?.worker_id)throw new Error('dispatch-recommendation-selected-candidate-required');
  const proposal={schema:'titan.workforce.dispatch.proposal.v1',dispatch_proposal_id:recommendation.dispatch_recommendation_id,company_id:recommendation.company_id,work_item_id:recommendation.work_item_id,selected_candidate:recommendation.selected_candidate};
  const draft=toAssignmentDecisionDraft(proposal);
  return {...draft,source_dispatch_recommendation_id:recommendation.dispatch_recommendation_id,ranking_factors:{...draft.ranking_factors,recommendation_score:recommendation.selected_candidate.recommendation_score,distance_km:recommendation.selected_candidate.distance_km},requires_approval:true,execution_permitted:false,identity_confers_authority:false,grants_authority:false};
}

export function summarizeDispatchRecommendation(r={}){return {company_id:r.company_id,work_item_id:r.work_item_id,state:r.state,candidate_count:list(r.candidates).length,eligible_candidate_count:list(r.candidates).filter(x=>x?.eligible).length,selected_worker_id:r.selected_candidate?.worker_id||null,requires_approval:true,automatic_assignment:false,execution_permitted:false,grants_authority:false};}
