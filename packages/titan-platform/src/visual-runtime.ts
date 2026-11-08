import { createVisualRuntimeEnvelope } from "./ported/titan-runtime/visual-runtime/index.js";

export type VisualEnvironment=Readonly<{company_id?:string;surface:"zero"|"go"|"hub";viewport?:"mobile"|"tablet"|"desktop";reduced_motion?:boolean;[key:string]:unknown}>;
export type VisualPreferences=Readonly<{motion?:"auto"|"reduced"|"full";contrast?:"auto"|"normal"|"high";[key:string]:unknown}>;
export type VisualCapabilitySupport=Readonly<{motion:boolean;transitions:boolean;assets:boolean;accessibility_degradation:true}>;

export function defaultVisualCapabilitySupport(environment:VisualEnvironment):VisualCapabilitySupport {
  return Object.freeze({motion:environment.reduced_motion!==true,transitions:environment.reduced_motion!==true,assets:true,accessibility_degradation:true});
}

export function planVisualRuntime(input:Readonly<Record<string,unknown>>,environment:VisualEnvironment,preferences:VisualPreferences={},support:VisualCapabilitySupport=defaultVisualCapabilitySupport(environment)){
  if(!["zero","go","hub"].includes(String(environment.surface)))throw new Error("visual_runtime_surface_invalid");
  const envelope=createVisualRuntimeEnvelope({
    company_id:environment.company_id,
    surface:environment.surface,
    treatment:input,
    environment,
    preferences,
    support,
  });
  return Object.freeze({...envelope,authority_granted:false,semantics_mutable:false});
}
