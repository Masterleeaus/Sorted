// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-modules/builtin/business-services/index.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const SERVICE_RULES = Object.freeze([
  ['environmental_systems', /\b(environment|environmental|waste|water|energy|electricity|emissions?|carbon|resource efficiency|pollution|sustainab)/i],
  ['payments', /\b(payment|payments|paid|receivable|receivables|overdue|collection|cash collection|reconcile|reconciliation|remittance|deposit)\b/i],
  ['invoicing', /\b(invoice|invoices|invoicing|billing|bill customer|uninvoiced|underbill|underbilled)\b/i],
  ['quotes', /\b(quote|quotes|estimate|estimates|proposal|pricing|price this|tender|bid)\b/i],
  ['bookings', /\b(book|booking|bookings|appointment|appointments|reschedule|schedule customer|service booking)\b/i],
  ['jobs_work_orders', /\b(job|jobs|work order|work orders|dispatch|site visit|service call|field work|complete job|variation)\b/i],
  ['communications', /\b(email|emails|message|messages|sms|whatsapp|inbox|voicemail|phone call|reply|respond to|contact customer)\b/i],
  ['human_workforce', /\b(employee|employees|staff|crew|payroll|timesheet|attendance|shift|roster|human workforce|worker schedule)\b/i],
  ['assets_inventory', /\b(asset|assets|inventory|stock|equipment|fleet|vehicle|tool|tools|consumable|reorder|supplier purchase)\b/i],
  ['governance', /\b(approval|risk|governance|compliance|permission|security|audit|assurance|policy)\b/i],
  ['advanced_intelligence_workforce', /\b(ai worker|advanced intelligence|agent|agents|workforce|delegate|delegation|autonomy|outcome worker)\b/i],
  ['reporting', /\b(report|dashboard|analytics|kpi|metric|performance summary|business review)\b/i],
  ['crm', /\b(customer|customers|client|clients|lead|leads|opportunity|opportunities|contact|contacts|crm|sales pipeline|follow[- ]?up)\b/i],
]);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const normalizeCompanyId = value => String(value || '').trim();

export function validateCompanyBoundary(context={}, expectedCompanyId='') {
  const expected = normalizeCompanyId(expectedCompanyId);
  if (!expected || !/^[A-Za-z0-9._:-]{2,128}$/.test(expected)) return {ok:false,error:'A valid company_id is required'};
  if (context && typeof context === 'object') {
    if ('tenant_id' in context || 'tenant_company_id' in context) return {ok:false,error:'Legacy tenant boundary keys are not accepted; use company_id'};
    const scoped = normalizeCompanyId(context.company_id);
    if (scoped && scoped !== expected) return {ok:false,error:'Cross-company context rejected'};
  }
  return {ok:true,company_id:expected};
}

export function classifyBusinessIntent(text='') {
  const value = String(text || '').trim();
  for (const [service, pattern] of SERVICE_RULES) {
    if (pattern.test(value)) return {service, confidence:'high', matched:true};
  }
  return {service:'providers_capabilities', confidence:'low', matched:false};
}

export function chooseWorkflow(service, text='', workflowIndex={}) {
  const candidates=(workflowIndex?.workflows || []).filter(item => item?.service === service);
  if (!candidates.length) return null;
  if (candidates.length === 1) return clone(candidates[0]);
  const value=String(text || '').toLowerCase();
  const ranked=candidates.map(item=>{
    let score=0;
    const hay=`${item.id||''} ${item.name||''} ${item.capability||''}`.toLowerCase();
    for(const token of value.split(/[^a-z0-9]+/).filter(t=>t.length>=4)) if(hay.includes(token)) score+=1;
    if (/complete|finish|done/.test(value) && /complete/.test(hay)) score+=5;
    if (/variation|change order/.test(value) && /variation|update/.test(hay)) score+=5;
    if (/create|new|start/.test(value) && /create|new/.test(hay)) score+=3;
    return {item,score};
  }).sort((a,b)=>b.score-a.score || String(a.item.id).localeCompare(String(b.item.id)));
  return clone(ranked[0].item);
}

export function buildBusinessRoute(text, company_id, registry={}, workflowIndex={}, context={}) {
  const boundary=validateCompanyBoundary(context,company_id);
  if(!boundary.ok) throw new Error(boundary.error);
  const classification=classifyBusinessIntent(text);
  const service=(registry?.services || []).find(item=>item?.service===classification.service) || null;
  const workflow=chooseWorkflow(classification.service,text,workflowIndex);
  const authorityStatus=service?.status || (service?.provider ? 'ROUTABLE' : 'PROJECTION_ONLY');
  return {
    company_id:boundary.company_id,
    service:classification.service,
    confidence:classification.confidence,
    canonical_owner:service?.canonical_owner || 'Provider contracts + Command Bus',
    provider_ready:Boolean(service?.provider),
    provider_reference:service?.provider || null,
    contributors:clone(service?.contributors || []),
    authority_status:authorityStatus,
    authority_note:'Titan Zero routes/projects this domain; it does not become the canonical domain authority.',
    workflow,
  };
}

async function loadJson(path) {
  const response=await fetch(chrome.runtime.getURL(path));
  if(!response.ok) throw new Error(`Unable to load ${path} (${response.status})`);
  return response.json();
}

export async function activate(api, manifest) {
  const [registry, workflowIndex]=await Promise.all([
    loadJson('titan-business-services/canonical-service-owners.json'),
    loadJson('titan-business-services/workflows/index.json'),
  ]);
  if(registry?.tenant_boundary!=='company_id' || workflowIndex?.company_boundary!=='company_id') {
    throw new Error('Business service metadata must use company_id as the sole company boundary');
  }
  api.registerHandler('resolve-route', async payload => {
    const company_id=normalizeCompanyId(payload?.company_id);
    return buildBusinessRoute(payload?.text || payload?.outcome || '', company_id, registry, workflowIndex, payload?.context || {});
  });
  api.registerHandler('list-services', async () => ({company_boundary:'company_id', services:clone(registry.services || [])}));
  api.registerHandler('list-workflows', async () => clone(workflowIndex));
  api.registerDiagnostic('business-services', async () => ({
    ok:true,
    company_boundary:'company_id',
    service_count:(registry.services || []).length,
    workflow_count:(workflowIndex.workflows || []).length,
    unresolved_services:(registry.services || []).filter(x=>!x.provider).map(x=>x.service),
    authority_mode:manifest?.metadata?.authority_mode || 'projection_and_routing_only'
  }));
  api.log('info','Business service routing activated',{services:(registry.services||[]).length,workflows:(workflowIndex.workflows||[]).length});
  return () => api.log('info','Business service routing deactivated');
}
