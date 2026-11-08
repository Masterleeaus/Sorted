// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/package-runtime.mjs
const FORBIDDEN_SCOPE_KEYS=new Set(['tenant_id','tenant_company_id']);
const PACKAGE_SCHEMA='titan-module-package/v1';
const PACKAGE_TYPES=new Set(['module','bundle']);
const SIGNATURE_ALGORITHM='ECDSA-P256-SHA256';
const INTEGRITY_ALGORITHM='SHA-256';
const enc=new TextEncoder();

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function assertNoLegacy(value,path='package'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((item,index)=>assertNoLegacy(item,`${path}[${index}]`));return;}
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_SCOPE_KEYS.has(key))throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    assertNoLegacy(child,`${path}.${key}`);
  }
}

function canonicalizeValue(value){
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(canonicalizeValue);
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalizeValue(value[key])]));
}

export function canonicalJson(value){return JSON.stringify(canonicalizeValue(value));}

export function canonicalPackagePayload(envelope){
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))throw new Error('Signed package must be an object');
  const base=clone(envelope);
  delete base.integrity;
  delete base.signature;
  assertNoLegacy(base);
  return canonicalJson(base);
}

function toBase64Url(bytes){
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(typeof Buffer!=='undefined')return Buffer.from(view).toString('base64url');
  let binary='';for(const byte of view)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function fromBase64Url(value){
  const text=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const padded=text+'='.repeat((4-text.length%4)%4);
  if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(padded,'base64'));
  const binary=atob(padded);const out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out;
}

export async function sha256Base64Url(value){
  if(!globalThis.crypto?.subtle)throw new Error('WebCrypto is unavailable');
  const bytes=typeof value==='string'?enc.encode(value):value;
  return toBase64Url(await crypto.subtle.digest('SHA-256',bytes));
}

function trustedKey(trustedPublishers,publisherId,keyId){
  const publisher=trustedPublishers?.[publisherId];
  if(!publisher)throw new Error(`Trusted publisher not found: ${publisherId}`);
  const jwk=publisher?.[keyId]||publisher?.keys?.[keyId];
  if(!jwk)throw new Error(`Trusted publisher key not found: ${publisherId}:${keyId}`);
  return jwk;
}

export async function verifySignedPackage(input,{trustedPublishers={}}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Signed package must be a JSON object');
  assertNoLegacy(input);
  const envelope=clone(input);
  if(envelope.package_schema!==PACKAGE_SCHEMA)throw new Error(`Package schema must be ${PACKAGE_SCHEMA}`);
  const packageType=String(envelope.package_type||'').trim().toLowerCase();
  if(!PACKAGE_TYPES.has(packageType))throw new Error('Package type must be module or bundle');
  const publisherId=String(envelope.publisher?.id||'').trim().toLowerCase();
  if(!publisherId)throw new Error('Package publisher id is required');
  if(!envelope.payload||typeof envelope.payload!=='object'||Array.isArray(envelope.payload))throw new Error('Package payload is required');
  const integrity=envelope.integrity||{};
  if(String(integrity.algorithm||'').toUpperCase()!==INTEGRITY_ALGORITHM)throw new Error(`Package integrity algorithm must be ${INTEGRITY_ALGORITHM}`);
  const canonical=canonicalPackagePayload(envelope);
  const digest=await sha256Base64Url(canonical);
  if(digest!==String(integrity.digest||''))throw new Error('Package integrity digest mismatch');
  const signature=envelope.signature||{};
  if(String(signature.algorithm||'')!==SIGNATURE_ALGORITHM)throw new Error(`Package signature algorithm must be ${SIGNATURE_ALGORITHM}`);
  const keyId=String(signature.key_id||'').trim();
  if(!keyId)throw new Error('Package signature key_id is required');
  const jwk=trustedKey(trustedPublishers,publisherId,keyId);
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromBase64Url(signature.value),enc.encode(canonical));
  if(!ok)throw new Error('Package signature verification failed');
  return {ok:true,verified:true,package_type:packageType,publisher_id:publisherId,key_id:keyId,digest,envelope,payload:clone(envelope.payload)};
}

export const PACKAGE_CONSTANTS=Object.freeze({PACKAGE_SCHEMA,SIGNATURE_ALGORITHM,INTEGRITY_ALGORITHM});
