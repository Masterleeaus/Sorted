// Hardened convergence from ResQAI issue #723.
// Explainable relationship-risk assessment only; Titan CRM and Customer Care remain authoritative.

const LEGACY_COMPANY_KEYS = new Set(['tenant_id','tenantId','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id','account_id']);
const clean=(v:unknown,max=240)=>typeof v==='string'?v.trim().slice(0,max):'';
function company(v:unknown){const x=clean(v,128);if(!x)throw new TypeError('company_id is required');return x;}
function rejectLegacy(v:unknown,path='input'):void{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const [k,x] of Object.entries(v as Record<string,unknown>)){if(LEGACY_COMPANY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function isoDate(v:unknown,field:string){const s=clean(v,40);if(!/^\d{4}-\d{2}-\d{2}/.test(s))throw new TypeError(`${field} must be an ISO date`);const d=new Date(`${s.slice(0,10)}T00:00:00.000Z`);if(Number.isNaN(d.getTime()))throw new TypeError(`${field} must be an ISO date`);return d;}
const days=(today:Date,v:unknown)=>{if(!v)return null;try{return Math.floor((today.getTime()-isoDate(v,'evidence date').getTime())/86400000);}catch{return null;}};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const band=(score:number)=>score>=.8?'HEALTHY':score>=.6?'WATCH':score>=.35?'SLIPPING':'CRITICAL';

export const RELATIONSHIP_HEALTH_CONTRACT=Object.freeze({
 schema:'titan.workforce.customer-care.relationship-health-contract.v1',
 company_boundary:'company_id', source_authority:'Titan CRM + Titan Customer Care',
 assessment_only:true, writes_health_state:false, automatic_task_creation:false,
 automatic_contact:false, grants_authority:false
});

export function assessRelationshipHealth(input:any={}){
 rejectLegacy(input);
 const company_id=company(input.company_id);
 const today=isoDate(input.today,'today');
 const lookback=Math.max(1,Math.min(730,Number.isFinite(Number(input.lookback_days))?Math.floor(Number(input.lookback_days)):120));
 const evidence=input.evidence&&typeof input.evidence==='object'?input.evidence:{};
 if(evidence.company_id!==undefined&&company(evidence.company_id)!==company_id)throw new Error('cross-company relationship evidence rejected');
 const signals:any[]=[]; let score=1;
 const add=(code:string,weight:number,detail:string)=>{const w=Math.max(0,Math.min(.5,weight));score-=w;signals.push(Object.freeze({code,weight:Number(w.toFixed(3)),detail}));};
 const contact=days(today,evidence.last_contact_at);
 const service=days(today,evidence.last_service_at);
 const lifetime=Math.max(0,Number(evidence.lifetime_jobs)||0);
 const overdue=Math.max(0,Math.floor(Number(evidence.overdue_followups)||0));
 const open=Math.max(overdue,Math.floor(Number(evidence.open_followups)||0));
 const unresolved=Math.max(0,Math.floor(Number(evidence.unresolved_customer_care_items)||0));
 const critical=Math.max(0,Math.floor(Number(evidence.critical_customer_care_items)||0));

 if(contact===null)add('NO_CONTACT_RECORDED',.1,'No verified contact date is available.');
 else if(contact>lookback)add('STALE_CONTACT',Math.min(.4,.15+((contact-lookback)/365)*.6),`Last verified contact was ${contact} days ago.`);
 if(service===null&&lifetime===0)add('NO_SERVICE_HISTORY',.15,'No verified completed service is recorded.');
 else if(service!==null&&service>lookback*1.5)add('STALE_SERVICE',.2,`Last verified service was ${service} days ago.`);
 if(overdue>=6||overdue*10>Math.max(1,open)*4)add('FOLLOWUP_SLIPPAGE',.2,`${overdue} overdue follow-ups require review.`);
 else if(overdue>0)add('FOLLOWUP_SLIPPAGE',Math.min(.15,.04*overdue),`${overdue} overdue follow-up(s) require review.`);
 if(unresolved>0)add('UNRESOLVED_CUSTOMER_CARE',.15,`${unresolved} unresolved customer-care item(s).`);
 if(critical>0)add('CRITICAL_CUSTOMER_CARE',.25,`${critical} critical customer-care item(s) require human attention.`);
 if(lifetime>0&&lifetime<=2)add('EARLY_RELATIONSHIP',.05,'Relationship has limited completed-service history.');

 score=Number(clamp(score).toFixed(3));
 const health_band=band(score);
 return Object.freeze({
  schema:'titan.workforce.customer-care.relationship-health-assessment.v1', company_id,
  customer_id:clean(evidence.customer_id,180)||null, score, health_band,
  signals:Object.freeze(signals), evidence_summary:Object.freeze({days_since_last_contact:contact,days_since_last_service:service,lifetime_jobs:lifetime,open_followups:open,overdue_followups:overdue,unresolved_customer_care_items:unresolved,critical_customer_care_items:critical}),
  next_step:health_band==='CRITICAL'?'PROPOSE_HUMAN_REVIEW':health_band==='SLIPPING'?'PROPOSE_RELATIONSHIP_REVIEW':'NO_PROTECTED_EFFECT',
  score_is_advisory:true, writes_health_state:false, automatic_task_creation:false, automatic_contact:false,
  execution_permitted:false, authority_granted:false, grants_authority:false
 });
}
