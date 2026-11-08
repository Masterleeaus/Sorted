/** Demo-only surface projections. Capability availability never grants execution authority. */
export type DemoSurface = "zero" | "go" | "hub" | "command";
export declare const SURFACE_CONTRACT_VERSION: "1.0";

export interface SurfacePresentation {
  readonly name: string;
  readonly audience: string;
  readonly accent: string;
  readonly heading: string;
  readonly greeting: string;
  readonly prompt: string;
  readonly suggestions: readonly string[];
}

export interface SurfaceCapability {
  readonly capability_id: string;
  readonly operations: readonly string[];
  readonly mutation: boolean;
  readonly offline: "read" | "queue" | "forbidden";
  readonly requires_receipt: boolean;
}

export interface DemoSurfaceProjection<S extends DemoSurface = DemoSurface> {
  readonly schema_version: typeof SURFACE_CONTRACT_VERSION;
  readonly company_id: string;
  readonly surface: S;
  readonly actor_id: string;
  readonly revision: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly capabilities: readonly SurfaceCapability[];
  readonly data: { readonly presentation: SurfacePresentation };
  readonly authority_neutral: true;
  readonly identity_grants_authority: false;
  readonly cached_state_grants_authority: false;
}

export interface SurfaceCommandInput<S extends DemoSurface = DemoSurface> {
  projection: DemoSurfaceProjection<S>;
  command_id?: string;
  capability_id: string;
  operation: string;
  idempotency_key: string;
  correlation_id: string;
  payload?: Readonly<Record<string, unknown>>;
}

export interface SurfaceCommandIntent<S extends DemoSurface = DemoSurface> {
  readonly schema_version: typeof SURFACE_CONTRACT_VERSION;
  readonly command_id: string;
  readonly company_id: string;
  readonly surface: S;
  readonly actor_id: string;
  readonly projection_revision: string;
  readonly capability_id: string;
  readonly operation: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly transport: "titan-command-bus";
  readonly execution_authorised: false;
  readonly requires_server_acceptance: true;
  readonly requires_receipt: boolean;
}

export declare function getDemoSurfaceProjection<S extends DemoSurface>(surface: S): DemoSurfaceProjection<S>;
export declare function createSurfaceCommandIntent<S extends DemoSurface>(input: SurfaceCommandInput<S>): SurfaceCommandIntent<S>;
