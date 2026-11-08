// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/role-router.mjs
const SERVICE_DOMAINS = Object.freeze({
  crm:['crm','customer_service','reception','retention','sales'],
  quotes:['quoting','sales','crm'],
  bookings:['scheduling','reception','crm'],
  jobs_work_orders:['dispatch','operations','scheduling','crm'],
  invoicing:['accounts','cash_collection','crm'],
  payments:['cash_collection','accounts','crm'],
  communications:['customer_service','reception','crm'],
  human_workforce:['hr_people','dispatch','operations'],
  advanced_intelligence_workforce:['management_support','technology_automation','operations'],
  governance:['compliance','management_support'],
  reporting:['analytics','management_support'],
  environmental_systems:['environmental_performance','compliance','analytics'],
  assets_inventory:['assets','purchasing','operations'],
  providers_capabilities:['technology_automation','operations'],
});

const clean = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export function serviceDomains(service='') {
  return [...(SERVICE_DOMAINS[String(service || '')] || SERVICE_DOMAINS.providers_capabilities)];
}

function validateRole(role) {
  if (!role || typeof role !== 'object') throw new Error('Role definition must be an object');
  if (role.company_boundary !== 'company_id') throw new Error(`Role ${role.role_definition_id || role.name || 'unknown'} must use company_id as the sole company boundary`);
  if (role.activation_confers_authority !== false) throw new Error(`Role ${role.role_definition_id || role.name || 'unknown'} must not gain authority merely by activation`);
}

function roleScore(role, text, service) {
  const domains=serviceDomains(service);
  const roleDomains=Array.isArray(role.operational_domains) ? role.operational_domains : [];
  let score=roleDomains.reduce((sum,d)=>sum+(domains.includes(d)?8:0),0);
  const hay=clean(`${role.name || ''} ${role.purpose || ''} ${role.division_key || ''} ${roleDomains.join(' ')}`);
  const tokens=clean(text).split(' ').filter(t=>t.length>=4);
  for(const token of tokens) if(hay.includes(token)) score+=2;
  const intent=clean(text);
  const boosts=[
    [/\bquote|estimate|pricing\b/,'quote'],
    [/\bbook|appointment|schedule\b/,'booking'],
    [/\bdispatch\b/,'dispatch'],
    [/\bcomplete|completion\b/,'completion'],
    [/\binvoice|billing\b/,'billing'],
    [/\boverdue|receivable|collection|payment\b/,'receivable'],
    [/\benvironment|waste|water|energy|emission\b/,'environment'],
    [/\binventory|stock|equipment|fleet|asset\b/,'asset'],
    [/\bcompliance|risk|assurance\b/,'compliance'],
  ];
  for(const [pattern,needle] of boosts) if(pattern.test(intent) && hay.includes(needle)) score+=12;
  return score;
}

export function routeOperationalRole(outcome='', service='providers_capabilities', roles=[]) {
  if (!Array.isArray(roles) || !roles.length) return {role:null,score:0,service,domains:serviceDomains(service)};
  roles.forEach(validateRole);
  const ranked=roles.map(role=>({role,score:roleScore(role,outcome,service)}))
    .sort((a,b)=>b.score-a.score || String(a.role.role_definition_id).localeCompare(String(b.role.role_definition_id)));
  const winner=ranked[0];
  return {role:winner?.score>0 ? winner.role : null,score:winner?.score || 0,service,domains:serviceDomains(service)};
}
