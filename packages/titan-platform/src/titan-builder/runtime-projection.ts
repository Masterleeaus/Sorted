import type { InterfaceContext } from "../interface-runtime.js";
import { builderDataSourceOptions } from "./binding-policy.js";
import type { BuilderDocument, BuilderNode } from "./editor.js";
import type { BuilderSurface } from "./field-mapping.js";
import type { BuilderRuntimePreviewEnvelope } from "./preview-adapter.js";

export type BuilderProjectionRequest=Readonly<{
 schema:"titan.builder.projection-request/v1";
 company_id:string;
 surface:BuilderSurface;
 source:string;
 contract:string;
 fields:readonly string[];
 required_capability?:string;
 read_only:true;
 purpose:"builder-preview";
 authority_granted:false;
}>;

export type BuilderProjectionProvider=(request:BuilderProjectionRequest,context:InterfaceContext)=>Promise<BuilderRuntimePreviewEnvelope|null>|BuilderRuntimePreviewEnvelope|null;

function boundSources(node:BuilderNode,out:Set<string>){
 const source=(node.props as any)?.data_binding?.source;
 if(typeof source==="string"&&source.trim())out.add(source.trim());
 for(const child of node.children??[])boundSources(child,out);
}

export function createBuilderProjectionRequests(document:BuilderDocument,context:InterfaceContext):readonly BuilderProjectionRequest[]{
 if(!document.company_id.trim())throw new Error("company_id_required");
 if(document.company_id!==context.company_id)throw new Error("builder_context_company_mismatch");
 if(document.surface!==context.product_surface)throw new Error("builder_context_surface_mismatch");
 const sources=new Set<string>(); boundSources(document.root,sources);
 const available=builderDataSourceOptions(document.surface);
 return [...sources].sort().map(sourceId=>{
  const source=available.find(x=>x.id===sourceId);
  if(!source)throw new Error(`builder_projection_source_not_allowed:${sourceId}`);
  return Object.freeze({schema:"titan.builder.projection-request/v1" as const,company_id:document.company_id,surface:document.surface,source:source.id,contract:source.contract,fields:Object.freeze([...source.fields]),required_capability:source.required_capability,read_only:true as const,purpose:"builder-preview" as const,authority_granted:false as const});
 });
}

export async function resolveBuilderRuntimeProjections(input:{document:BuilderDocument;context:InterfaceContext;provider?:BuilderProjectionProvider}):Promise<readonly BuilderRuntimePreviewEnvelope[]>{
 if(!input.provider)return Object.freeze([]);
 const requests=createBuilderProjectionRequests(input.document,input.context); const results:BuilderRuntimePreviewEnvelope[]=[];
 for(const request of requests){
  const envelope=await input.provider(request,input.context);
  if(!envelope)continue;
  if(envelope.company_id!==request.company_id)throw new Error("builder_projection_company_mismatch");
  if(envelope.surface!==request.surface)throw new Error("builder_projection_surface_mismatch");
  if(envelope.source!==request.source)throw new Error("builder_projection_source_mismatch");
  results.push(Object.freeze({...envelope,records:Object.freeze([...envelope.records])}));
 }
 return Object.freeze(results);
}
