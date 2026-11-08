// @ts-nocheck
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';
const clone=v=>structuredClone(v);
const freeze=v=>Object.freeze(v);
const nonempty=(v,n)=>{const s=String(v??'').trim();if(!s)throw new TypeError(`${n}-required`);return s};
export function createVectorClock(values={}){const out={};for(const [node,counter] of Object.entries(values)){const n=nonempty(node,'vector-clock-node');const c=Number(counter);if(!Number.isInteger(c)||c<0)throw new TypeError('vector-clock-counter-invalid');out[n]=c;}return Object.freeze(Object.fromEntries(Object.entries(out).sort()));}
export function tickVectorClock(clock,node){const n=nonempty(node,'vector-clock-node');return createVectorClock({...clock,[n]:Number(clock?.[n]??0)+1});}
export function mergeVectorClocks(a={},b={}){const out={...a};for(const [n,c] of Object.entries(b))out[n]=Math.max(Number(out[n]??0),Number(c));return createVectorClock(out);}
export function compareVectorClocks(a={},b={}){let less=false,greater=false;for(const n of new Set([...Object.keys(a),...Object.keys(b)])){const l=Number(a[n]??0),r=Number(b[n]??0);less||=l<r;greater||=l>r;}return !less&&!greater?'equal':less&&!greater?'before':!less&&greater?'after':'concurrent';}
export function resolveCausalInteractionState({company_id,local,remote,last_writer_wins_fields=[]}={}){assertCanonicalCompanyId(company_id);rejectLegacyTenantAuthorityDeep({local,remote},'interaction-causal-sync');const relation=compareVectorClocks(local?.clock??{},remote?.clock??{});if(relation==='before')return freeze({company_id,relation,state:clone(remote),conflicts:[],authority_neutral:true});if(relation==='after')return freeze({company_id,relation,state:clone(local),conflicts:[],authority_neutral:true});const lp=local?.payload??{},rp=remote?.payload??{},payload={},conflicts=[];const rt=Date.parse(remote?.updated_at??'')||0,lt=Date.parse(local?.updated_at??'')||0;for(const f of new Set([...Object.keys(lp),...Object.keys(rp)])){if(!(f in lp)){payload[f]=clone(rp[f]);continue}if(!(f in rp)||Object.is(lp[f],rp[f])){payload[f]=clone(lp[f]);continue}if(last_writer_wins_fields.includes(f)){payload[f]=clone(rt>lt?rp[f]:lp[f]);continue}payload[f]=clone(lp[f]);conflicts.push({field:f,local:clone(lp[f]),remote:clone(rp[f]),strategy:'manual_review'});}return freeze({company_id,relation,state:{clock:mergeVectorClocks(local?.clock??{},remote?.clock??{}),updated_at:rt>lt?remote?.updated_at??null:local?.updated_at??null,payload},conflicts,requires_review:conflicts.length>0,authority_neutral:true});}
export function createBehavioralMemory({company_id}={}) {
  const cid=assertCanonicalCompanyId(company_id);
  const last=new Map(); const transitions=new Map(); const frequency=new Map();
  const key=(actor,from)=>`${actor}::${from}`;
  const api={
    record:(actor_id,action)=>{const actor=nonempty(actor_id,'actor-id'); const next=nonempty(action,'action'); const prev=last.get(actor); const fk=`${actor}::${next}`; frequency.set(fk,(frequency.get(fk) ?? 0)+1); if(prev){const k=key(actor,prev); const m=transitions.get(k) ?? new Map(); m.set(next,(m.get(next) ?? 0)+1); transitions.set(k,m);} last.set(actor,next); return api;},
    predict:(actor_id,after=null)=>{const actor=nonempty(actor_id,'actor-id'); const source=after ?? last.get(actor) ?? null; const m=source ? transitions.get(key(actor,source)) : null; if(!m?.size)return freeze({company_id:cid,action:null,confidence:0,alternatives:[],evidence:[],authority_neutral:true}); const rows=[...m.entries()].sort((a,b)=>b[1]-a[1] || String(a[0]).localeCompare(String(b[0]))); const total=rows.reduce((sum,row)=>sum+row[1],0); return freeze({company_id:cid,action:rows[0][0],confidence:Number((rows[0][1]/total).toFixed(4)),alternatives:rows.slice(1,4).map(row=>row[0]),evidence:{transition_count:rows[0][1],total_observations:total,after:source},authority_neutral:true});},
    profile:(actor_id)=>{const actor=nonempty(actor_id,'actor-id'); const rows=[...frequency.entries()].filter(([k])=>k.startsWith(`${actor}::`)).map(([k,v])=>[k.split('::')[1],v]).sort((a,b)=>b[1]-a[1]); return freeze({company_id:cid,frequency:Object.fromEntries(rows),events:rows.reduce((sum,row)=>sum+row[1],0)});},
    resetSequence:(actor_id)=>{last.delete(nonempty(actor_id,'actor-id'));}
  };
  return Object.freeze(api);
}
