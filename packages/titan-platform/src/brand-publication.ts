import { createSurfaceIntent, projectSurfaceEstate, type SurfaceDescriptor, type SurfaceIntent } from "./surface-manager.js";
import { sanitizeBuilderProjection, type BuilderDocument, type BuilderNode } from "./titan-builder/index.js";
import { assertBuilderSecurityGate } from "./titan-builder/security-gate.js";
import { createTitanInterfaceRuntime, type InterfaceContext, type PresentationNode } from "./interface-runtime.js";
import { createInteractionPresentationIntent } from "./ported/titan-runtime/interaction-engine/presentation-intent.js";
import { createInterfaceReceipt } from "./ported/titan-runtime/interface-runtime/index.js";
import { validateVisualContributionSchema } from "./ported/titan-runtime/visual-runtime/index.js";

export const BRAND_MODULE_IDS=Object.freeze([
 "titan/assistant","titan/booking","titan/quote","titan/customer-portal","titan/project","titan/jobs",
 "titan/evidence","titan/catalogue","titan/cart","titan/checkout","titan/payment","titan/messages",
 "titan/reviews","titan/assets","titan/workforce-status","titan/form","titan/approval","titan/progress",
] as const);
export type BrandModuleId=typeof BRAND_MODULE_IDS[number];
export type BrandModuleReference=Readonly<{company_id:string;ref:string}>;
export type BrandModulePresentation=Readonly<{
 schema:"titan.brand-module-presentation/v1";
 company_id:string;
 module_id:BrandModuleId;
 capability_id:string;
 status:"available"|"unavailable";
 interface_receipt:Readonly<Record<string,unknown>>;
 visual_contribution:Readonly<Record<string,unknown>>;
 interaction_intent:Readonly<Record<string,unknown>>;
 presentation:Readonly<{schema:"titan.interface.presentation-tree/v1";company_id:string;surface:"zero"|"go"|"hub";purpose:string;nodes:readonly PresentationNode[];runtime:Readonly<Record<string,unknown>>;authority_granted:false}>;
 authority_granted:false;
}>;

/**
 * Projects a canonical capability result into the existing Interface Runtime.
 * `capability_id` must come from canonical capability resolution; this function
 * does not resolve entitlements, fetch domain data, execute actions, or grant authority.
 */
export function createBrandModulePresentation(input:{module_id:BrandModuleId;presentation_id:string;company_id:string;context:InterfaceContext;capability_id:string;data_refs?:readonly BrandModuleReference[];evidence_refs?:readonly BrandModuleReference[];action_bindings?:readonly BrandActionBinding[]}):BrandModulePresentation {
 if(!record(input))throw new Error("brand-module-input-invalid");
 const allowed=["module_id","presentation_id","company_id","context","capability_id","data_refs","evidence_refs","action_bindings"];
 if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error("brand-module-unknown-field");
 if(!(BRAND_MODULE_IDS as readonly string[]).includes(input.module_id))throw new Error("brand-module-unsupported");
 const company_id=req(input.company_id,"company_id");
 if(typeof input.presentation_id!=="string"||input.presentation_id.length>256||/[\x00-\x1f\x7f]/.test(input.presentation_id))throw new Error("brand-module-presentation-id-invalid");
 const presentation_id=req(input.presentation_id,"presentation_id");
 if(typeof input.capability_id!=="string"||input.capability_id.length>256||/[\x00-\x1f\x7f]/.test(input.capability_id))throw new Error("brand-module-capability-invalid");
 const capability_id=req(input.capability_id,"capability_id");
 if(!record(input.context)||input.context.company_id!==company_id)throw new Error("brand-module-company-mismatch");
 const runtime=createTitanInterfaceRuntime();
 const context=runtime.createContext(input.context as unknown as Record<string,unknown>);
 const suppliedBindings=input.action_bindings??[];
 if(!Array.isArray(suppliedBindings)||suppliedBindings.length>32)throw new Error("brand-module-action-limit");
 const bindings=suppliedBindings.map(binding=>createBrandActionBinding(binding));
 if(bindings.some(binding=>binding.capability_id!==capability_id))throw new Error("brand-module-action-capability-mismatch");
 const required=new Set(["company_id","user_id","product_surface","domain","capabilities"]);
 for(const binding of bindings)for(const key of binding.required_context)required.add(key);
 const contextPresent=(key:string)=>{
  if(!Object.hasOwn(context,key)||context[key]==null)return false;
  const value=context[key];
  if(typeof value==="string")return value.trim().length>0;
  if(Array.isArray(value))return key==="capabilities"||value.length>0;
  return true;
 };
 if([...required].some(key=>!contextPresent(key)))throw new Error("brand-module-context-incomplete");
 const available=context.capabilities?.includes("*")===true||context.capabilities?.includes(capability_id)===true;
 const refs=(values:readonly BrandModuleReference[]|undefined,label:string)=>{
  if(!Array.isArray(values)||values.length>100)throw new Error(`brand-module-${label}-invalid`);
  const normalized=values.map(value=>{
   if(!record(value)||Object.keys(value).some(key=>key!=="company_id"&&key!=="ref")||!Object.hasOwn(value,"company_id")||!Object.hasOwn(value,"ref"))throw new Error(`brand-module-${label}-invalid`);
   if(value.company_id!==company_id)throw new Error("brand-module-reference-company-mismatch");
   if(typeof value.ref!=="string"||!value.ref.trim()||value.ref.length>256||/[\x00-\x1f\x7f]/.test(value.ref))throw new Error(`brand-module-${label}-invalid`);
   return Object.freeze({company_id,ref:value.ref});
  });
  if(new Set(normalized.map(value=>value.ref)).size!==normalized.length)throw new Error(`brand-module-${label}-duplicate`);
  return Object.freeze(normalized);
 };
 const data_refs=refs(input.data_refs??[],"data-refs"),evidence_refs=refs(input.evidence_refs??[],"evidence-refs");
 const fallback=input.module_id==="titan/booking"?"contact_owner":"capability_unavailable";
 const node:PresentationNode=Object.freeze({key:input.module_id,type:input.module_id,props:Object.freeze({
  module_id:input.module_id,capability_id,state:available?"available":"unavailable",fallback,
  data_refs:available?data_refs:Object.freeze([]),evidence_refs:available?evidence_refs:Object.freeze([]),
  action_bindings:available?Object.freeze(bindings):Object.freeze([]),action_ids:available?Object.freeze(bindings.map(binding=>binding.action_id)):Object.freeze([]),
  authority_granted:false,
 }),children:Object.freeze([])});
 const presentation=runtime.presentation.compose({purpose:`brand-module:${input.module_id}`,surface:context.product_surface,components:[node]},context);
 const interaction_intent=createInteractionPresentationIntent({presentation_id,company_id,surface:context.product_surface,kind:"brand_module",purpose:`brand-module:${input.module_id}`,
  semantic_components:[input.module_id],data_requirements:[],visual_hints:{module_id:input.module_id,state:available?"available":"unavailable"},
  actions:available?bindings.map(binding=>({intent:binding.action_id,label:binding.accessibility.screen_reader_label,capability_id:binding.capability_id,context_schema:binding.context_schema,
   required_context:binding.required_context,entitlement:binding.entitlement,risk_class:binding.risk_class,offline_behavior:binding.offline_behavior,
   public_behavior:binding.public_behavior,fallback:binding.fallback,evidence_requirements:binding.evidence_requirements,authority_granted:false})):[],
  render_hints:{module_id:input.module_id,fallback}});
 const interface_receipt=createInterfaceReceipt({receipt_id:`interface:${presentation_id}`,company_id,presentation_id,
  surface:context.product_surface,presentation_schema:presentation.schema,module_id:input.module_id,status:available?"available":"unavailable",
  receipt_scope:"presentation_projection"});
 const visual_contribution=validateVisualContributionSchema({id:`brand-studio.${input.module_id.replace("/",".")}`,provider:"brand-studio",company_id,
  surfaces:[context.product_surface],version:"1.0.0",treatment:{module_id:input.module_id,state:available?"available":"unavailable",fallback,
   business_meaning_unchanged:true},business_authority:false,authorizes_actions:false});
 return Object.freeze({schema:"titan.brand-module-presentation/v1",company_id,module_id:input.module_id,capability_id,status:available?"available":"unavailable",interface_receipt,visual_contribution,interaction_intent,presentation,authority_granted:false});
}

export type BrandPublication={schema:"titan.brand-publication.v1";publication_id:string;company_id:string;site_id:string;version:number;source_snapshot_hash:string;environment:"preview"|"live";status:"draft"|"approved"|"published"|"rolled_back";route_manifest:readonly string[];created_at:string};
const req=(v:unknown,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x;};
function safeRoute(value:unknown):string {
 const route=req(value,"route");
 if(route.length>2048||!route.startsWith("/")||route.startsWith("//")||/[?#\\\u0000-\u001f\u007f]/.test(route))throw new Error("route-invalid");
 let segments:string[];
 try{segments=route.split("/").map(decodeURIComponent);}catch{throw new Error("route-invalid");}
 if(segments.some(segment=>segment==="."||segment===".."||segment.includes("/")||segment.includes("\\")))throw new Error("route-invalid");
 return route;
}
function assertNoCredentialUrls(value:unknown):void {
 const visit=(item:unknown)=>{
  if(typeof item==="string"){
   if(/https?:\/\/[^/\s?#:@]+:[^@\s/?#]*@/i.test(item))throw new Error("brand-renderer-credential-url-denied");
   for(const candidate of item.match(/https?:\/\/[^\s"'<>]+/gi)??[]){
    try{
     const url=new URL(candidate);
     if(url.username||url.password||[...url.searchParams.keys()].some(key=>/^(?:access|refresh)?token$|^(?:api|client|private)(?:key|secret)$|^(?:password|passwd|authorization|auth)$/i.test(key.replace(/[-_.]/g,""))))throw new Error("brand-renderer-credential-url-denied");
    }catch(error){if(error instanceof Error&&error.message==="brand-renderer-credential-url-denied")throw error;}
   }
   return;
  }
  if(Array.isArray(item)){for(const child of item)visit(child);return;}
  if(item&&typeof item==="object")for(const child of Object.values(item as Record<string,unknown>))visit(child);
 };
 visit(value);
}
export function createBrandPublication(input:{publication_id:string;company_id:string;site_id:string;version:number;source_snapshot_hash:string;environment?:BrandPublication["environment"];status?:BrandPublication["status"];route_manifest:string[];created_at?:string}):BrandPublication{
 const created_at=input.created_at??new Date().toISOString(); if(!Number.isFinite(Date.parse(created_at)))throw new Error("created_at-invalid"); if(!Number.isInteger(input.version)||input.version<1)throw new Error("version-invalid");
 const environment=input.environment??"preview",status=input.status??"draft";
 if(environment!=="preview"&&environment!=="live")throw new Error("environment-invalid");
 if(!["draft","approved","published","rolled_back"].includes(status))throw new Error("status-invalid");
 const routes=[...new Set(input.route_manifest.map(safeRoute))]; if(!routes.length)throw new Error("route-manifest-required");
 if(environment==="live"&&status!=="approved"&&status!=="published")throw new Error("live-publication-not-approved");
 return Object.freeze({schema:"titan.brand-publication.v1",publication_id:req(input.publication_id,"publication_id"),company_id:req(input.company_id,"company_id"),site_id:req(input.site_id,"site_id"),version:input.version,source_snapshot_hash:req(input.source_snapshot_hash,"source_snapshot_hash"),environment,status,route_manifest:Object.freeze(routes),created_at});
}
export function promoteBrandPublication(publication:BrandPublication,input:{company_id:string;approved_snapshot_hash:string;now?:string}):BrandPublication{
 if(publication.company_id!==req(input.company_id,"company_id"))throw new Error("publication-company-mismatch"); if(publication.status!=="approved")throw new Error("publication-approval-required"); if(publication.source_snapshot_hash!==req(input.approved_snapshot_hash,"approved_snapshot_hash"))throw new Error("publication-snapshot-mismatch");
 return Object.freeze({...publication,environment:"live",status:"published",created_at:input.now??publication.created_at});
}
export type BrandRollbackIntent=Readonly<{schema:"titan.brand-rollback-intent/v1";company_id:string;site_id:string;source_publication_id:string;source_version:number;target_publication_id:string;target_version:number;target_snapshot_hash:string;target_routes:readonly string[];idempotency_key:string;surface_intent:SurfaceIntent;state:"proposed";authority_granted:false}>;
export async function computeBrandRollbackIdempotencyKey(input:{company_id:string;site_id:string;source_publication_id:string;source_version:number;target_publication_id:string;target_version:number;target_snapshot_hash:string}):Promise<string> {
 const company_id=req(input.company_id,"company_id"),site_id=req(input.site_id,"site_id"),source_publication_id=req(input.source_publication_id,"source_publication_id"),target_publication_id=req(input.target_publication_id,"target_publication_id"),target_snapshot_hash=req(input.target_snapshot_hash,"target_snapshot_hash");
 if(!Number.isInteger(input.source_version)||!Number.isInteger(input.target_version)||input.target_version<1||input.target_version>=input.source_version)throw new Error("rollback-version-invalid");
 const identity=JSON.stringify(["titan.brand-rollback-intent/v1",company_id,site_id,source_publication_id,input.source_version,target_publication_id,input.target_version,target_snapshot_hash]);
 const digest=new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity)));
 return `sha256:${[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("")}`;
}
/** Describes a rollback request for the canonical deployment/execution owner.
 * This function does not mutate publication state or claim the provider changed. */
export async function createBrandRollbackIntent(currentValue:unknown,targetValue:unknown):Promise<BrandRollbackIntent> {
 if(!record(currentValue)||!record(targetValue))throw new Error("rollback-publication-invalid");
 const company_id=req(currentValue.company_id,"company_id");
 const current=normalizeBrandPublication(currentValue,company_id),target=normalizeBrandPublication(targetValue,company_id);
 if(current.site_id!==target.site_id)throw new Error("rollback-scope-mismatch");
 if(current.status!=="published"||current.environment!=="live")throw new Error("published-publication-required");
 if(target.status!=="published"||target.environment!=="live")throw new Error("known-good-publication-required");
 if(target.version>=current.version)throw new Error("rollback-target-not-older");
 const idempotency_key=await computeBrandRollbackIdempotencyKey({company_id,site_id:current.site_id,source_publication_id:current.publication_id,source_version:current.version,target_publication_id:target.publication_id,target_version:target.version,target_snapshot_hash:target.source_snapshot_hash});
 return Object.freeze({schema:"titan.brand-rollback-intent/v1",company_id,site_id:current.site_id,source_publication_id:current.publication_id,source_version:current.version,target_publication_id:target.publication_id,target_version:target.version,target_snapshot_hash:target.source_snapshot_hash,target_routes:target.route_manifest,idempotency_key,surface_intent:createSurfaceIntent(company_id,current.site_id,"rollback"),state:"proposed",authority_granted:false});
}

export type BrandStudioProjection=Readonly<{schema:"titan.brand-studio.projection/v1";company_id:string;generated_at:string;surfaces:readonly SurfaceDescriptor[];publications:readonly BrandPublication[];authorityGranted:false}>;
const publicationStatuses=new Set<BrandPublication["status"]>(["draft","approved","published","rolled_back"]);
function normalizeBrandPublication(value:unknown,company_id:string):BrandPublication {
 if(!record(value))throw new Error("brand-studio-publication-invalid");
 const allowed=["schema","publication_id","company_id","site_id","version","source_snapshot_hash","environment","status","route_manifest","created_at"];
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error("brand-studio-unknown-field");
 if(value.schema!=="titan.brand-publication.v1")throw new Error("brand-studio-publication-schema-unsupported");
 if(value.company_id!==company_id)throw new Error("publication-company-mismatch");
 if(!Number.isInteger(value.version)||Number(value.version)<1||!['preview','live'].includes(String(value.environment))||!publicationStatuses.has(value.status as BrandPublication["status"]))throw new Error("brand-studio-publication-invalid");
 if(!Array.isArray(value.route_manifest)||value.route_manifest.length===0)throw new Error("brand-studio-publication-invalid");
 if(value.route_manifest.length>256)throw new Error("brand-studio-publication-invalid");
 const routes=value.route_manifest.map(safeRoute);if(new Set(routes).size!==routes.length)throw new Error("brand-studio-publication-invalid");
 const created_at=req(value.created_at,"created_at");if(!Number.isFinite(Date.parse(created_at)))throw new Error("created_at-invalid");
 for(const key of ["publication_id","site_id","source_snapshot_hash"])if(req(value[key],key).length>2048)throw new Error("brand-studio-publication-invalid");
 return Object.freeze({...value,route_manifest:Object.freeze(routes)}) as unknown as BrandPublication;
}
function normalizeBrandSurface(value:unknown):SurfaceDescriptor {
 if(!record(value))throw new Error("brand-studio-surface-invalid");
 const allowed=["surface_id","company_id","surface_class","product_mode","audience","renderer","runtime","version","route","capabilities","lifecycle","state","health","provenance_ref","authorityGranted","temporary"];
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error("brand-studio-unknown-field");
 for(const key of ["surface_id","company_id","audience","renderer","runtime","version","provenance_ref"])if(req(value[key],key).length>2048)throw new Error("brand-studio-surface-invalid");
 if(!["CANONICAL_PRODUCT","WORKSPACE","PORTAL","PUBLIC_WEB","EMBED","GENERATED_APP","TEMPORARY_MISSION","HOST_COCKPIT","DEVICE_CLIENT","KIOSK","PUBLIC_SHARE"].includes(String(value.surface_class)))throw new Error("surface-class-invalid");
 if(!["UNKNOWN","DECLARED","DRAFT","STAGED","LIVE","DEGRADED","UNREACHABLE","RETIRED"].includes(String(value.state)))throw new Error("surface-state-invalid");
 if(!["DRAFT","VALIDATE","PREVIEW","STAGE","VERIFY","PROMOTE","LIVE","DEGRADE","DISABLE","ROLLBACK","RETIRE"].includes(String(value.lifecycle)))throw new Error("surface-lifecycle-invalid");
 if(value.authorityGranted!==false||!Array.isArray(value.capabilities)||value.capabilities.length>100||value.capabilities.some(x=>typeof x!=="string"||x.length>256))throw new Error("brand-studio-surface-invalid");
 if(value.route!==undefined)safeRoute(value.route);
 const health=value.health;if(!record(health))throw new Error("brand-studio-surface-invalid");
 const healthKeys=["uiReachable","backendReachable","capabilityDegraded","staleProjection","verificationFailed"];
 if(Object.keys(health).length!==healthKeys.length||healthKeys.some(key=>typeof health[key]!=="boolean"))throw new Error("brand-studio-surface-invalid");
 if(value.temporary!==undefined){
  if(!record(value.temporary)||Object.keys(value.temporary).some(key=>!["expires_at","end_condition"].includes(key))||!Number.isFinite(Date.parse(String(value.temporary.expires_at)))||!String(value.temporary.end_condition??"").trim())throw new Error("brand-studio-temporary-invalid");
 }
 if(value.surface_class==="TEMPORARY_MISSION"&&value.temporary===undefined)throw new Error("brand-studio-temporary-invalid");
 return value as unknown as SurfaceDescriptor;
}
export function createBrandStudioProjection(input:{company_id:string;generated_at:string;surfaces:readonly SurfaceDescriptor[];publications:readonly BrandPublication[];deployed?:Readonly<Record<string,{version:string;state:SurfaceDescriptor["state"];uiReachable:boolean;backendReachable:boolean}>>;now?:string}):BrandStudioProjection {
 const company_id=req(input.company_id,"company_id");const generated_at=req(input.generated_at,"generated_at");
 if(!Number.isFinite(Date.parse(generated_at)))throw new Error("brand-studio-generated-at-invalid");
 if(input.surfaces.length>500||input.publications.length>2000)throw new Error("brand-studio-projection-limit");
 const descriptors=input.surfaces.map(normalizeBrandSurface);
 const estate=projectSurfaceEstate({company_id,descriptors,deployed:input.deployed,now:input.now});
 const surfaces=estate.filter(surface=>["PUBLIC_WEB","PORTAL","PUBLIC_SHARE","EMBED"].includes(surface.surface_class)||
  (surface.surface_class==="TEMPORARY_MISSION"&&["microweber","wordpress","titan-static"].includes(surface.renderer)));
 const publications=input.publications.map(value=>normalizeBrandPublication(value,company_id));
 const ids=new Set<string>(),versions=new Set<string>();for(const publication of publications){if(ids.has(publication.publication_id))throw new Error("brand-studio-duplicate-publication");ids.add(publication.publication_id);const key=JSON.stringify([publication.site_id,publication.version]);if(versions.has(key))throw new Error("brand-studio-duplicate-version");versions.add(key);}
 return Object.freeze({schema:"titan.brand-studio.projection/v1",company_id,generated_at,surfaces:Object.freeze([...surfaces]),publications:Object.freeze(publications.sort((a,b)=>a.site_id.localeCompare(b.site_id)||b.version-a.version)),authorityGranted:false});
}
export function assertBrandStudioProjection(value:unknown,company_id:string):BrandStudioProjection {
 if(!record(value))throw new Error("brand-studio-projection-invalid");
 const allowed=["schema","company_id","generated_at","surfaces","publications","authorityGranted"];
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error("brand-studio-unknown-field");
 if(value.schema!=="titan.brand-studio.projection/v1")throw new Error("brand-studio-schema-unsupported");
 if(value.company_id!==company_id)throw new Error("brand-studio-company-mismatch");
 if(value.authorityGranted!==false)throw new Error("brand-studio-authority-denied");
 if(!Array.isArray(value.surfaces)||!Array.isArray(value.publications))throw new Error("brand-studio-projection-invalid");
 const surfaces=value.surfaces.map(normalizeBrandSurface),surfaceIds=new Set<string>();
 for(const surface of surfaces){if(surface.company_id!==company_id)throw new Error("brand-studio-company-mismatch");if(surfaceIds.has(surface.surface_id))throw new Error("brand-studio-duplicate-surface");surfaceIds.add(surface.surface_id);}
 const publications=value.publications.map(publication=>normalizeBrandPublication(publication,company_id));
 const publicationIds=new Set<string>(),versions=new Set<string>();
 for(const publication of publications){if(publicationIds.has(publication.publication_id))throw new Error("brand-studio-duplicate-publication");publicationIds.add(publication.publication_id);const key=JSON.stringify([publication.site_id,publication.version]);if(versions.has(key))throw new Error("brand-studio-duplicate-version");versions.add(key);}
 const generated_at=req(value.generated_at,"generated_at");if(!Number.isFinite(Date.parse(generated_at)))throw new Error("brand-studio-generated-at-invalid");
 return Object.freeze({schema:"titan.brand-studio.projection/v1",company_id,generated_at,surfaces:Object.freeze(surfaces),publications:Object.freeze(publications.sort((a,b)=>a.site_id.localeCompare(b.site_id)||b.version-a.version)),authorityGranted:false});
}
/** Produces plain text for UI sinks; consumers must still render it as text, never HTML. */
export function summarizeBrandStudioProjection(value:unknown,company_id:string):string {
 const projection=assertBrandStudioProjection(value,company_id);
 const live=projection.surfaces.filter(surface=>surface.state==="LIVE").length;
 const needsAttention=projection.surfaces.filter(surface=>["DEGRADED","UNREACHABLE"].includes(surface.state)||surface.health.capabilityDegraded||surface.health.staleProjection||surface.health.verificationFailed).length;
 const awaitingVerification=projection.surfaces.filter(surface=>["UNKNOWN","DECLARED","DRAFT","STAGED"].includes(surface.state)).length;
 const shown=projection.surfaces.slice(0,8).map(surface=>
  `${surface.surface_id} (${surface.renderer} v${surface.version}, ${surface.state})${surface.route?` ${surface.route}`:""}`);
 const remaining=projection.surfaces.length-shown.length;
 const surfaces=shown.length?`; ${shown.join("; ")}${remaining?`; and ${remaining} more`:""}`:"";
 const publication=projection.publications[0];
 const latest=publication?`; Publication ${publication.publication_id}: ${publication.status} (${publication.environment}), version ${publication.version}`:"";
 return `${projection.surfaces.length} web surfaces; ${projection.publications.length} publication${projection.publications.length===1?"":"s"}; ${live} live; ${needsAttention} needs attention; ${awaitingVerification} awaiting verification${surfaces}${latest}`;
}

export type BrandActionBinding=Readonly<{schema:"titan.brand-action-binding/v1";action_id:string;capability_id:string;context_schema:string;required_context:readonly string[];entitlement:string;risk_class:"read_only"|"reversible"|"consequential"|"restricted";offline_behavior:"deny"|"read_only"|"queue_for_revalidation";public_behavior:"unavailable"|"guest_scoped"|"authenticated_only";fallback:string;accessibility:Readonly<{keyboard:boolean;screen_reader_label:string;reduced_motion:boolean}>;evidence_requirements:readonly string[];authority_granted:false}>;
/** Declarative UX contract only: all entitlement and execution decisions stay with canonical owners. */
export function createBrandActionBinding(value:unknown):BrandActionBinding {
 if(!record(value))throw new Error("brand-action-binding-invalid");
 const allowed=["schema","action_id","capability_id","context_schema","required_context","entitlement","risk_class","offline_behavior","public_behavior","fallback","accessibility","evidence_requirements","authority_granted"];
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error("brand-action-binding-unknown-field");
 if(value.schema!=="titan.brand-action-binding/v1")throw new Error("brand-action-binding-schema-unsupported");
 if(value.authority_granted!==false)throw new Error("brand-action-binding-authority-denied");
 for(const key of ["action_id","capability_id","context_schema","entitlement","fallback"])if(req(value[key],key).length>256)throw new Error("brand-action-binding-invalid");
 if(!Array.isArray(value.required_context)||value.required_context.length===0||value.required_context.length>32||value.required_context.some(item=>typeof item!=="string"||!/^[a-z][a-z0-9_.-]{0,63}$/.test(item))||new Set(value.required_context).size!==value.required_context.length)throw new Error("brand-action-binding-context-invalid");
 if(!["read_only","reversible","consequential","restricted"].includes(String(value.risk_class)))throw new Error("brand-action-binding-risk-invalid");
 if(!["deny","read_only","queue_for_revalidation"].includes(String(value.offline_behavior)))throw new Error("brand-action-binding-offline-behavior-invalid");
 if(!["unavailable","guest_scoped","authenticated_only"].includes(String(value.public_behavior)))throw new Error("brand-action-binding-public-behavior-invalid");
 if(!record(value.accessibility)||Object.keys(value.accessibility).some(key=>!["keyboard","screen_reader_label","reduced_motion"].includes(key))||typeof value.accessibility.keyboard!=="boolean"||typeof value.accessibility.reduced_motion!=="boolean"||!String(value.accessibility.screen_reader_label??"").trim()||String(value.accessibility.screen_reader_label).length>256)throw new Error("brand-action-binding-accessibility-invalid");
 if(!Array.isArray(value.evidence_requirements)||value.evidence_requirements.length>64||value.evidence_requirements.some(item=>typeof item!=="string"||!item.trim()||item.length>256)||new Set(value.evidence_requirements).size!==value.evidence_requirements.length)throw new Error("brand-action-binding-evidence-invalid");
 return Object.freeze({...value,required_context:Object.freeze([...value.required_context]),accessibility:Object.freeze({...value.accessibility}),evidence_requirements:Object.freeze([...value.evidence_requirements])}) as unknown as BrandActionBinding;
}

/** Routes authenticated cockpit actions to the canonical intent owner; it never executes locally. */
export async function submitBrandStudioActionIntent(input:{session:{intent:(plugin:"titan_web",intent:Readonly<Record<string,unknown>>)=>Promise<unknown>};module_id:BrandModuleId;binding:BrandActionBinding;context:InterfaceContext;operation_id:string;correlation_id:string;payload:Record<string,unknown>}):Promise<unknown> {
 if(!record(input)||!input.session||typeof input.session.intent!=="function")throw new Error("brand-action-session-invalid");
 if(!(BRAND_MODULE_IDS as readonly string[]).includes(input.module_id))throw new Error("brand-module-unsupported");
 const binding=createBrandActionBinding(input.binding);
 if(binding.public_behavior!=="authenticated_only")throw new Error("brand-action-authenticated-only-required");
 const context=input.context;
 if(!record(context)||typeof context.company_id!=="string"||!context.company_id||typeof context.user_id!=="string"||!context.user_id)throw new Error("brand-action-context-invalid");
 const capabilities=context.capabilities;
 if(!Array.isArray(capabilities)||(!capabilities.includes(binding.capability_id)&&!capabilities.includes("*")))throw new Error("brand-action-capability-unavailable");
 for(const key of binding.required_context)if(!Object.hasOwn(context,key)||context[key]==null)throw new Error("brand-action-context-incomplete");
 const validId=(value:unknown)=>typeof value==="string"&&!!value.trim()&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
 if(!validId(input.operation_id)||!validId(input.correlation_id))throw new Error("brand-action-id-invalid");
 if(!record(input.payload))throw new Error("brand-action-payload-invalid");
 const safePayload=sanitizeBuilderProjection(input.payload);
 if(JSON.stringify(safePayload)!==JSON.stringify(input.payload))throw new Error("brand-action-payload-sensitive");
 return input.session.intent("titan_web",{company_id:context.company_id,actor_id:context.user_id,capability_id:binding.capability_id,operation_id:input.operation_id,correlation_id:input.correlation_id,input:{module_id:input.module_id,action_id:binding.action_id,payload:safePayload}});
}

export type BrandRendererRequest=Readonly<{
 schema:"titan.brand-renderer-request/v1";
 company_id:string;
 publication_id:string;
 idempotency_key:string;
 site_id:string;
 version:number;
 renderer:"microweber"|"wordpress";
 environment:"preview"|"live";
 routes:readonly string[];
 source:Readonly<{builder_document_id:string;revision:number;snapshot_hash:string;document:BuilderDocument}>;
 approval:BrandPublicationApproval|null;
 authority_granted:false;
}>;
export type MicroweberPageDraft=Readonly<{
 schema:"titan.microweber-page-draft/v1";company_id:string;publication_id:string;site_id:string;version:number;
 route:string;title:string;content_html:string;source_snapshot_hash:string;authority_granted:false;
}>;
const escapeHtml=(value:string)=>value.replace(/[&<>\"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[char]!));
function renderMicroweberNode(node:BuilderNode,depth=0,state={count:0}):string {
 if(depth>32||++state.count>500)throw new Error("microweber-page-complexity-limit");
 if(!node||typeof node.id!=="string"||typeof node.type!=="string"||!Array.isArray(node.children??[]))throw new Error("microweber-builder-node-invalid");
 if(node.actions?.length)throw new Error("microweber-governed-action-binding-required");
 const props=node.props??{};
 const text=(key:string,fallback="")=>{const value=props[key]??fallback;if(typeof value!=="string")throw new Error("microweber-static-text-invalid");return escapeHtml(value);};
 const children=(node.children??[]).map(child=>renderMicroweberNode(child,depth+1,state)).join("");
 switch(node.type){
  case "stack":return `<div>${children}</div>`;
  case "grid":return `<div class=\"titan-grid\">${children}</div>`;
  case "card":return `<section>${children}</section>`;
  case "heading":return `<h2>${text("text",String(props.title??props.label??""))}${children}</h2>`;
  case "text":return `<p>${text("text",String(props.content??props.label??""))}${children}</p>`;
  case "article-header":return `<header><h1>${text("title",String(props.text??""))}</h1>${children}</header>`;
  case "article-body":return `<div>${text("text",String(props.content??""))}${children}</div>`;
  case "image":{
   const src=props.src,alt=props.alt??"";
   if(typeof src!=="string"||!src.startsWith("/")||src.startsWith("//")||src.length>2048||/[\u0000-\u0020\\]/.test(src)||typeof alt!=="string")throw new Error("microweber-image-source-invalid");
   try{safeRoute(src);}catch{throw new Error("microweber-image-source-invalid");}
   return `<img src=\"${escapeHtml(src)}\" alt=\"${escapeHtml(alt)}\" loading=\"lazy\">`;
  }
  case "button":{
   const href=props.href;
   if(typeof href!=="string"||!href.trim())throw new Error("microweber-static-link-required");
   if(href.length>2048||/[\u0000-\u0020\\]/.test(href)||href.startsWith("//"))throw new Error("microweber-static-link-invalid");
   if(href.startsWith("/") )safeRoute(href);
   else {let url:URL;try{url=new URL(href);}catch{throw new Error("microweber-static-link-invalid");}if(!["https:","mailto:"].includes(url.protocol)||url.username||url.password)throw new Error("microweber-static-link-invalid");}
   return `<a href=\"${escapeHtml(href)}\">${text("label",String(props.text??props.title??"Continue"))}${children}</a>`;
  }
  default:throw new Error("microweber-builder-component-unsupported");
 }
}
/** Converts the deliberately small static Builder vocabulary to CMS page content.
 * Interactive Titan modules/actions require their separately governed module bridge. */
export async function compileMicroweberPageDraft(value:unknown,verification:{verifyApproval?:(approval:BrandPublicationApproval,snapshot:BuilderDocument)=>Promise<boolean>;verifyCurrentSnapshot:BrandSnapshotCurrentVerifier}):Promise<MicroweberPageDraft> {
 const request=await assertBrandRendererRequest(value,verification.verifyApproval,verification.verifyCurrentSnapshot);
 if(request.renderer!=="microweber")throw new Error("microweber-renderer-request-required");
 if(request.routes.length!==1)throw new Error("microweber-single-route-snapshot-required");
 const document=request.source.document;
 if(document.company_id!==request.company_id)throw new Error("microweber-company-mismatch");
 const route=safeRoute(request.routes[0]);
 const title=String(document.title??"").trim();
 if(!title||title.length>512||/[\u0000-\u001f\u007f]/.test(title))throw new Error("microweber-page-title-invalid");
 const content_html=renderMicroweberNode(document.root);
 return Object.freeze({schema:"titan.microweber-page-draft/v1",company_id:request.company_id,publication_id:request.publication_id,site_id:request.site_id,version:request.version,route,title,content_html,source_snapshot_hash:request.source.snapshot_hash,authority_granted:false});
}
export type MicroweberSiteDraft=Readonly<{
 schema:"titan.microweber-site-draft/v1";company_id:string;publication_id:string;site_id:string;version:number;environment:"preview"|"live";
 routes:readonly string[];pages:readonly MicroweberPageDraft[];source_snapshot_hash:string;authority_granted:false;
}>;
/** Compiles a bounded set of independently verified Builder page snapshots into one deterministic site draft. */
export async function compileMicroweberSiteDraft(values:readonly unknown[],verification:{verifyApproval?:(approval:BrandPublicationApproval,snapshot:BuilderDocument)=>Promise<boolean>;verifyCurrentSnapshot:BrandSnapshotCurrentVerifier}):Promise<MicroweberSiteDraft> {
 if(!Array.isArray(values)||values.length===0||values.length>100)throw new Error("microweber-site-page-limit");
 const requests=await Promise.all(values.map(value=>assertBrandRendererRequest(value,verification.verifyApproval,verification.verifyCurrentSnapshot)));
 const first=requests[0];
 if(first.renderer!=="microweber")throw new Error("microweber-renderer-request-required");
 for(const request of requests){
  if(request.renderer!=="microweber"||request.company_id!==first.company_id||request.publication_id!==first.publication_id||request.site_id!==first.site_id||request.version!==first.version||request.environment!==first.environment)throw new Error("microweber-site-scope-mismatch");
 }
 const pages=(await Promise.all(requests.map(request=>compileMicroweberPageDraft(request,verification)))).sort((a,b)=>a.route.localeCompare(b.route));
 const routes=pages.map(page=>page.route);
 if(new Set(routes).size!==routes.length)throw new Error("microweber-site-duplicate-route");
 const identity=JSON.stringify(pages.map(page=>[page.route,page.title,page.content_html,page.source_snapshot_hash]));
 const digest=new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity)));
 const source_snapshot_hash=`sha256:${[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("")}`;
 return Object.freeze({schema:"titan.microweber-site-draft/v1",company_id:first.company_id,publication_id:first.publication_id,site_id:first.site_id,version:first.version,environment:first.environment,routes:Object.freeze(routes),pages:Object.freeze(pages),source_snapshot_hash,authority_granted:false});
}
export type MicroweberSitemapDraft=Readonly<{schema:"titan.microweber-seo-draft/v1";company_id:string;site_id:string;version:number;environment:"preview"|"live";sitemap_xml:string;robots_txt:string;authority_granted:false}>;
/** Derives safe crawl metadata from an already verified site draft; never writes or publishes it. */
export function createMicroweberSitemapDraft(value:unknown,canonical_origin:string):MicroweberSitemapDraft {
 if(!record(value)||Object.keys(value).some(key=>!["schema","company_id","publication_id","site_id","version","environment","routes","pages","source_snapshot_hash","authority_granted"].includes(key)))throw new Error("microweber-sitemap-site-invalid");
 if(value.schema!=="titan.microweber-site-draft/v1"||value.authority_granted!==false)throw new Error("microweber-sitemap-site-invalid");
 const company_id=req(value.company_id,"company_id"),site_id=req(value.site_id,"site_id");
 if(!Number.isInteger(value.version)||Number(value.version)<1||!["preview","live"].includes(String(value.environment)))throw new Error("microweber-sitemap-site-invalid");
 if(!Array.isArray(value.routes)||value.routes.length===0||value.routes.length>100||!Array.isArray(value.pages)||value.pages.length!==value.routes.length)throw new Error("microweber-sitemap-site-invalid");
 const routes=value.routes.map(safeRoute);
 if(new Set(routes).size!==routes.length)throw new Error("microweber-sitemap-duplicate-route");
 const pageRoutes=value.pages.map(page=>{
  if(!record(page))throw new Error("microweber-sitemap-site-invalid");
  if(page.company_id!==company_id)throw new Error("microweber-sitemap-company-mismatch");
  if(page.site_id!==site_id||page.publication_id!==value.publication_id||page.version!==value.version||page.authority_granted!==false)throw new Error("microweber-sitemap-site-invalid");
  return safeRoute(page.route);
 });
 if(pageRoutes.length!==routes.length||pageRoutes.some(route=>!routes.includes(route)))throw new Error("microweber-sitemap-site-invalid");
 if(typeof canonical_origin!=="string")throw new Error("microweber-sitemap-origin-invalid");
 let origin:URL;
 try{origin=new URL(canonical_origin);}catch{throw new Error("microweber-sitemap-origin-invalid");}
 if(origin.protocol!=="https:"||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error("microweber-sitemap-origin-invalid");
 const environment=value.environment as "preview"|"live";
 const sitemap_xml=environment==="preview"?"":`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.slice().sort().map(route=>`<url><loc>${escapeHtml(new URL(route,origin).href)}</loc></url>`).join("")}</urlset>`;
 const robots_txt=environment==="preview"?"User-agent: *\nDisallow: /\n":`User-agent: *\nAllow: /\nSitemap: ${origin.origin}/sitemap.xml\n`;
 return Object.freeze({schema:"titan.microweber-seo-draft/v1",company_id,site_id,version:Number(value.version),environment,sitemap_xml,robots_txt,authority_granted:false});
}
export type BrandPublicationApproval=Readonly<{company_id:string;builder_document_id:string;revision:number;snapshot_hash:string;approved_by:string;approved_at:string}>;
export type BrandSnapshotCurrentVerifier=(company_id:string,builder_document_id:string,revision:number,snapshot_hash:string)=>Promise<boolean>;
export async function computeBrandPublicationIdempotencyKey(input:{company_id:string;site_id:string;version:number;environment:"preview"|"live"}):Promise<string> {
 const company_id=req(input.company_id,"company_id"),site_id=req(input.site_id,"site_id");
 if(company_id.length>2048||site_id.length>2048)throw new Error("brand-renderer-identity-invalid");
 if(!Number.isInteger(input.version)||input.version<1)throw new Error("brand-renderer-version-invalid");
 if(input.environment!=="preview"&&input.environment!=="live")throw new Error("brand-renderer-environment-invalid");
 const identity=JSON.stringify([company_id,site_id,input.version,input.environment]);
 const digest=new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity)));
 return `sha256:${[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("")}`;
}
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype);
function canonicalize(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonicalize);
 if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));
 return value;
}
export async function computeBrandBuilderSnapshotHash(snapshot:BuilderDocument):Promise<string> {
 const sanitized=sanitizeBuilderProjection(snapshot);
 const bytes=new TextEncoder().encode(JSON.stringify(canonicalize(sanitized)));
 const digest=new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",bytes));
 return `sha256:${[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("")}`;
}
function exactKeys(value:Record<string,unknown>,allowed:readonly string[],required:readonly string[]):void {
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error("brand-renderer-unknown-field");
 if(required.some(key=>!Object.hasOwn(value,key)))throw new Error("brand-renderer-field-required");
}
/** Runtime validation at the renderer/provider boundary; TypeScript types do not
 * validate JSON received from another process or a persisted queue. */
export async function assertBrandRendererRequest(value:unknown,verifyApproval?:(approval:BrandPublicationApproval,snapshot:BuilderDocument)=>Promise<boolean>,verifyCurrentSnapshot?:BrandSnapshotCurrentVerifier):Promise<BrandRendererRequest> {
 if(!record(value))throw new Error("brand-renderer-request-invalid");
 if(value.schema!=="titan.brand-renderer-request/v1")throw new Error("brand-renderer-schema-unsupported");
 exactKeys(value,["schema","company_id","publication_id","idempotency_key","site_id","version","renderer","environment","routes","source","approval","authority_granted"],["schema","company_id","publication_id","idempotency_key","site_id","version","renderer","environment","routes","source","approval","authority_granted"]);
 if(value.authority_granted!==false)throw new Error("brand-renderer-authority-denied");
 if(value.renderer!=="microweber"&&value.renderer!=="wordpress")throw new Error("brand-renderer-renderer-unsupported");
 if(value.environment!=="preview"&&value.environment!=="live")throw new Error("brand-renderer-environment-invalid");
 for(const key of ["company_id","publication_id","site_id"])req(value[key],key);
 if(!Number.isInteger(value.version)||Number(value.version)<1)throw new Error("brand-renderer-version-invalid");
 if(!Array.isArray(value.routes)||value.routes.length===0)throw new Error("brand-renderer-routes-invalid");
 const routes=value.routes.map(safeRoute);if(new Set(routes).size!==routes.length)throw new Error("brand-renderer-routes-invalid");
 if(!record(value.source))throw new Error("brand-renderer-source-invalid");
 exactKeys(value.source,["builder_document_id","revision","snapshot_hash","document"],["builder_document_id","revision","snapshot_hash","document"]);
 if(!record(value.source.document))throw new Error("brand-renderer-document-invalid");
 exactKeys(value.source.document,["id","company_id","surface","title","root","revision","status","updated_at"],["id","company_id","surface","title","root","revision","status","updated_at"]);
 const document=value.source.document as unknown as BuilderDocument;
 if(value.source.document.company_id!==value.company_id)throw new Error("brand-renderer-company-mismatch");
 const sanitizedDocument=sanitizeBuilderProjection(document) as BuilderDocument;
 if(JSON.stringify(canonicalize(sanitizedDocument))!==JSON.stringify(canonicalize(document)))throw new Error("brand-renderer-document-unsanitized");
 assertNoCredentialUrls(document);
 if(value.idempotency_key!==await computeBrandPublicationIdempotencyKey({company_id:String(value.company_id),site_id:String(value.site_id),version:Number(value.version),environment:value.environment}))throw new Error("brand-renderer-idempotency-key-mismatch");
 if(value.source.builder_document_id!==document.id||value.source.revision!==document.revision||typeof value.source.snapshot_hash!=="string"||!value.source.snapshot_hash.trim())throw new Error("brand-renderer-source-mismatch");
 assertBuilderSecurityGate(document,{company_id:String(value.company_id),surface:document.surface});
 if(value.source.snapshot_hash!==await computeBrandBuilderSnapshotHash(document))throw new Error("brand-renderer-snapshot-hash-mismatch");
 if(!verifyCurrentSnapshot)throw new Error("brand-renderer-snapshot-verifier-required");
 if(!await verifyCurrentSnapshot(String(value.company_id),document.id,document.revision,String(value.source.snapshot_hash)))throw new Error("brand-renderer-snapshot-stale");
 if(value.environment==="live"){
  if(!record(value.approval))throw new Error("brand-renderer-approval-required");
  exactKeys(value.approval,["company_id","builder_document_id","revision","snapshot_hash","approved_by","approved_at"],["company_id","builder_document_id","revision","snapshot_hash","approved_by","approved_at"]);
  const approval=value.approval;
  if(approval.company_id!==value.company_id||approval.builder_document_id!==document.id||approval.revision!==document.revision||approval.snapshot_hash!==value.source.snapshot_hash||!String(approval.approved_by??"").trim()||!Number.isFinite(Date.parse(String(approval.approved_at))))throw new Error("brand-renderer-approval-mismatch");
  if(!verifyApproval)throw new Error("brand-renderer-approval-verifier-required");
  if(!await verifyApproval(approval as unknown as BrandPublicationApproval,document))throw new Error("brand-renderer-approval-denied");
 }else if(value.approval!==null)throw new Error("brand-renderer-preview-approval-invalid");
 return value as unknown as BrandRendererRequest;
}

/** Creates a declarative provider handoff and Surface Manager descriptor from an
 * already-authored Builder snapshot. It does not publish, provision, or grant authority. */
export async function createBrandRendererHandoff(input:{
 company_id:string;publication_id:string;site_id:string;version:number;source_snapshot_hash:string;
 renderer:"microweber"|"wordpress";environment:"preview"|"live";route_manifest:string[];snapshot:BuilderDocument;approval?:BrandPublicationApproval;
 verifyApproval?:(approval:BrandPublicationApproval,snapshot:BuilderDocument)=>Promise<boolean>;
 verifyCurrentSnapshot?:BrandSnapshotCurrentVerifier;
}):Promise<Readonly<{publication:BrandPublication;provider_request:BrandRendererRequest;surface_descriptor:SurfaceDescriptor}>> {
 const company_id=req(input.company_id,"company_id");
 if(input.environment==="live"&&!input.approval)throw new Error("brand-renderer-approval-required");
 if(input.environment==="preview"&&input.approval)throw new Error("brand-renderer-preview-approval-invalid");
 if(input.snapshot.company_id!==company_id)throw new Error("builder-snapshot-company-mismatch");
 if(input.snapshot.revision<0||!Number.isInteger(input.snapshot.revision))throw new Error("builder-snapshot-revision-invalid");
 assertBuilderSecurityGate(input.snapshot,{company_id,surface:input.snapshot.surface});
 const document=sanitizeBuilderProjection(input.snapshot) as BuilderDocument;
 assertNoCredentialUrls(document);
 if(input.source_snapshot_hash!==await computeBrandBuilderSnapshotHash(input.snapshot))throw new Error("brand-renderer-snapshot-hash-mismatch");
 if(!input.verifyCurrentSnapshot)throw new Error("brand-renderer-snapshot-verifier-required");
 if(!await input.verifyCurrentSnapshot(company_id,input.snapshot.id,input.snapshot.revision,input.source_snapshot_hash))throw new Error("brand-renderer-snapshot-stale");
 if(input.approval&&(input.approval.company_id!==company_id||input.approval.builder_document_id!==input.snapshot.id||input.approval.revision!==input.snapshot.revision||input.approval.snapshot_hash!==input.source_snapshot_hash||!input.approval.approved_by.trim()||!Number.isFinite(Date.parse(input.approval.approved_at))))throw new Error("brand-renderer-approval-mismatch");
 if(input.environment==="live"){
  if(!input.verifyApproval)throw new Error("brand-renderer-approval-verifier-required");
  if(!await input.verifyApproval(input.approval!,input.snapshot))throw new Error("brand-renderer-approval-denied");
 }
 const publication=createBrandPublication({publication_id:input.publication_id,company_id,site_id:input.site_id,version:input.version,
  source_snapshot_hash:input.source_snapshot_hash,environment:input.environment,status:input.environment==="live"?"approved":"draft",route_manifest:input.route_manifest});
 const routes=publication.route_manifest;
 const provider_request:BrandRendererRequest=Object.freeze({schema:"titan.brand-renderer-request/v1",company_id,publication_id:publication.publication_id,
  idempotency_key:await computeBrandPublicationIdempotencyKey({company_id,site_id:publication.site_id,version:publication.version,environment:publication.environment}),
  site_id:publication.site_id,version:publication.version,renderer:input.renderer,environment:publication.environment,routes,
  source:Object.freeze({builder_document_id:input.snapshot.id,revision:input.snapshot.revision,snapshot_hash:publication.source_snapshot_hash,document}),approval:input.approval??null,authority_granted:false});
 await assertBrandRendererRequest(provider_request,input.verifyApproval,input.verifyCurrentSnapshot);
 const descriptor:SurfaceDescriptor=Object.freeze({surface_id:publication.site_id,company_id,surface_class:"PUBLIC_WEB",audience:"public",renderer:input.renderer,
  runtime:"titan-builder",version:String(publication.version),route:routes[0],capabilities:Object.freeze([]),lifecycle:input.environment==="live"?"PROMOTE":"PREVIEW",
  state:input.environment==="live"?"STAGED":"DRAFT",health:Object.freeze({uiReachable:false,backendReachable:false,capabilityDegraded:false,staleProjection:false,verificationFailed:false}),
  provenance_ref:publication.publication_id,authorityGranted:false});
 const [surface_descriptor]=projectSurfaceEstate({company_id,descriptors:[descriptor]});
 return Object.freeze({publication,provider_request,surface_descriptor});
}

export type BrandRendererObservation=Readonly<{company_id:string;site_id:string;version:number;snapshot_hash:string;environment:BrandPublication["environment"];routes:readonly string[];reachable:boolean}>;
export type BrandRendererReconciliation=Readonly<
 | {status:"pending";reason:"awaiting-provider-observation"}
 | {status:"degraded";reason:"provider-unavailable"|"provider-rejected"|"observed-publication-mismatch"|"renderer-unreachable"}
 | {status:"verified"}
>;

/** An accepted command is only an acknowledgement. Verification requires the
 * renderer's observed state to match this exact immutable publication. */
export function reconcileBrandRendererObservation(publication:BrandPublication,providerAck:unknown,observation:unknown):BrandRendererReconciliation {
 if(providerAck===null)return Object.freeze({status:"degraded",reason:"provider-unavailable"});
 if(!record(providerAck)||Object.keys(providerAck).some(key=>key!=="accepted"&&key!=="unavailable")||typeof providerAck.accepted!=="boolean"||("unavailable" in providerAck&&typeof providerAck.unavailable!=="boolean"))return Object.freeze({status:"degraded",reason:"provider-rejected"});
 if(providerAck.unavailable===true)return Object.freeze({status:"degraded",reason:"provider-unavailable"});
 if(providerAck.accepted!==true)return Object.freeze({status:"degraded",reason:"provider-rejected"});
 if(!observation)return Object.freeze({status:"pending",reason:"awaiting-provider-observation"});
 const observationKeys=["company_id","site_id","version","snapshot_hash","environment","routes","reachable"];
 if(!record(observation)||Object.keys(observation).some(key=>!observationKeys.includes(key))||observationKeys.some(key=>!Object.hasOwn(observation,key))||typeof observation.company_id!=="string"||typeof observation.site_id!=="string"||!Number.isInteger(observation.version)||typeof observation.snapshot_hash!=="string"||(observation.environment!=="preview"&&observation.environment!=="live")||!Array.isArray(observation.routes)||observation.routes.some(route=>typeof route!=="string")||typeof observation.reachable!=="boolean")return Object.freeze({status:"degraded",reason:"observed-publication-mismatch"});
 if(observation.company_id!==publication.company_id||observation.site_id!==publication.site_id||observation.version!==publication.version||observation.environment!==publication.environment||
    observation.snapshot_hash!==publication.source_snapshot_hash||JSON.stringify([...observation.routes].sort())!==JSON.stringify([...publication.route_manifest].sort())) {
  return Object.freeze({status:"degraded",reason:"observed-publication-mismatch"});
 }
 if(!observation.reachable)return Object.freeze({status:"degraded",reason:"renderer-unreachable"});
 return Object.freeze({status:"verified"});
}

/** Verifies the known-good publication after a delegated rollback request.
 * An ACK alone remains pending; this never mutates publication or release state. */
export async function reconcileBrandRollbackObservation(intent:BrandRollbackIntent,providerAck:unknown,observation:unknown):Promise<BrandRendererReconciliation> {
 try {
  if(!record(intent))throw new Error("rollback-intent-invalid");
  exactKeys(intent,["schema","company_id","site_id","source_publication_id","source_version","target_publication_id","target_version","target_snapshot_hash","target_routes","idempotency_key","surface_intent","state","authority_granted"],["schema","company_id","site_id","source_publication_id","source_version","target_publication_id","target_version","target_snapshot_hash","target_routes","idempotency_key","surface_intent","state","authority_granted"]);
  if(intent.schema!=="titan.brand-rollback-intent/v1"||intent.state!=="proposed"||intent.authority_granted!==false||
     typeof intent.company_id!=="string"||!intent.company_id.trim()||typeof intent.site_id!=="string"||!intent.site_id.trim()||
     !Number.isInteger(intent.source_version)||!Number.isInteger(intent.target_version)||Number(intent.target_version)<1||Number(intent.target_version)>=Number(intent.source_version)||
     typeof intent.source_publication_id!=="string"||!intent.source_publication_id.trim()||typeof intent.target_publication_id!=="string"||!intent.target_publication_id.trim()||
     typeof intent.target_snapshot_hash!=="string"||!intent.target_snapshot_hash.trim()||!Array.isArray(intent.target_routes)||intent.target_routes.length===0||typeof intent.idempotency_key!=="string")throw new Error("rollback-intent-invalid");
  const expectedKey=await computeBrandRollbackIdempotencyKey({company_id:intent.company_id,site_id:intent.site_id,source_publication_id:intent.source_publication_id,source_version:Number(intent.source_version),target_publication_id:intent.target_publication_id,target_version:Number(intent.target_version),target_snapshot_hash:intent.target_snapshot_hash});
  if(intent.idempotency_key!==expectedKey)throw new Error("rollback-idempotency-key-mismatch");
  const surface=intent.surface_intent;
  if(!record(surface))throw new Error("rollback-surface-intent-invalid");
  exactKeys(surface,["surface_id","company_id","intent","authorityGranted","delegated_to"],["surface_id","company_id","intent","authorityGranted","delegated_to"]);
  if(surface.surface_id!==intent.site_id||surface.company_id!==intent.company_id||surface.intent!=="rollback"||surface.authorityGranted!==false||surface.delegated_to!=="deployment-owner")throw new Error("rollback-surface-intent-invalid");
  const routes=intent.target_routes.map(safeRoute);
  if(new Set(routes).size!==routes.length)throw new Error("rollback-routes-invalid");
  const target:BrandPublication=Object.freeze({schema:"titan.brand-publication.v1",publication_id:intent.target_publication_id,company_id:intent.company_id,site_id:intent.site_id,version:Number(intent.target_version),source_snapshot_hash:intent.target_snapshot_hash,environment:"live",status:"published",route_manifest:Object.freeze(routes),created_at:"1970-01-01T00:00:00.000Z"});
  return reconcileBrandRendererObservation(target,providerAck,observation);
 }catch{
  return Object.freeze({status:"degraded",reason:"observed-publication-mismatch"});
 }
}

