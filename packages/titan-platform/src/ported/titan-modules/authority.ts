// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/authority.mjs
const ID_RE=/^[a-z0-9][a-z0-9._:-]{0,127}$/;
const RISKS=new Set(['low','medium','high','critical']);
const AUTONOMY=new Set(['suggest','assist','semi-auto','auto','trusted-auto','predictive']);

const uniq=value=>[...new Set((Array.isArray(value)?value:[]).map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))];

export function normalizeAuthority(input={}){
  const raw=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  if(raw.activation_confers_authority===true)throw new Error('Module activation never grants authority; activation_confers_authority must be false');
  const requests=(Array.isArray(raw.requests)?raw.requests:[]).map((request,index)=>{
    if(!request||typeof request!=='object'||Array.isArray(request))throw new Error(`authority.requests[${index}] must be an object`);
    const id=String(request.id||'').trim().toLowerCase();
    if(!ID_RE.test(id))throw new Error(`authority.requests[${index}].id is invalid`);
    const risk=String(request.risk||'low').trim().toLowerCase();
    if(!RISKS.has(risk))throw new Error(`authority.requests[${index}].risk must be low, medium, high or critical`);
    const max_autonomy=String(request.max_autonomy||'suggest').trim().toLowerCase();
    if(!AUTONOMY.has(max_autonomy))throw new Error(`authority.requests[${index}].max_autonomy is invalid`);
    return {id,effect:String(request.effect||id).trim(),capability:String(request.capability||'').trim(),risk,max_autonomy};
  });
  return {activation_confers_authority:false,requests};
}

export function normalizeAuthorityIds(value,field='authority'){
  const ids=uniq(value);
  for(const id of ids)if(!ID_RE.test(id))throw new Error(`${field} contains invalid authority id: ${id}`);
  return ids;
}

export function assertExecutionAuthority(declaration={},context={}){
  if(!declaration?.mutates)return true;
  const required=normalizeAuthorityIds(declaration.authority||[],'execution authority');
  if(!required.length)throw new Error('Mutating execution requires at least one declared authority grant');
  const grants=new Set(normalizeAuthorityIds(context?.authority_grants||[],'context.authority_grants'));
  const missing=required.filter(id=>!grants.has(id));
  if(missing.length)throw new Error(`Missing authority grant(s): ${missing.join(', ')}`);
  return true;
}
