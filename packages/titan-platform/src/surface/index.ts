export const TITAN_SURFACE_SCHEMA_VERSION = "1.0" as const;
export const TITAN_SURFACES = Object.freeze(["zero", "go", "hub"] as const);
export const TITAN_SURFACE_ALIASES = Object.freeze({
  command: "zero",
  owner: "zero",
  manager: "zero",
  business: "zero",
  bos: "zero",
  field: "go",
  worker: "go",
  customer: "hub",
} as const);

export type TitanSurface = (typeof TITAN_SURFACES)[number];
export type SurfaceReceiptStatus = "accepted" | "rejected" | "completed" | "failed";

export interface SurfaceCapabilityInput {
  capability_id: string;
  operations: readonly string[];
  mutation?: boolean;
  offline?: "read" | "prepare" | "queue" | "forbidden";
  requires_receipt?: boolean;
  authority_ceiling?: string | null;
}

export interface SurfaceCapability extends SurfaceCapabilityInput {
  mutation: boolean;
  offline: "read" | "prepare" | "queue" | "forbidden";
  requires_receipt: boolean;
  authority_ceiling: string | null;
}

export interface SurfaceProjectionInput {
  company_id: string;
  surface: TitanSurface;
  actor_id: string;
  revision: string;
  issued_at: string;
  expires_at: string;
  capabilities: readonly SurfaceCapabilityInput[];
  data?: Readonly<Record<string, unknown>>;
}

export interface SurfaceProjection {
  schema_version: typeof TITAN_SURFACE_SCHEMA_VERSION;
  company_id: string;
  surface: TitanSurface;
  actor_id: string;
  revision: string;
  issued_at: string;
  expires_at: string;
  capabilities: readonly Readonly<SurfaceCapability>[];
  data: Readonly<Record<string, unknown>>;
  authority_neutral: true;
  identity_grants_authority: false;
  cached_state_grants_authority: false;
}

export interface SurfaceCommandIntentInput {
  projection: SurfaceProjection;
  capability_id: string;
  operation: string;
  idempotency_key: string;
  correlation_id: string;
  payload: Readonly<Record<string, unknown>>;
  now?: string;
  command_id?: string;
}

export interface SurfaceCommandIntent {
  schema_version: typeof TITAN_SURFACE_SCHEMA_VERSION;
  command_id: string;
  company_id: string;
  surface: TitanSurface;
  actor_id: string;
  projection_revision: string;
  capability_id: string;
  operation: string;
  idempotency_key: string;
  correlation_id: string;
  payload: Readonly<Record<string, unknown>>;
  transport: "titan-command-bus";
  execution_authorised: false;
  requires_server_acceptance: true;
  requires_receipt: boolean;
}

export interface SurfaceReceiptInput {
  receipt_id: string;
  command_id: string;
  company_id: string;
  correlation_id: string;
  status: SurfaceReceiptStatus;
  event_id?: string | null;
  signal_ids?: readonly string[];
  completed_at?: string | null;
  reason_code?: string | null;
}

export interface SurfaceReceipt extends SurfaceReceiptInput {
  authority_source: "server";
  signal_ids: readonly string[];
  event_id: string | null;
  completed_at: string | null;
  reason_code: string | null;
}

export interface SurfaceSignal {
  schema_version: typeof TITAN_SURFACE_SCHEMA_VERSION;
  signal_id: string;
  company_id: string;
  surface: TitanSurface;
  kind: string;
  severity: "info" | "success" | "warning" | "critical";
  occurred_at: string;
  correlation_id: string | null;
  data: Readonly<Record<string, unknown>>;
  authority_neutral: true;
}

export interface SurfaceEvent {
  schema_version: typeof TITAN_SURFACE_SCHEMA_VERSION;
  event_id: string;
  company_id: string;
  surface: TitanSurface;
  type: string;
  occurred_at: string;
  correlation_id: string | null;
  data: Readonly<Record<string, unknown>>;
  append_only: true;
}

export interface SurfaceTransport {
  getProjection(request: { company_id: string; surface: TitanSurface }): Promise<SurfaceProjectionInput | SurfaceProjection>;
  submitCommand(intent: SurfaceCommandIntent): Promise<SurfaceReceiptInput>;
}

export interface SurfaceProjectionContext {
  company_id: string;
  surface: TitanSurface;
  revision?: string;
  now?: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}-object-required`);
  if (Object.prototype.hasOwnProperty.call(value, "tenant_company_id") || Object.prototype.hasOwnProperty.call(value, "tenant_id")) {
    throw new TypeError("tenant_company_id-not-authoritative");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label}-required`);
  return value.trim();
}

function iso(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!Number.isFinite(Date.parse(candidate))) throw new TypeError(`${label}-iso-date-required`);
  return candidate;
}

export function normalizeTitanSurface(value: unknown): TitanSurface {
  const candidate = text(value, "surface");
  const canonical = (TITAN_SURFACE_ALIASES as Readonly<Record<string, TitanSurface>>)[candidate] ?? candidate;
  if (!TITAN_SURFACES.includes(canonical as TitanSurface)) throw new TypeError("canonical-surface-required");
  return canonical as TitanSurface;
}

function surface(value: unknown): TitanSurface {
  return normalizeTitanSurface(value);
}

function deepFreezeRecord(value: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  const copy = { ...(value ?? {}) };
  return Object.freeze(copy);
}

function commandId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `surface-command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createSurfaceProjection(input: SurfaceProjectionInput): SurfaceProjection {
  record(input, "surface-projection");
  const capabilities = input.capabilities.map((entry) => {
    record(entry, "surface-capability");
    const operations = Object.freeze([...new Set(entry.operations.map((operation) => text(operation, "surface-operation")))]);
    if (operations.length === 0) throw new TypeError("surface-capability-operation-required");
    return Object.freeze({
      capability_id: text(entry.capability_id, "surface-capability-id"),
      operations,
      mutation: entry.mutation === true,
      offline: entry.offline ?? (entry.mutation ? "forbidden" : "read"),
      requires_receipt: entry.requires_receipt ?? entry.mutation === true,
      authority_ceiling: entry.authority_ceiling ?? null,
    });
  });
  const ids = capabilities.map(({ capability_id }) => capability_id);
  if (new Set(ids).size !== ids.length) throw new TypeError("surface-capability-id-duplicate");
  return Object.freeze({
    schema_version: TITAN_SURFACE_SCHEMA_VERSION,
    company_id: text(input.company_id, "company_id"),
    surface: surface(input.surface),
    actor_id: text(input.actor_id, "actor_id"),
    revision: text(input.revision, "surface-revision"),
    issued_at: iso(input.issued_at, "surface-issued-at"),
    expires_at: iso(input.expires_at, "surface-expires-at"),
    capabilities: Object.freeze(capabilities),
    data: deepFreezeRecord(input.data),
    authority_neutral: true,
    identity_grants_authority: false,
    cached_state_grants_authority: false,
  });
}

export function assertSurfaceProjectionContext(
  projection: SurfaceProjection,
  context: SurfaceProjectionContext,
): SurfaceProjection {
  record(projection, "surface-projection");
  const company_id = text(context.company_id, "company_id");
  const expectedSurface = surface(context.surface);
  if (projection.company_id !== company_id) throw new TypeError("surface-projection-company-mismatch");
  if (projection.surface !== expectedSurface) throw new TypeError("surface-projection-role-mismatch");
  if (context.revision !== undefined && projection.revision !== text(context.revision, "surface-revision")) {
    throw new TypeError("surface-projection-revision-mismatch");
  }
  if (projection.authority_neutral !== true || projection.identity_grants_authority !== false || projection.cached_state_grants_authority !== false) {
    throw new TypeError("surface-authority-contract-invalid");
  }
  const now = context.now ?? new Date().toISOString();
  if (Date.parse(projection.expires_at) <= Date.parse(iso(now, "surface-now"))) {
    throw new TypeError("surface-projection-expired");
  }
  return projection;
}

export function assertSurfaceCapability(
  projection: SurfaceProjection,
  capabilityId: string,
  operation: string,
  now = new Date().toISOString(),
): Readonly<SurfaceCapability> {
  assertSurfaceProjectionContext(projection, { company_id: projection.company_id, surface: projection.surface, now });
  const capability = projection.capabilities.find((entry) => entry.capability_id === capabilityId);
  if (!capability || !capability.operations.includes(operation)) throw new TypeError("surface-capability-not-authorised");
  return capability;
}

export function createSurfaceCommandIntent(input: SurfaceCommandIntentInput): SurfaceCommandIntent {
  record(input, "surface-command-intent");
  const capabilityId = text(input.capability_id, "surface-capability-id");
  const operation = text(input.operation, "surface-operation");
  const capability = assertSurfaceCapability(input.projection, capabilityId, operation, input.now);
  return Object.freeze({
    schema_version: TITAN_SURFACE_SCHEMA_VERSION,
    command_id: text(input.command_id ?? commandId(), "surface-command-id"),
    company_id: input.projection.company_id,
    surface: input.projection.surface,
    actor_id: input.projection.actor_id,
    projection_revision: input.projection.revision,
    capability_id: capabilityId,
    operation,
    idempotency_key: text(input.idempotency_key, "idempotency-key"),
    correlation_id: text(input.correlation_id, "correlation-id"),
    payload: deepFreezeRecord(record(input.payload, "surface-command-payload")),
    transport: "titan-command-bus",
    execution_authorised: false,
    requires_server_acceptance: true,
    requires_receipt: capability.requires_receipt,
  });
}

export function validateSurfaceReceipt(intent: SurfaceCommandIntent, input: SurfaceReceiptInput): SurfaceReceipt {
  record(input, "surface-receipt");
  if (text(input.company_id, "company_id") !== intent.company_id) throw new TypeError("surface-receipt-company-mismatch");
  if (text(input.command_id, "surface-command-id") !== intent.command_id) throw new TypeError("surface-receipt-command-mismatch");
  if (text(input.correlation_id, "correlation-id") !== intent.correlation_id) throw new TypeError("surface-receipt-correlation-mismatch");
  return Object.freeze({
    receipt_id: text(input.receipt_id, "surface-receipt-id"),
    command_id: input.command_id,
    company_id: input.company_id,
    correlation_id: input.correlation_id,
    status: input.status,
    event_id: input.event_id ?? null,
    signal_ids: Object.freeze([...(input.signal_ids ?? [])]),
    completed_at: input.completed_at ?? null,
    reason_code: input.reason_code ?? null,
    authority_source: "server",
  });
}

export function createSurfaceSignal(input: Omit<SurfaceSignal, "schema_version" | "authority_neutral">): SurfaceSignal {
  record(input, "surface-signal");
  return Object.freeze({ ...input, schema_version: TITAN_SURFACE_SCHEMA_VERSION, authority_neutral: true, data: deepFreezeRecord(input.data) });
}

export function createSurfaceEvent(input: Omit<SurfaceEvent, "schema_version" | "append_only">): SurfaceEvent {
  record(input, "surface-event");
  return Object.freeze({ ...input, schema_version: TITAN_SURFACE_SCHEMA_VERSION, append_only: true, data: deepFreezeRecord(input.data) });
}

export function createSurfaceClient(input: { company_id: string; surface: TitanSurface; transport: SurfaceTransport }) {
  record(input, "surface-client");
  const company_id = text(input.company_id, "company_id");
  const clientSurface = surface(input.surface);
  let currentProjection: SurfaceProjection | null = null;
  return Object.freeze({
    get projection() {
      return currentProjection;
    },
    async refreshProjection() {
      const projection = createSurfaceProjection(await input.transport.getProjection({ company_id, surface: clientSurface }));
      assertSurfaceProjectionContext(projection, { company_id, surface: clientSurface });
      currentProjection = projection;
      return projection;
    },
    async submit(command: Omit<SurfaceCommandIntentInput, "projection">) {
      if (!currentProjection) throw new TypeError("surface-projection-required");
      const intent = createSurfaceCommandIntent({ ...command, projection: currentProjection });
      return validateSurfaceReceipt(intent, await input.transport.submitCommand(intent));
    },
  });
}
