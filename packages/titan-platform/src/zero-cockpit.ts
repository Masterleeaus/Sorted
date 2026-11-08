export type CockpitAttention={attention_id:string;company_id:string;category:"approval"|"exception"|"risk"|"task";title:string;priority:number;created_at:string;source_ref:string;action_id?:string};
export type ZeroCockpitProjection={schema:"titan.zero-cockpit.v1";company_id:string;generated_at:string;attention:readonly CockpitAttention[];approval_count:number;read_only:true};
const req=(v:unknown,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x;};
export function projectZeroCockpit(input:{company_id:string;generated_at:string;attention:CockpitAttention[]}):ZeroCockpitProjection{
 req(input.company_id,"company_id");if(!Number.isFinite(Date.parse(input.generated_at)))throw new Error("generated_at-invalid");if(!Array.isArray(input.attention))throw new Error("attention-required");
 const rows=input.attention.map(a=>{if(a.company_id!==input.company_id)throw new Error("attention-company-mismatch");if(!Number.isInteger(a.priority)||a.priority<0)throw new Error("priority-invalid");if(!Number.isFinite(Date.parse(a.created_at)))throw new Error("attention-created-at-invalid");return Object.freeze({...a,attention_id:req(a.attention_id,"attention_id"),title:req(a.title,"title"),source_ref:req(a.source_ref,"source_ref")});});
 rows.sort((a,b)=>b.priority-a.priority||Date.parse(a.created_at)-Date.parse(b.created_at)||a.attention_id.localeCompare(b.attention_id));
 return Object.freeze({schema:"titan.zero-cockpit.v1",company_id:req(input.company_id,"company_id"),generated_at:input.generated_at,attention:Object.freeze(rows),approval_count:rows.filter(a=>a.category==="approval").length,read_only:true});
}
export function assertCockpitProjectionScope(projection:ZeroCockpitProjection,company_id:string){if(projection.company_id!==req(company_id,"company_id"))throw new Error("cockpit-company-mismatch");return true;}
