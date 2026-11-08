// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/semver.mjs
const SEMVER=/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value){
  const m=String(value||'').trim().match(SEMVER);
  if(!m) throw new Error(`Invalid semantic version: ${value}`);
  return {major:Number(m[1]),minor:Number(m[2]),patch:Number(m[3]),prerelease:m[4]||null,raw:String(value).trim()};
}

function comparePrerelease(a,b){
  if(a==null&&b==null)return 0;
  if(a==null)return 1;
  if(b==null)return -1;
  const aa=a.split('.'),bb=b.split('.');
  const max=Math.max(aa.length,bb.length);
  for(let i=0;i<max;i++){
    if(aa[i]==null)return -1;
    if(bb[i]==null)return 1;
    const an=/^\d+$/.test(aa[i]),bn=/^\d+$/.test(bb[i]);
    if(an&&bn){const d=Number(aa[i])-Number(bb[i]);if(d)return d>0?1:-1;continue;}
    if(an!==bn)return an?-1:1;
    const d=aa[i].localeCompare(bb[i]);if(d)return d>0?1:-1;
  }
  return 0;
}

export function compareVersions(left,right){
  const a=parseVersion(left),b=parseVersion(right);
  for(const key of ['major','minor','patch']){if(a[key]!==b[key])return a[key]>b[key]?1:-1;}
  return comparePrerelease(a.prerelease,b.prerelease);
}

function lowerForCaret(v){
  if(v.major>0)return `${v.major+1}.0.0`;
  if(v.minor>0)return `0.${v.minor+1}.0`;
  return `0.0.${v.patch+1}`;
}

function testComparator(version,expr){
  const m=expr.match(/^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if(!m)throw new Error(`Unsupported version range: ${expr}`);
  const op=m[1]||'=';const c=compareVersions(version,m[2]);
  return op==='='?c===0:op==='>'?c>0:op==='>='?c>=0:op==='<'?c<0:c<=0;
}

export function satisfiesVersion(version,range='*'){
  parseVersion(version);
  const raw=String(range==null?'*':range).trim();
  if(!raw||raw==='*')return true;
  if(raw.startsWith('^')){
    const base=parseVersion(raw.slice(1));
    return compareVersions(version,base.raw)>=0&&compareVersions(version,lowerForCaret(base))<0;
  }
  if(raw.startsWith('~')){
    const base=parseVersion(raw.slice(1));
    const upper=`${base.major}.${base.minor+1}.0`;
    return compareVersions(version,base.raw)>=0&&compareVersions(version,upper)<0;
  }
  const parts=raw.split(/\s+/).filter(Boolean);
  return parts.every(part=>testComparator(version,part));
}
