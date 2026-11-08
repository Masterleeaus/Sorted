export type SurfaceClass = "CANONICAL_PRODUCT" | "WORKSPACE" | "PORTAL" | "PUBLIC_WEB" | "EMBED" | "GENERATED_APP" | "TEMPORARY_MISSION" | "HOST_COCKPIT" | "DEVICE_CLIENT" | "KIOSK" | "PUBLIC_SHARE";
export type SurfaceState = "UNKNOWN" | "DECLARED" | "DRAFT" | "STAGED" | "LIVE" | "DEGRADED" | "UNREACHABLE" | "RETIRED";
export type SurfaceLifecycle = "DRAFT" | "VALIDATE" | "PREVIEW" | "STAGE" | "VERIFY" | "PROMOTE" | "LIVE" | "DEGRADE" | "DISABLE" | "ROLLBACK" | "RETIRE";
export type SurfaceDescriptor = Readonly<{ surface_id:string; company_id:string; surface_class:SurfaceClass; product_mode?:"zero"|"go"|"hub"|"onboarding"; audience:string; renderer:string; runtime:string; version:string; route?:string; capabilities:readonly string[]; lifecycle:SurfaceLifecycle; state:SurfaceState; health:Readonly<{ uiReachable:boolean; backendReachable:boolean; capabilityDegraded:boolean; staleProjection:boolean; verificationFailed:boolean }>; provenance_ref:string; authorityGranted:false; temporary?:Readonly<{ expires_at:string; end_condition:string }> }>;
export type SurfaceProjectionInput = Readonly<{ company_id:string; descriptors:readonly SurfaceDescriptor[]; deployed?:Readonly<Record<string,{ version:string; state:SurfaceState; uiReachable:boolean; backendReachable:boolean }>>; now?:string }>;
export type SurfaceIntent = Readonly<{ surface_id:string; company_id:string; intent:"install"|"activate"|"deactivate"|"upgrade"|"rollback"|"retire"; authorityGranted:false; delegated_to:"deployment-owner" }>;

const classes = new Set<SurfaceClass>(["CANONICAL_PRODUCT","WORKSPACE","PORTAL","PUBLIC_WEB","EMBED","GENERATED_APP","TEMPORARY_MISSION","HOST_COCKPIT","DEVICE_CLIENT","KIOSK","PUBLIC_SHARE"]);
const states = new Set<SurfaceState>(["UNKNOWN","DECLARED","DRAFT","STAGED","LIVE","DEGRADED","UNREACHABLE","RETIRED"]);
function required(value:string, name:string){ if(!value.trim()) throw new Error(`${name}-required`); }
function validateDescriptor(d:SurfaceDescriptor, company_id:string){
  required(company_id,"company_id"); required(d.surface_id,"surface_id"); required(d.version,"version"); required(d.provenance_ref,"provenance_ref");
  if(d.company_id!==company_id) throw new Error("surface-cross-company-denied");
  if(!classes.has(d.surface_class)) throw new Error("surface-class-invalid");
  if(!states.has(d.state)) throw new Error("surface-state-invalid");
  if(d.surface_class==="TEMPORARY_MISSION"&&!d.temporary) throw new Error("temporary-surface-expiry-required");
}
function healthState(d:SurfaceDescriptor, deployed:SurfaceProjectionInput["deployed"]){
  const fact=deployed?.[d.surface_id];
  if(!fact) return d.state === "RETIRED" ? "RETIRED" as const : "DECLARED" as const;
  if(!fact.uiReachable||!fact.backendReachable) return "UNREACHABLE" as const;
  if(fact.version!==d.version) return "DEGRADED" as const;
  return fact.state;
}
export function projectSurfaceEstate(input:SurfaceProjectionInput):readonly SurfaceDescriptor[]{
  required(input.company_id,"company_id");
  const seen=new Set<string>();
  return Object.freeze(input.descriptors.map(d=>{
    validateDescriptor(d,input.company_id); if(seen.has(d.surface_id)) throw new Error("duplicate-surface-id"); seen.add(d.surface_id);
    const deployed=input.deployed?.[d.surface_id];
    const state=healthState(d,input.deployed);
    const expired=d.temporary && Boolean(input.now && Date.parse(input.now)>=Date.parse(d.temporary.expires_at));
    return Object.freeze({...d, state:expired?"RETIRED":state, health:Object.freeze({uiReachable:deployed?.uiReachable??false,backendReachable:deployed?.backendReachable??false,capabilityDegraded:state==="DEGRADED",staleProjection:Boolean(deployed&&deployed.version!==d.version),verificationFailed:state==="UNREACHABLE"}), authorityGranted:false as const});
  }).sort((a,b)=>a.surface_id.localeCompare(b.surface_id)));
}
export function createSurfaceIntent(company_id:string, surface_id:string, intent:SurfaceIntent["intent"]):SurfaceIntent{ required(company_id,"company_id"); required(surface_id,"surface_id"); return Object.freeze({surface_id,company_id,intent,authorityGranted:false as const,delegated_to:"deployment-owner" as const}); }
