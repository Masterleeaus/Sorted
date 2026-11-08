// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-capabilities/intent-capability-router.mjs
const ROUTER_VERSION='1.0.0';
const STOP=new Set(['a','an','and','the','to','for','of','on','in','with','this','that','please','can','could','would','i','we','you','my','our','it','do','make']);
const RISK={LOW:1,MEDIUM:2,HIGH:3,CRITICAL:4};
const ALIAS_GROUPS=[
  ['quote','estimate','pricing','proposal'],
  ['book','booking','appointment','schedule','scheduling'],
  ['invoice','billing','bill'],
  ['payment','payments','receivable','collection','overdue'],
  ['customer','client','crm','reception','retention'],
  ['job','jobs','work','workorder','dispatch'],
  ['environment','environmental','waste','water','energy','emission','emissions'],
  ['asset','assets','equipment','fleet','inventory','stock'],
  ['compliance','risk','governance','assurance'],
  ['worker','workforce','staff','team','role'],
  ['message','email','sms','communication','communications'],
];

const clean=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const tokens=value=>[...new Set(clean(value).split(/\s+/).filter(t=>t&&t.length>=2&&!STOP.has(t)))];
const arr=value=>Array.isArray(value)?value:[];
const uniq=value=>[...new Set(value)];

function companyApplies(entry,company_id){
  if(!entry?.company_id) return true;
  return Boolean(company_id)&&String(entry.company_id)===String(company_id);
}
function riskAllowed(entry,ceiling){
  if(!ceiling) return true;
  const actual=RISK[String(entry?.risk_class||'LOW').toUpperCase()]||1;
  const max=RISK[String(ceiling).toUpperCase()]||1;
  return actual<=max;
}
function aliasHits(queryTokens,hayTokens){
  const hay=new Set(hayTokens);
  let hits=0;
  for(const group of ALIAS_GROUPS){
    const q=group.some(word=>queryTokens.includes(word));
    const h=group.some(word=>hay.has(word));
    if(q&&h) hits++;
  }
  return hits;
}
function scoreEntry(entry,queryTokens,preferredKinds){
  const hayText=clean([
    entry.registry_id,entry.id,entry.kind,entry.title,entry.description,entry.module_id,
    ...arr(entry.capabilities),...arr(entry.authority),...arr(entry.permissions),entry.department,entry.vertical,...arr(entry.verticals)
  ].join(' '));
  const hayTokens=tokens(hayText);
  const matched=queryTokens.filter(token=>hayText.includes(token));
  const aliases=aliasHits(queryTokens,hayTokens);
  let score=(matched.length*3)+(aliases*4);
  if(preferredKinds.includes(entry.kind)) score+=4;
  const idTokens=tokens(entry.id);
  const capabilityTokens=tokens(arr(entry.capabilities).join(' '));
  if(idTokens.length&&idTokens.every(token=>queryTokens.includes(token))) score+=3;
  if(capabilityTokens.some(token=>queryTokens.includes(token))) score+=2;
  return {score,matched_tokens:matched,alias_hits:aliases};
}

export function routeIntentToCapabilities(registry,{text='',company_id=null,preferred_kinds=[],risk_ceiling=null,limit=8,min_confidence=0.55,context=null,workflow_goal=null,agent_goal=null}={}){
  const contextText=[context?.title,context?.summary,context?.url,workflow_goal,agent_goal].filter(Boolean).join(' ');
  const query=tokens([text,contextText].filter(Boolean).join(' '));
  const context_used=Boolean(clean(contextText));
  const kinds=uniq(arr(preferred_kinds).map(v=>String(v).toLowerCase()).filter(Boolean));
  const candidates=[];
  for(const entry of registry?.entries||[]){
    if(!companyApplies(entry,company_id)) continue;
    if(!riskAllowed(entry,risk_ceiling)) continue;
    const detail=scoreEntry(entry,query,kinds);
    if(detail.score<=0) continue;
    candidates.push({
      registry_id:entry.registry_id,id:entry.id,kind:entry.kind,title:entry.title,module_id:entry.module_id,
      risk_class:entry.risk_class||'LOW',mutates:Boolean(entry.mutates),requires_authority:Boolean(entry.mutates||arr(entry.authority).length),
      activation_confers_authority:false,score:detail.score,matched_tokens:detail.matched_tokens,alias_hits:detail.alias_hits,
    });
  }
  candidates.sort((a,b)=>b.score-a.score || b.matched_tokens.length-a.matched_tokens.length || a.registry_id.localeCompare(b.registry_id));
  const trimmed=candidates.slice(0,Math.max(1,Number(limit)||8));
  const top=trimmed[0]||null;
  const second=trimmed[1]||null;
  const denominator=Math.max(1,(query.length*3)+4);
  const rawConfidence=top?Math.min(1,top.score/denominator):0;
  const margin=top&&second?Math.max(0,(top.score-second.score)/Math.max(1,top.score)):top?1:0;
  const confidence=Number((rawConfidence*(second?0.75+Math.min(0.25,margin):1)).toFixed(3));
  const confident=Boolean(top)&&confidence>=Number(min_confidence||0.55)&&(margin>=0.08||!second||top.score>=second.score+2);
  return {
    version:ROUTER_VERSION,
    company_id:company_id==null||company_id===''?null:String(company_id),
    text:String(text||''),
    context_used,
    selected:confident?top:null,
    candidates:trimmed,
    confidence,
    margin:Number(margin.toFixed(3)),
    requires_model:!confident,
    reason:confident?'deterministic_capability_match':'no_confident_deterministic_match',
    execution_authority_granted:false,
    authority_rule:'routing_selects_candidates_but_never_grants_execution_authority',
  };
}

export const INTENT_CAPABILITY_ROUTER_VERSION=ROUTER_VERSION;
