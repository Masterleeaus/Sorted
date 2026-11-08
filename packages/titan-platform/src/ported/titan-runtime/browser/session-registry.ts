// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/browser/session-registry.mjs
const req=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
export class BrowserSessionRegistry{
  #company_id; #sessions=new Map();
  constructor({company_id}={}){this.#company_id=req(company_id,'company_id')}
  upsert(raw={}){const cid=req(raw.company_id??this.#company_id,'company_id');if(cid!==this.#company_id)throw new Error('cross-company-browser-session');const id=req(raw.session_id,'session_id');const tabs=(raw.tabs||[]).map(t=>Object.freeze({tab_id:String(t.tab_id??''),url:String(t.url??''),title:String(t.title??''),window_id:t.window_id??null,last_seen_at:String(t.last_seen_at??new Date().toISOString())}));const rec=Object.freeze({schema:'titan.browser-session.v1',company_id:cid,session_id:id,label:String(raw.label??''),tabs:Object.freeze(tabs),active_tab_id:raw.active_tab_id==null?null:String(raw.active_tab_id),source_lineage:Object.freeze({captured_at:String(raw.captured_at??new Date().toISOString()),source:'browser'}),authority_neutral:true});this.#sessions.set(id,rec);return rec}
  get(id){return this.#sessions.get(String(id))??null}
  list(){return Object.freeze([...this.#sessions.values()])}
  remove(id){return this.#sessions.delete(String(id))}
}
export const createBrowserSessionRegistry=context=>new BrowserSessionRegistry(context);
