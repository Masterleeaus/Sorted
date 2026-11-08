import { createInterfaceRuntimeEnvelope, createInterfaceContext as createPortedInterfaceContext } from "./ported/titan-runtime/interface-runtime/index.js";

export type InterfaceContext=Readonly<{company_id:string;product_surface:"zero"|"go"|"hub";workspace_id?:string;capabilities?:readonly string[];[key:string]:unknown}>;
export type PresentationNode=Readonly<{key:string;type:string;props:Readonly<Record<string,unknown>>;children:readonly PresentationNode[]}>;
export type PresentationIntent=Readonly<{purpose:string;surface:"zero"|"go"|"hub";components:readonly PresentationNode[];visual_hints?:Readonly<Record<string,unknown>>;governed_actions?:readonly unknown[]}>;
export type PresentationTree=Readonly<{schema:"titan.interface.presentation-tree/v1";company_id:string;surface:"zero"|"go"|"hub";purpose:string;nodes:readonly PresentationNode[];runtime:Readonly<Record<string,unknown>>;authority_granted:false}>;

export function createTitanInterfaceRuntime(){
  return Object.freeze({
    createContext(input:Record<string,unknown>):InterfaceContext {
      const context=createPortedInterfaceContext(input) as InterfaceContext;
      if(!String(context.company_id??"").trim())throw new Error("interface_context_company_required");
      if(!["zero","go","hub"].includes(String(context.product_surface)))throw new Error("interface_context_surface_invalid");
      return Object.freeze(context);
    },
    presentation:Object.freeze({
      compose(intent:PresentationIntent,context:InterfaceContext):PresentationTree {
        if(!String(context.company_id??"").trim())throw new Error("interface_context_company_required");
        if(intent.surface!==context.product_surface)throw new Error("interface_presentation_surface_mismatch");
        const runtime=createInterfaceRuntimeEnvelope({company_id:context.company_id,surface:context.product_surface,purpose:intent.purpose});
        return Object.freeze({schema:"titan.interface.presentation-tree/v1",company_id:context.company_id,surface:intent.surface,purpose:intent.purpose,nodes:Object.freeze([...intent.components]),runtime:runtime as Readonly<Record<string,unknown>>,authority_granted:false});
      },
    }),
  });
}

export { createPortedInterfaceContext as createInterfaceContext };
