import type{InterfaceWorkspace,WorkspaceObject}from"./interface-workspace.js";
type R=Readonly<Record<string,unknown>>;
export type WorkingSetEntry=Readonly<{object_key:string;object_id:string;label:string;status:string|null;source:"context"|"attention"|"decision"|"user";pinned:boolean}>;
export type WorkTrayItem=Readonly<{id:string;kind:"attention"|"decision";object_key:string|null;title:string;summary:string|null;priority:number;provider:string;action_refs:readonly string[];requires_user:boolean}>;
export type InspectorModel=Readonly<{object_key:string;object_id:string|null;label:string;facets:readonly R[];views:readonly R[];actions:readonly R[];authority:"read-and-intent-only"}>;
export type GenerativeShell=Readonly<{schema:"titan.generative-shell.v1";company_id:string;surface:string;mode:"team-in-your-pocket";chat_primary:true;working_set:readonly WorkingSetEntry[];attention:readonly WorkTrayItem[];decisions:readonly WorkTrayItem[];inspector:InspectorModel|null;cards:readonly R[]}>;
const rec=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const str=(v:unknown,d="")=>v==null?d:String(v);
export class WorkingSet{
 #items=new Map<string,WorkingSetEntry>();
 add(entry:WorkingSetEntry){if(!entry.object_key||!entry.object_id)throw new Error("working set requires object_key and object_id");this.#items.set(`${entry.object_key}:${entry.object_id}`,Object.freeze({...entry}));return this}
 pin(objectKey:string,objectId:string,pinned=true){const k=`${objectKey}:${objectId}`,x=this.#items.get(k);if(!x)throw new Error("working set entry not found");this.#items.set(k,Object.freeze({...x,pinned}));return this}
 remove(objectKey:string,objectId:string){this.#items.delete(`${objectKey}:${objectId}`);return this}
 snapshot(){return Object.freeze([...this.#items.values()].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.label.localeCompare(b.label)))}
}
export function resolveInspector(workspace:InterfaceWorkspace,objectKey:string,objectId:string|null=null):InspectorModel{
 const o=workspace.objects.find(x=>x.key===objectKey);if(!o)throw new Error("unknown inspector object");
 return Object.freeze({object_key:o.key,object_id:objectId,label:o.label,facets:o.facets,views:o.views,actions:o.actions.map(a=>Object.freeze({...a,executable:false})),authority:"read-and-intent-only"});
}
export function normalizeTrayItems(kind:"attention"|"decision",items:readonly R[]):readonly WorkTrayItem[]{
 return Object.freeze(items.map((raw,i)=>{const x=rec(raw);return Object.freeze({id:str(x.id,`${kind}-${i+1}`),kind,object_key:x.object_key==null?null:str(x.object_key),title:str(x.title,kind==="attention"?"Needs attention":"Decision"),summary:x.summary==null?null:str(x.summary),priority:Number.isFinite(Number(x.priority))?Number(x.priority):100,provider:str(x.provider_ref??x.provider,"unknown"),action_refs:Array.isArray(x.action_refs)?x.action_refs.map(String):[],requires_user:x.requires_user!==false})}).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id)));
}
export function composeGenerativeShell(workspace:InterfaceWorkspace,input:{working_set?:readonly WorkingSetEntry[];attention?:readonly R[];decisions?:readonly R[];inspect?:{object_key:string;object_id?:string|null}}={}):GenerativeShell{
 const attention=normalizeTrayItems("attention",input.attention??[]),decisions=normalizeTrayItems("decision",input.decisions??[]);
 const inspector=input.inspect?resolveInspector(workspace,input.inspect.object_key,input.inspect.object_id??null):null;
 const cards:R[]=[];
 if(attention.length)cards.push(Object.freeze({kind:"attention",title:"Needs attention",count:attention.length,items:attention.slice(0,3)}));
 if(decisions.length)cards.push(Object.freeze({kind:"decisions",title:"Decisions",count:decisions.length,items:decisions.slice(0,3)}));
 const ws=input.working_set??[];if(ws.length)cards.push(Object.freeze({kind:"working-set",title:"In progress",count:ws.length,items:ws.slice(0,3)}));
 return Object.freeze({schema:"titan.generative-shell.v1",company_id:workspace.company_id,surface:workspace.surface,mode:"team-in-your-pocket",chat_primary:true,working_set:Object.freeze([...ws]),attention,decisions,inspector,cards:Object.freeze(cards.slice(0,3))});
}
export function projectTeamPromptContext(shell:GenerativeShell){
 return Object.freeze({company_id:shell.company_id,surface:shell.surface,experience:shell.mode,attention_count:shell.attention.length,decision_count:shell.decisions.length,working_set:shell.working_set.map(x=>({object_key:x.object_key,object_id:x.object_id,label:x.label,status:x.status})),inspecting:shell.inspector?{object_key:shell.inspector.object_key,object_id:shell.inspector.object_id}:null});
}
