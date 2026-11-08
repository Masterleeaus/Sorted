import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "visual-runtime";
export const RUNTIME_NAME = "Visual Runtime";
export const RUNTIME_KIND = "visual";
export const RUNTIME_PURPOSE = "Owns motion, transitions, visual treatments, assets and accessibility degradation; never changes business meaning.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;
export const VISUAL_TENANT_BOUNDARY = "company_id" as const;
export const SUPPORTED_VISUAL_SURFACES = Object.freeze(["zero", "go", "hub"] as const);

export type VisualSurface = (typeof SUPPORTED_VISUAL_SURFACES)[number];
export type VisualState = "idle" | "loading" | "streaming" | "success" | "warning" | "error" | "empty";
export type VisualEnvironment = Readonly<{
  surface: VisualSurface;
  deviceClass?: string;
  width?: number;
  devicePixelRatio?: number;
  webgl?: boolean;
  canvas?: boolean;
  lowPower?: boolean;
  connectivity?: string;
  memoryMb?: number | null;
  gpuTier?: string | null;
  company_id?: string | number | null;
}>;
export type VisualPreferences = Readonly<{
  reducedMotion?: boolean;
  highContrast?: boolean;
  textScale?: number;
  screenReader?: boolean;
}>;
export type VisualRequest = Readonly<{
  visualTreatment?: string;
  motionPreset?: string;
  transitionPreset?: string;
  visualCapabilityRequirements?: readonly string[];
  densityRules?: Readonly<Record<string, string>>;
  contrastRules?: Readonly<{ default?: string }>;
  fallback?: Readonly<{ treatment?: string }>;
  reducedMotionFallback?: Readonly<{ treatment?: string }>;
  company_id?: string | number | null;
  [key: string]: unknown;
}>;
export type VisualCapabilitySupport = Readonly<Record<string, boolean | ((environment: VisualEnvironment) => boolean)>>;
export type VisualNegotiation = Readonly<{ required: readonly string[]; available: readonly string[]; missing: readonly string[]; strategy: "preferred" | "fallback" }>;
export type VisualFallbackPlan = Readonly<{ treatment: string; reason: string; degraded: boolean }>;
export type VisualPlan = Readonly<{
  surface: VisualSurface;
  visualTreatment: string;
  motionPreset: string;
  transitionPreset: string;
  density: string;
  contrast: string;
  capabilities: VisualNegotiation;
  strategy: "preferred" | "fallback";
  fallback: VisualFallbackPlan;
  semantics_passthrough: true;
  business_meaning_unchanged: true;
  authorizes_actions: false;
  tenant_boundary: typeof VISUAL_TENANT_BOUNDARY;
  company_id: string | number | null;
  company_scope_inferred: false;
}>;

const CAPABILITY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VISUAL_ID = /^[a-z0-9][a-z0-9._-]{1,95}$/;
const VISUAL_STATES = new Set<VisualState>(["idle", "loading", "streaming", "success", "warning", "error", "empty"]);

function assertVisualId(value: string, label: string): string {
  if (!VISUAL_ID.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function assertCompanyBoundary(request: VisualRequest, environment: VisualEnvironment): void {
  const requestCompany = request.company_id;
  const environmentCompany = environment.company_id;
  if (requestCompany != null && environmentCompany != null && String(requestCompany) !== String(environmentCompany)) {
    throw new Error("Visual runtime company_id boundary mismatch.");
  }
}

export function createVisualRuntimeEnvelope(input: Record<string, unknown>) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_neutral: true, execution_authority: false, authority_conferred_by_activation: false });
}

export function negotiateVisualCapabilities(
  requirements: readonly string[] = [],
  environment: VisualEnvironment,
  support: VisualCapabilitySupport = {},
): VisualNegotiation {
  const required = [...new Set(requirements.filter((item): item is string => typeof item === "string" && item.length > 0))].sort();
  for (const capability of required) {
    if (!CAPABILITY_ID.test(capability)) throw new Error("Invalid visual capability identifier.");
  }
  const available: string[] = [];
  const missing: string[] = [];
  for (const capability of required) {
    const resolver = support[capability];
    const supported = typeof resolver === "function" ? resolver(environment) : resolver === true;
    (supported ? available : missing).push(capability);
  }
  return Object.freeze({ required: Object.freeze(required), available: Object.freeze(available), missing: Object.freeze(missing), strategy: missing.length === 0 ? "preferred" : "fallback" });
}

export function planVisualFallback(
  request: VisualRequest,
  environment: VisualEnvironment,
  preferences: VisualPreferences,
  negotiation: VisualNegotiation,
): VisualFallbackPlan {
  if (preferences.reducedMotion) return Object.freeze({ treatment: "semantic-static", reason: "reduced-motion", degraded: true });
  if (environment.lowPower) return Object.freeze({ treatment: "low-power-static", reason: "low-power", degraded: true });
  if (negotiation.missing.length > 0) return Object.freeze({ treatment: "semantic-static", reason: "missing-capability", degraded: true });
  if (environment.connectivity === "offline" && negotiation.required.includes("video")) return Object.freeze({ treatment: "offline-poster", reason: "offline-media", degraded: true });
  return Object.freeze({ treatment: request.fallback?.treatment ?? request.reducedMotionFallback?.treatment ?? "none", reason: "none", degraded: false });
}

export function planVisualRuntime(
  request: VisualRequest,
  environment: VisualEnvironment,
  preferences: VisualPreferences = {},
  support: VisualCapabilitySupport = {},
): VisualPlan {
  if (!SUPPORTED_VISUAL_SURFACES.includes(environment.surface)) throw new Error("Unsupported visual surface.");
  assertCompanyBoundary(request, environment);
  if (request.visualTreatment) assertVisualId(request.visualTreatment, "visual treatment id");
  const negotiation = negotiateVisualCapabilities(request.visualCapabilityRequirements ?? [], environment, support);
  let motionPreset = preferences.reducedMotion ? "none" : (request.motionPreset ?? "standard");
  if (environment.lowPower && motionPreset !== "none") motionPreset = "reduced";
  let transitionPreset = preferences.reducedMotion ? "none" : (request.transitionPreset ?? "crossfade");
  if (environment.lowPower && transitionPreset !== "none") transitionPreset = "crossfade";
  const fallback = planVisualFallback(request, environment, preferences, negotiation);
  const density = request.densityRules?.[environment.deviceClass ?? "unknown"] ?? ((environment.width ?? 0) > 0 && (environment.width ?? 0) < 600 ? "compact" : "comfortable");
  return Object.freeze({
    surface: environment.surface,
    visualTreatment: request.visualTreatment ?? "default",
    motionPreset,
    transitionPreset,
    density,
    contrast: preferences.highContrast ? "high" : (request.contrastRules?.default ?? "normal"),
    capabilities: negotiation,
    strategy: fallback.degraded ? "fallback" : negotiation.strategy,
    fallback,
    semantics_passthrough: true,
    business_meaning_unchanged: true,
    authorizes_actions: false,
    tenant_boundary: VISUAL_TENANT_BOUNDARY,
    company_id: environment.company_id ?? request.company_id ?? null,
    company_scope_inferred: false,
  });
}

export function planVisualStateTransition(from: VisualState, to: VisualState, environment: { reducedMotion?: boolean; lowPower?: boolean } = {}) {
  if (!VISUAL_STATES.has(from) || !VISUAL_STATES.has(to)) throw new Error("Unsupported visual state.");
  const motionPreset = environment.reducedMotion || environment.lowPower || from === to ? "none" : "state-change";
  return Object.freeze({ from, to, motionPreset, durationMs: motionPreset === "none" ? 0 : 180, businessMeaningChanged: false as const });
}

export type VisualContribution = Readonly<{ slot: string; provider: string; priority?: number; [key: string]: unknown }>;
export function resolveVisualContribution(slot: string, contributions: readonly VisualContribution[]): VisualContribution | null {
  const matches = contributions.filter((item) => item.slot === slot).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.provider.localeCompare(b.provider));
  if (matches.length === 0) return null;
  if (matches.length > 1 && (matches[0].priority ?? 0) === (matches[1].priority ?? 0) && matches[0].provider === matches[1].provider) {
    throw new Error("Ambiguous visual contribution ownership.");
  }
  return Object.freeze({ ...matches[0] });
}

export type VisualResource = Readonly<{ role: string; kind: "asset" | "icon" | "media"; uri: string; surface?: VisualSurface; company_id?: string | number | null; priority?: number }>;
export function resolveVisualResource(role: string, kind: VisualResource["kind"], environment: VisualEnvironment, resources: readonly VisualResource[]): VisualResource | null {
  const candidates = resources
    .filter((resource) => resource.role === role && resource.kind === kind)
    .filter((resource) => resource.surface == null || resource.surface === environment.surface)
    .filter((resource) => resource.company_id == null || (environment.company_id != null && String(resource.company_id) === String(environment.company_id)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.uri.localeCompare(b.uri));
  return candidates[0] ? Object.freeze({ ...candidates[0] }) : null;
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});

export const DEFAULT_VISUAL_CAPABILITIES = Object.freeze([
  "motion", "transitions", "svg", "images", "canvas", "webgl", "rich-charts", "camera-overlay",
  "audio-visualisation", "video", "spatial-3d", "high-dpi", "offline-assets",
] as const);

export function defaultVisualCapabilitySupport(environment: VisualEnvironment): Readonly<Record<string, boolean>> {
  const all = new Set<string>(DEFAULT_VISUAL_CAPABILITIES);
  const result: Record<string, boolean> = {};
  for (const capability of all) {
    result[capability] = capability === "webgl" || capability === "spatial-3d" ? environment.webgl === true && environment.lowPower !== true
      : capability === "canvas" ? environment.canvas === true
      : capability === "video" ? environment.connectivity !== "offline"
      : capability === "high-dpi" ? (environment.devicePixelRatio ?? 1) >= 1.5
      : true;
  }
  return Object.freeze(result);
}

export function planVisualCapabilityDegradation(preferred: readonly string[], available: readonly string[]) {
  const normalized = [...new Set(available.filter((value): value is string => typeof value === "string"))];
  for (const candidate of preferred) {
    if (typeof candidate === "string" && normalized.includes(candidate)) {
      return Object.freeze({ selected: candidate, degraded: candidate !== preferred[0], deterministic: true as const });
    }
  }
  return Object.freeze({ selected: "static", degraded: true, deterministic: true as const });
}

export const VISUAL_METADATA_CONTRACT_VERSION = "1.1" as const;
export const VISUAL_METADATA_SCHEMA_SHA256 = "38f0752dedb7578fde0eda36e7b145879a4fb8a27049664faecdd0b1afa10745" as const;
const FORBIDDEN_VISUAL_METADATA_KEYS = new Set(["script","javascript","html","css","eval","sql","credentials","credential","token","secret","rawurl","raw_url","permission","permissions","authorization","authorisation","entitlement","autonomy","risk","cost","privacy","capability","capabilities"]);
const EXECUTABLE_VISUAL_PAYLOAD = /(?:javascript:|<script|eval\s*\(|new\s+Function|data:text\/html|expression\s*\(|vbscript:)/i;

export function assertVisualMetadataCompatible(producerVersion: string, schemaSha256?: string): void {
  const match = /^(\d+)\.(\d+)$/.exec(producerVersion);
  if (!match || Number(match[1]) !== 1) throw new Error("Incompatible Builder visual metadata contract major version.");
  if (schemaSha256 != null && schemaSha256.toLowerCase() !== VISUAL_METADATA_SCHEMA_SHA256) throw new Error("Builder visual metadata schema fingerprint mismatch.");
}

export function validateVisualMetadata(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  let nodes = 0;
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > 32768) throw new Error("Visual metadata exceeds 32768 bytes.");
  const walk = (item: unknown, depth: number): void => {
    if (depth > 12) throw new Error("Visual metadata exceeds maximum nesting depth.");
    if (Array.isArray(item)) { for (const child of item) { nodes++; if (nodes > 1024) throw new Error("Visual metadata exceeds maximum node count."); walk(child, depth + 1); } return; }
    if (item != null && typeof item === "object") {
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        if (++nodes > 1024) throw new Error("Visual metadata exceeds maximum node count.");
        if (FORBIDDEN_VISUAL_METADATA_KEYS.has(key.toLowerCase())) throw new Error(`Forbidden visual metadata key: ${key}`);
        walk(child, depth + 1);
      }
      return;
    }
    if (typeof item === "string" && EXECUTABLE_VISUAL_PAYLOAD.test(item)) throw new Error("Executable visual payload rejected.");
  };
  walk(value, 0);
  return value;
}

export function negotiateVisualRuntimeCompatibility(consumer: Readonly<{ visual_metadata_contract?: string; surface?: string }>) {
  const contract = consumer.visual_metadata_contract ?? "1.0";
  const match = /^(\d+)\.(\d+)$/.exec(contract);
  if (!match) return Object.freeze({ compatible: false, reason: "invalid-contract-version" });
  if (Number(match[1]) !== 1) return Object.freeze({ compatible: false, reason: "unsupported-major" });
  if (consumer.surface && !SUPPORTED_VISUAL_SURFACES.includes(consumer.surface as VisualSurface)) return Object.freeze({ compatible: false, reason: "unsupported-surface" });
  return Object.freeze({ compatible: true, visual_metadata_contract: VISUAL_METADATA_CONTRACT_VERSION, canonical_surfaces: SUPPORTED_VISUAL_SURFACES, tenant_boundary: VISUAL_TENANT_BOUNDARY, company_scope_required_for_company_contributions: true, business_authority: false });
}

export type VisualCacheResource = Readonly<{ role: string; uri?: string | null; offlineUri?: string | null; sha256?: string | null; bytes?: number; offlineCritical?: boolean }>;
export function planVisualOfflineCache(resources: readonly VisualCacheResource[], environment: VisualEnvironment, budgetBytes = 52_428_800) {
  if (!Number.isFinite(budgetBytes) || budgetBytes < 0) throw new Error("Invalid visual cache budget.");
  const candidates = resources.filter((r) => r.role && (r.offlineCritical === true || ["offline", "poor"].includes(environment.connectivity ?? ""))).map((r) => ({ role: r.role, uri: r.offlineUri ?? r.uri ?? null, sha256: r.sha256 ?? null, bytes: Math.max(0, r.bytes ?? 0), critical: r.offlineCritical === true, reason: r.offlineCritical ? "offline-critical" : "degraded-connectivity" })).sort((a,b) => Number(b.critical)-Number(a.critical) || a.role.localeCompare(b.role));
  const selected: Array<Omit<(typeof candidates)[number], "critical">> = []; const skipped: Array<{role:string;reason:string}> = []; let bytes = 0;
  for (const candidate of candidates) { if (bytes + candidate.bytes > budgetBytes) { skipped.push({role:candidate.role,reason:"budget-exceeded"}); continue; } const {critical: _critical, ...kept}=candidate; selected.push(kept); bytes += candidate.bytes; }
  return Object.freeze({ resources:Object.freeze(selected), skipped:Object.freeze(skipped), estimatedBytes:bytes, budgetBytes, deterministic:true as const, business_meaning_unchanged:true as const });
}

export function evaluateVisualResourceFreshness(resource: Readonly<{ fetchedAt?: number; maxAgeSeconds?: number }>, now: number) {
  const fetchedAt = Math.trunc(resource.fetchedAt ?? 0); const maxAge = Math.max(0, Math.trunc(resource.maxAgeSeconds ?? 0));
  if (fetchedAt <= 0 || maxAge === 0) return Object.freeze({ fresh:false, reason:"unbounded-or-unknown", expiresAt:null });
  const expiresAt=fetchedAt+maxAge; return Object.freeze({ fresh:now<=expiresAt, reason:now<=expiresAt?"fresh":"expired", expiresAt });
}

export async function verifyVisualResourceIntegrity(resource: Readonly<{ sha256?: string | null }>, bytes?: Uint8Array | ArrayBuffer | string) {
  const expected=(resource.sha256 ?? "").toLowerCase();
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Invalid visual resource SHA-256.");
  if (!expected || bytes == null) return Object.freeze({verified:false,reason:!expected?"no-integrity-metadata":"bytes-unavailable",algorithm:"sha256"});
  if (!globalThis.crypto?.subtle) return Object.freeze({verified:false,reason:"sha256-unavailable",algorithm:"sha256"});
  const source=typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  // WebCrypto requires an ArrayBuffer-backed BufferSource; copy Uint8Array inputs so
  // SharedArrayBuffer-compatible views cannot leak into subtle.digest typing/runtime.
  const data=source instanceof Uint8Array ? Uint8Array.from(source).buffer : source;
  const digest=await globalThis.crypto.subtle.digest("SHA-256", data); const actual=[...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");
  return Object.freeze({verified:actual===expected,reason:actual===expected?"match":"mismatch",algorithm:"sha256",actual});
}

export function getVisualRuntimeHealth() {
  return Object.freeze({ status:"healthy" as const, checks:Object.freeze({visual_runtime:true,metadata_contract:true,interface_bridge_compatibility:true,canonical_surfaces:true,company_boundary:true}), canonical_surfaces:SUPPORTED_VISUAL_SURFACES, tenant_boundary:VISUAL_TENANT_BOUNDARY, company_scope_inference:false, business_authority:false });
}

export type RegisteredVisualContribution = Readonly<{
  id: string; provider: string; surfaces: readonly VisualSurface[]; treatment: unknown; version?: string; company_id?: string | null;
  [key: string]: unknown;
}>;

function assertVisualSemver(version: string): readonly [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error("Invalid visual contribution version.");
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  if (parts[0] !== 1) throw new Error("Unsupported visual contribution major version.");
  return parts;
}

export function compareVisualContributionVersions(incoming: string, existing: string): number {
  const a = assertVisualSemver(incoming), b = assertVisualSemver(existing);
  for (let i=0;i<3;i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export class VisualContributionRegistry {
  readonly #items = new Map<string, RegisteredVisualContribution>();
  constructor(readonly maxContributions = 1000) {}
  register(input: RegisteredVisualContribution): RegisteredVisualContribution {
    validateVisualMetadata(input);
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(input.id)) throw new Error("Invalid visual contribution id.");
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.provider)) throw new Error("Invalid visual contribution provider.");
    if (!input.surfaces.length || input.surfaces.some(s => !SUPPORTED_VISUAL_SURFACES.includes(s))) throw new Error("Unsupported visual contribution surface.");
    const version=input.version ?? "1.0.0"; assertVisualSemver(version);
    const company=input.company_id ?? null;
    if (company !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(company)) throw new Error("Invalid company_id.");
    const key=`${company ?? "*"}|${input.id}`, existing=this.#items.get(key);
    if (existing && existing.provider !== input.provider) throw new Error("Visual contribution id already owned by another provider for this company.");
    if (existing && compareVisualContributionVersions(version, existing.version ?? "1.0.0") < 0) throw new Error("Older visual contribution version cannot replace newer version.");
    if (!existing && this.#items.size >= this.maxContributions) throw new Error("Visual contribution registry capacity exceeded.");
    const stored=Object.freeze({...input, version, company_id:company}); this.#items.set(key,stored); return stored;
  }
  resolve(id:string,surface:VisualSurface,companyId?:string|null) { for (const key of [...(companyId?[`${companyId}|${id}`]:[]),`*|${id}`]) { const c=this.#items.get(key); if(c?.surfaces.includes(surface)) return c; } return null; }
  all(companyId?:string|null) { return Object.freeze([...this.#items.values()].filter(c=>c.company_id==null || (companyId!=null && c.company_id===companyId)).sort((a,b)=>a.id.localeCompare(b.id)||String(a.company_id??"*").localeCompare(String(b.company_id??"*")))); }
}

export async function snapshotVisualContributions(registry: VisualContributionRegistry, companyId?:string|null) {
  const items=registry.all(companyId).map(c=>({id:c.id,provider:c.provider,company_id:c.company_id??null,surfaces:[...c.surfaces],treatment:c.treatment,version:c.version??"1.0.0"})).sort((a,b)=>`${a.company_id??"*"}|${a.id}|${a.provider}`.localeCompare(`${b.company_id??"*"}|${b.id}|${b.provider}`));
  const bytes=new TextEncoder().encode(JSON.stringify(items));
  const hash=await crypto.subtle.digest("SHA-256",bytes); const sha256=[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("");
  return Object.freeze({items:Object.freeze(items),count:items.length,sha256,deterministic:true as const,business_authority:false as const,tenant_boundary:VISUAL_TENANT_BOUNDARY});
}

export type VisualResourceDefinition = Readonly<{ uri?:string; offlineUri?:string; variants?:readonly Readonly<{uri:string;minDpr?:number;maxDpr?:number;deviceClass?:string}>[]; mime?:string; alt?:string; decorative?:boolean; posterRole?:string; autoplay?:boolean; loop?:boolean; muted?:boolean; controls?:boolean; sha256?:string; bytes?:number; offlineCritical?:boolean; fetchedAt?:number; maxAgeSeconds?:number }>;
const VISUAL_ROLE=/^[a-z0-9][a-z0-9._-]{1,127}$/;
function safeVisualUri(uri:string){const s=uri.trim(),lower=s.toLowerCase();return !!s&&!/[\x00-\x20<>"`]/.test(s)&&(s.startsWith("/")||lower.startsWith("https://")||lower.startsWith("asset://")||lower.startsWith("titan://"));}
function validateResource(role:string,d:VisualResourceDefinition,kind:"asset"|"icon"|"media") { if(!VISUAL_ROLE.test(role)) throw new Error("Invalid visual resource role."); validateVisualMetadata(d); for(const u of [d.uri,d.offlineUri].filter(Boolean) as string[]) if(!safeVisualUri(u)) throw new Error("Unsafe visual resource URI."); for(const v of d.variants??[]) if(!safeVisualUri(v.uri)) throw new Error("Unsafe visual resource variant."); if(d.sha256&&!/^[a-f0-9]{64}$/i.test(d.sha256)) throw new Error("Invalid visual resource SHA-256."); if(d.bytes!=null&&(!Number.isInteger(d.bytes)||d.bytes<0)) throw new Error("Invalid visual resource byte size."); if(d.maxAgeSeconds!=null&&(!Number.isInteger(d.maxAgeSeconds)||d.maxAgeSeconds<0||d.maxAgeSeconds>604800)) throw new Error("Invalid maxAgeSeconds."); if(kind==="media"&&d.autoplay&&!d.muted) throw new Error("Autoplay media must be muted."); }
export class VisualResourceRegistry {
  readonly #stores={asset:new Map<string,VisualResourceDefinition>(),icon:new Map<string,VisualResourceDefinition>(),media:new Map<string,VisualResourceDefinition>()};
  register(kind:"asset"|"icon"|"media",role:string,definition:VisualResourceDefinition){validateResource(role,definition,kind);this.#stores[kind].set(role,Object.freeze({...definition}));}
  resolve(kind:"asset"|"icon"|"media",role:string,e:VisualEnvironment,context:Readonly<Record<string,unknown>>={}) { if(!VISUAL_ROLE.test(role)) throw new Error("Invalid visual resource role."); const d=this.#stores[kind].get(role); if(!d)return null; let uri=d.uri??null,resolution="default"; if(["offline","none"].includes(e.connectivity??"")&&d.offlineUri){uri=d.offlineUri;resolution="offline";} else { for(const v of d.variants??[]){const dpr=e.devicePixelRatio??1;if(dpr>=(v.minDpr??1)&&dpr<=(v.maxDpr??99)&&(!v.deviceClass||v.deviceClass===e.deviceClass)){uri=v.uri;resolution="variant";}} } if(!uri)return null; return Object.freeze({role,kind,uri,mime:d.mime??null,alt:d.alt??null,decorative:d.decorative??false,resolution,context,business_meaning_unchanged:true as const}); }
  inventory(){return Object.freeze({assets:Object.freeze([...this.#stores.asset.keys()].sort()),icons:Object.freeze([...this.#stores.icon.keys()].sort()),media:Object.freeze([...this.#stores.media.keys()].sort())});}
}

export const VISUAL_MOTION_PRESETS=Object.freeze({standard:Object.freeze({id:"standard",duration_ms:180,easing:"ease-out"}),reduced:Object.freeze({id:"reduced",duration_ms:0,easing:"linear"})});
export const VISUAL_TRANSITION_PRESETS=Object.freeze({crossfade:Object.freeze({id:"crossfade",duration_ms:160,business_meaning_unchanged:true as const})});
export const VISUAL_TREATMENTS=Object.freeze({success:Object.freeze({id:"success",semantic_state:"success"}),warning:Object.freeze({id:"warning",semantic_state:"warning"}),error:Object.freeze({id:"error",semantic_state:"error"})});

export const VISUAL_RUNTIME_PACKAGE_MANIFEST = Object.freeze({
  schema: "titan-extension-manifest-v2",
  slug: "titan-visual-runtime",
  version: "1.9.0",
  ownership: Object.freeze(["motion","transitions","visual-effects","assets","rich-media","visual-adaptation"]),
  non_ownership: Object.freeze(["business-meaning","action-authorization","component-authoring","interface-structure"]),
  tenant_boundary: VISUAL_TENANT_BOUNDARY,
  limits: Object.freeze({max_contributions:1000,default_offline_cache_budget_bytes:52_428_800}),
  builder_contract: Object.freeze({version:VISUAL_METADATA_CONTRACT_VERSION,schema:"titan://builder/schema/visual-metadata/v1",schema_sha256:VISUAL_METADATA_SCHEMA_SHA256,supportedMajor:1}),
  business_authority: false,
});

export const VISUAL_SUITE_COMPATIBILITY = Object.freeze({
  schema:"titan-visual-runtime-suite-runtime-compatibility-v1",
  canonical_surfaces:SUPPORTED_VISUAL_SURFACES,
  company_boundary:VISUAL_TENANT_BOUNDARY,
  ownership_boundary_not_isolation:true,
  interface_runtime:Object.freeze({method:"plan",bridge_contract:"VisualRuntimeBridge"}),
  business_authority:false,
});

export function validateVisualRuntimePackageManifest(manifest: Readonly<Record<string, unknown>>) {
  if (manifest.schema !== "titan-extension-manifest-v2") throw new Error("Unsupported Visual Runtime package manifest schema.");
  if (manifest.slug !== "titan-visual-runtime") throw new Error("Visual Runtime package slug mismatch.");
  if (manifest.tenant_boundary !== VISUAL_TENANT_BOUNDARY) throw new Error("Visual Runtime must use company_id as its tenant boundary.");
  const nonOwnership = Array.isArray(manifest.non_ownership) ? manifest.non_ownership : [];
  for (const required of ["business-meaning","action-authorization","component-authoring","interface-structure"]) if (!nonOwnership.includes(required)) throw new Error(`Visual Runtime manifest missing non-ownership boundary: ${required}`);
  const contract = manifest.builder_contract as Record<string,unknown> | undefined;
  if (!contract || contract.schema_sha256 !== VISUAL_METADATA_SCHEMA_SHA256 || contract.version !== VISUAL_METADATA_CONTRACT_VERSION) throw new Error("Visual Runtime builder contract mismatch.");
  return Object.freeze({valid:true as const,slug:RUNTIME_ID,tenant_boundary:VISUAL_TENANT_BOUNDARY,business_authority:false as const});
}

export function validateVisualContributionSchema(value: Readonly<Record<string, unknown>>) {
  validateVisualMetadata(value);
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]+$/.test(value.id)) throw new Error("Invalid visual contribution schema id.");
  if (typeof value.provider !== "string" || !value.provider.trim()) throw new Error("Invalid visual contribution schema provider.");
  if (!Array.isArray(value.surfaces) || value.surfaces.length < 1 || new Set(value.surfaces).size !== value.surfaces.length || value.surfaces.some((s)=>typeof s!=="string" || !SUPPORTED_VISUAL_SURFACES.includes(s as VisualSurface))) throw new Error("Invalid visual contribution schema surfaces.");
  if (!value.treatment || typeof value.treatment !== "object" || Array.isArray(value.treatment)) throw new Error("Invalid visual contribution schema treatment.");
  if (value.capabilityRequirements != null && (!Array.isArray(value.capabilityRequirements) || value.capabilityRequirements.some((c)=>typeof c!=="string"))) throw new Error("Invalid visual contribution capability requirements.");
  return Object.freeze({...value});
}

const VISUAL_EXECUTABLE_PAYLOAD=/(javascript:|<script|eval\s*\(|new\s+Function|data:text\/html|expression\s*\()/i;
const VISUAL_FORBIDDEN_METADATA_KEYS=new Set(["script","javascript","html","css","eval","sql","credentials","token","secret","rawurl","raw_url"]);
export function sanitizeVisualBrowserMetadata(value: unknown, depth=0): unknown {
  if (depth > 12) throw new Error("Visual metadata depth exceeded.");
  if (Array.isArray(value)) return Object.freeze(value.map(v=>sanitizeVisualBrowserMetadata(v,depth+1)));
  if (!value || typeof value !== "object") { if (typeof value === "string" && VISUAL_EXECUTABLE_PAYLOAD.test(value)) throw new Error("Executable visual payload rejected."); return value; }
  const out:Record<string,unknown>={};
  for (const [key,item] of Object.entries(value as Record<string,unknown>)) { if (VISUAL_FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) throw new Error("Forbidden visual metadata key."); out[key]=sanitizeVisualBrowserMetadata(item,depth+1); }
  return Object.freeze(out);
}

export function detectVisualBrowserEnvironment(browser: Readonly<{devicePixelRatio?:number;innerWidth?:number;matchMedia?:(query:string)=>{matches:boolean}}>, surface: VisualSurface = "zero") : VisualEnvironment {
  const matches=(q:string)=>{try{return !!browser.matchMedia?.(q).matches;}catch{return false;}};
  return Object.freeze({surface,reducedMotion:matches("(prefers-reduced-motion: reduce)"),highContrast:matches("(prefers-contrast: more)"),devicePixelRatio:browser.devicePixelRatio??1,width:browser.innerWidth??0,deviceClass:(browser.innerWidth??0)<600?"compact":"standard"});
}

export function applyVisualBrowserPlan(target: {dataset?:Record<string,string>}, plan: Readonly<Record<string,unknown>>) {
  if (!target || typeof target !== "object" || !target.dataset) throw new TypeError("Visual target with dataset required.");
  const safe=sanitizeVisualBrowserMetadata(plan) as Record<string,unknown>;
  target.dataset.visualTreatment=String(safe.visualTreatment ?? safe.treatment ?? "default");
  target.dataset.motionPreset=String(safe.motionPreset ?? safe.motion ?? "none");
  target.dataset.transitionPreset=String(safe.transitionPreset ?? safe.transition ?? "none");
  target.dataset.visualStrategy=String(safe.strategy ?? "fallback");
  return target;
}

export function assertVisualInterfaceBridgeCompatibility(input: Readonly<{method?:string;company_boundary?:string;business_authority?:boolean;canonical_surfaces?:readonly string[]}>) {
  if (input.method !== "plan") throw new Error("Interface Runtime visual bridge must expose plan.");
  if (input.company_boundary !== VISUAL_TENANT_BOUNDARY) throw new Error("Interface Runtime visual bridge company boundary mismatch.");
  if (input.business_authority !== false) throw new Error("Interface Runtime visual bridge cannot grant business authority.");
  if (!input.canonical_surfaces || SUPPORTED_VISUAL_SURFACES.some(s=>!input.canonical_surfaces!.includes(s))) throw new Error("Interface Runtime visual bridge surface mismatch.");
  return Object.freeze({compatible:true as const,method:"plan" as const,tenant_boundary:VISUAL_TENANT_BOUNDARY,business_authority:false as const});
}
