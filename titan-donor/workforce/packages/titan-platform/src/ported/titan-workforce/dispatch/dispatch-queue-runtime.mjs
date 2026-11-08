const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const lower=v=>clean(v,80).toLowerCase();
const normalizeState=v=>lower(v).replace(/\s+/g,'_');
const terminal=new Set(['completed','cancelled','rejected','expired']);
const activeAssignmentStates=new Set(['proposed','assigned']);

function assertCompany(company_id){if(!validCompany(company_id))throw new Error('dispatch-queue-company_id-required');}
function companyRows(values,company_id,label){
  const rows=list(values);
  const foreign=rows.find(x=>x?.company_id&&clean(x.company_id,128)!==company_id);
  if(foreign)throw new Error(`dispatch-queue-cross-company-${label}-rejected`);
  return rows.filter(x=>!x?.company_id||clean(x.company_id,128)===company_id);
}
function itemId(x={}){return clean(x.work_item_id||x.job_id||x.work_order_id||x.id);}
function assignmentWorkId(x={}){return clean(x.work_item_id||x.job_id||x.work_order_id);}
function dependencyIds(x={}){return [...new Set(list(x.dependencies).map(d=>clean(typeof d==='string'?d:(d?.work_item_id||d?.id))).filter(Boolean))].sort();}
function serviceWindow(x={}){
  const source=x.service_window||x.window||x.schedule||{};
  const start=finite(x.service_window_start_ms??source.start_ms??source.start_at_ms??x.scheduled_start_ms);
  const end=finite(x.service_window_end_ms??source.end_ms??source.end_at_ms??x.scheduled_end_ms);
  return {start_ms:start,end_ms:end};
}
function assignmentFor(assignments,work_item_id){
  return assignments.filter(a=>assignmentWorkId(a)===work_item_id&&activeAssignmentStates.has(normalizeState(a.decision_state||a.state||a.status)))
    .sort((a,b)=>clean(a.assignment_id||a.id).localeCompare(clean(b.assignment_id||b.id)))[0]||null;
}
function sequenceClass({state,blockedBy,windowStart,now,assignment}){
  if(terminal.has(state))return 'TERMINAL';
  if(blockedBy.length)return 'BLOCKED_DEPENDENCY';
  if(assignment&&normalizeState(assignment.decision_state||assignment.state||assignment.status)==='assigned')return 'ASSIGNED';
  if(windowStart!=null&&now!=null&&windowStart>now)return 'UPCOMING';
  return 'READY';
}
function priorityValue(x={}){const p=finite(x.priority);return p==null?0:p;}
function dueValue(end){return end==null?Number.MAX_SAFE_INTEGER:end;}
function startValue(start){return start==null?Number.MAX_SAFE_INTEGER:start;}

export function buildDispatchQueueProjection(input={}){
  const company_id=clean(input.company_id,128);assertCompany(company_id);
  const now=finite(input.now_ms??input.now);
  const workItems=companyRows(input.work_items||input.jobs||input.work_orders,company_id,'work-item');
  const assignments=companyRows(input.assignments,company_id,'assignment');
  const ids=new Set();
  for(const w of workItems){const id=itemId(w);if(!id)throw new Error('dispatch-queue-work_item_id-required');if(ids.has(id))throw new Error('dispatch-queue-duplicate-work-item');ids.add(id);}
  const completed=new Set(workItems.filter(w=>terminal.has(normalizeState(w.state||w.status))).map(itemId));
  const items=workItems.map(w=>{
    const work_item_id=itemId(w);const state=normalizeState(w.state||w.status)||'open';const deps=dependencyIds(w);
    const blocked_by=deps.filter(id=>!completed.has(id));const window=serviceWindow(w);const assignment=assignmentFor(assignments,work_item_id);
    const assigned_worker_id=assignment?clean(assignment.worker_id||assignment.assignee_worker_id)||null:null;
    const cls=sequenceClass({state,blockedBy:blocked_by,windowStart:window.start_ms,now,assignment});
    return {
      work_item_id,work_type:clean(w.work_type||w.type||w.kind)||null,state,priority:priorityValue(w),dependencies:deps,blocked_by:blocked_by,
      service_window_start_ms:window.start_ms,service_window_end_ms:window.end_ms,
      assignment_id:assignment?clean(assignment.assignment_id||assignment.id)||null:null,assigned_worker_id,
      queue_state:cls,dispatchable:cls==='READY'||cls==='UPCOMING',requires_governed_assignment:!assignment&&!terminal.has(state),
      trace_id:clean(w.trace_id)||null,correlation_id:clean(w.correlation_id)||null,
      projection_only:true,automatic_dispatch:false,execution_permitted:false,identity_confers_authority:false,grants_authority:false
    };
  });
  const rankClass={READY:0,ASSIGNED:1,UPCOMING:2,BLOCKED_DEPENDENCY:3,TERMINAL:4};
  items.sort((a,b)=>(rankClass[a.queue_state]-rankClass[b.queue_state])||(b.priority-a.priority)||(dueValue(a.service_window_end_ms)-dueValue(b.service_window_end_ms))||(startValue(a.service_window_start_ms)-startValue(b.service_window_start_ms))||a.work_item_id.localeCompare(b.work_item_id));
  items.forEach((x,i)=>{x.sequence=i+1;});
  const counts={};for(const x of items)counts[x.queue_state]=(counts[x.queue_state]||0)+1;
  return {
    schema:'titan.workforce.dispatch.queue.v1',company_id,queue_revision:Math.max(0,Math.trunc(finite(input.queue_revision)??0)),generated_at:clean(input.generated_at)||null,
    items,summary:{total:items.length,ready:counts.READY||0,assigned:counts.ASSIGNED||0,upcoming:counts.UPCOMING||0,blocked_dependency:counts.BLOCKED_DEPENDENCY||0,terminal:counts.TERMINAL||0},
    sequencing_policy:['queue_state','priority_desc','service_window_end_asc','service_window_start_asc','work_item_id_asc'],
    projection_only:true,automatic_dispatch:false,automatic_reassignment:false,execution_permitted:false,identity_confers_authority:false,role_confers_authority:false,grants_authority:false,authority_effect:false
  };
}

export function selectNextDispatchable(queue={}){
  if(queue?.schema!=='titan.workforce.dispatch.queue.v1')throw new Error('dispatch-queue-required');
  const item=list(queue.items).find(x=>x?.queue_state==='READY'&&x?.dispatchable===true)||null;
  return item?{company_id:queue.company_id,work_item_id:item.work_item_id,sequence:item.sequence,reason:'highest-ranked-ready-work-item',requires_governed_assignment:item.requires_governed_assignment===true,automatic_dispatch:false,execution_permitted:false,grants_authority:false}:null;
}

export function summarizeDispatchQueue(queue={}){
  return {company_id:queue.company_id,queue_revision:queue.queue_revision,total:list(queue.items).length,...(queue.summary||{}),projection_only:true,automatic_dispatch:false,execution_permitted:false,grants_authority:false};
}
