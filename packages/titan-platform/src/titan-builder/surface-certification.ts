import type { BuilderDocument, BuilderNode } from "./editor.js";
import { builderActionOptions, builderDataSourceOptions } from "./binding-policy.js";
import { resolveBuilderSurface, type BuilderSurface } from "./index.js";

export type BuilderSurfaceCertificationIssue=Readonly<{node_id:string;code:string;detail:string}>;
export type BuilderSurfaceCertification=Readonly<{
 schema:"titan.builder.surface-certification/v1"; company_id:string; surface:BuilderSurface; certified:boolean;
 checked_nodes:number; issues:readonly BuilderSurfaceCertificationIssue[];
 constraints:Readonly<{company_boundary:"company_id";canonical_surface:true;max_primary_cards:3;responsive_required:true;authority_granted:false}>;
}>;

const RESPONSIVE_KEYS=["mobile","tablet","desktop"] as const;
function walk(node:BuilderNode,out:BuilderNode[]=[]){out.push(node);for(const child of node.children??[])walk(child,out);return out;}

/** Fail-closed certification before a Builder document is exposed on Zero, Go or Hub. */
export function certifyBuilderSurface(document:BuilderDocument,expected:{company_id:string;surface:string}):BuilderSurfaceCertification {
 const surface=resolveBuilderSurface(expected.surface);
 if(!expected.company_id.trim()||document.company_id!==expected.company_id) throw new Error("builder_surface_company_mismatch");
 if(resolveBuilderSurface(document.surface)!==surface) throw new Error("builder_surface_mismatch");
 const dataSources=new Set(builderDataSourceOptions(surface).map(x=>x.id));
 const actions=new Set(builderActionOptions(surface).map(x=>x.id));
 const nodes=walk(document.root); const issues:BuilderSurfaceCertificationIssue[]=[];
 const visibleRoot=(document.root.children??[]).filter(n=>(n.props as any)?.visibility?.hidden!==true);
 if(visibleRoot.length>3)issues.push({node_id:"root",code:"too_many_primary_cards",detail:`${visibleRoot.length} visible root cards; maximum is 3`});
 for(const node of nodes){
   if(node.id==="root")continue;
   const props=(node.props??{}) as Record<string,any>; const binding=props.data_binding;
   if(binding?.source&&!dataSources.has(String(binding.source)))issues.push({node_id:node.id,code:"surface_data_source_denied",detail:String(binding.source)});
   for(const action of node.actions??[])if(!actions.has(action.action))issues.push({node_id:node.id,code:"surface_action_denied",detail:action.action});
   const responsive=props.responsive;
   if(!responsive||RESPONSIVE_KEYS.some(k=>typeof responsive[k]!=="string"||!responsive[k].trim()))issues.push({node_id:node.id,code:"responsive_contract_missing",detail:"mobile/tablet/desktop presentation required"});
 }
 return Object.freeze({schema:"titan.builder.surface-certification/v1",company_id:document.company_id,surface,certified:issues.length===0,checked_nodes:nodes.length,issues:Object.freeze(issues),constraints:Object.freeze({company_boundary:"company_id",canonical_surface:true,max_primary_cards:3,responsive_required:true,authority_granted:false})});
}

export function assertBuilderSurfaceCertified(document:BuilderDocument,expected:{company_id:string;surface:string}){
 const result=certifyBuilderSurface(document,expected); if(!result.certified)throw new Error(`builder_surface_not_certified:${result.issues.map(x=>x.code).join(",")}`); return result;
}
