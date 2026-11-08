import { sanitizeBuilderProjection, resolveBuilderSurface } from "./index.js";
import { assertBuilderSurfaceCertified } from "./surface-certification.js";
import type { BuilderDocument, BuilderNode } from "./editor.js";
import type { BuilderCommandIntent } from "./command-handoff.js";
import type { BuilderPresentationSignal } from "./signal-priority.js";

export type BuilderSecurityGateResult=Readonly<{
 schema:"titan.builder.security-gate/v1"; accepted:true; company_id:string; surface:"zero"|"go"|"hub";
 document_revision:number; checked_nodes:number; authority_granted:false; execution_authority:false;
}>;

const DENIED_TEXT=/(<script\b|javascript\s*:|data\s*:\s*text\/html|on(?:click|load|error|mouse\w+)\s*=|__proto__|prototype\s*pollution|constructor\s*\[)/i;
const MAX_DEPTH=32,MAX_NODES=500,MAX_STRING=20_000;
function walk(node:BuilderNode,depth=0,state={nodes:0}){
 if(depth>MAX_DEPTH)throw new Error("builder_security_depth_limit");
 if(++state.nodes>MAX_NODES)throw new Error("builder_security_node_limit");
 const scan=(value:unknown)=>{
  if(typeof value==="string"){if(value.length>MAX_STRING)throw new Error("builder_security_string_limit");if(DENIED_TEXT.test(value))throw new Error("builder_security_active_content_denied");return;}
  if(Array.isArray(value)){for(const v of value)scan(v);return;}
  if(value&&typeof value==="object")for(const [k,v] of Object.entries(value as Record<string,unknown>)){if(["__proto__","prototype","constructor"].includes(k))throw new Error("builder_security_prototype_key_denied");scan(v);}
 };
 scan(node.props);scan(node.visibility);scan(node.actions);for(const child of node.children??[])walk(child,depth+1,state);return state.nodes;
}
/** Final presentation security gate. It validates shape/isolation only and never grants action authority. */
export function assertBuilderSecurityGate(document:BuilderDocument,expected:{company_id:string;surface:string}):BuilderSecurityGateResult{
 if(!expected.company_id.trim()||document.company_id!==expected.company_id)throw new Error("builder_security_company_mismatch");
 const surface=resolveBuilderSurface(expected.surface);if(resolveBuilderSurface(document.surface)!==surface)throw new Error("builder_security_surface_mismatch");
 const checked_nodes=walk(document.root);assertBuilderSurfaceCertified(document,{company_id:expected.company_id,surface});
 return Object.freeze({schema:"titan.builder.security-gate/v1",accepted:true,company_id:expected.company_id,surface,document_revision:document.revision,checked_nodes,authority_granted:false,execution_authority:false});
}
export function sanitizeBuilderAiOutput<T>(value:T):T{
 const clean=sanitizeBuilderProjection(value) as T;const encoded=JSON.stringify(clean);if(encoded.length>1_000_000)throw new Error("builder_security_ai_payload_limit");if(DENIED_TEXT.test(encoded))throw new Error("builder_security_active_content_denied");return clean;
}
export function assertBuilderCommandSecurity(intent:BuilderCommandIntent,expected:{company_id:string;surface:string;document_revision:number}){
 if(intent.company_id!==expected.company_id)throw new Error("builder_security_command_company_mismatch");
 if(intent.surface!==resolveBuilderSurface(expected.surface))throw new Error("builder_security_command_surface_mismatch");
 if(intent.document_revision!==expected.document_revision)throw new Error("builder_security_command_stale_revision");
 if(intent.authority_granted!==false||intent.requires_downstream_authorization!==true||intent.execution_owner!=="command-bus")throw new Error("builder_security_command_authority_bypass");
 return Object.freeze({accepted:true as const,authority_granted:false as const,execution_owner:"command-bus" as const});
}
export function filterBuilderSignalsAtSecurityBoundary(signals:readonly BuilderPresentationSignal[],expected:{company_id:string;surface:string;now?:string}){
 const surface=resolveBuilderSurface(expected.surface),now=Date.parse(expected.now??new Date().toISOString());
 return Object.freeze(signals.filter(s=>s.company_id===expected.company_id&&s.surface===surface&&Number.isFinite(Date.parse(s.observed_at))&&Date.parse(s.observed_at)<=now+300_000));
}
