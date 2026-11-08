export const COMPANY_CONTEXT_SCHEMA = "titan.company-context.v1" as const;
export const CONTEXT_HANDOFF_SCHEMA = "titan.context-handoff.v1" as const;

export type ContextSource = "session" | "host" | "offline-reconnect" | "provider";
export type AuthorityCeiling = "observe" | "recommend" | "execute";

export type CompanyContext = Readonly<{
  schema: typeof COMPANY_CONTEXT_SCHEMA;
  context_id: string;
  company_id: string;
  actor_id: string;
  source: ContextSource;
  revision: number;
  issued_at: string;
  expires_at: string;
  authority_ceiling: AuthorityCeiling;
  revoked: boolean;
}>;

export type ContextHandoff = Readonly<{
  schema: typeof CONTEXT_HANDOFF_SCHEMA;
  handoff_id: string;
  context_id: string;
  company_id: string;
  actor_id: string;
  correlation_id: string;
  causation_id: string;
  context_revision: number;
  requested_ceiling: AuthorityCeiling;
  created_at: string;
}>;

export type ContextStoreOptions = Readonly<{ now?: () => string; maxLifetimeMs?: number }>;

const CEILING_RANK: Record<AuthorityCeiling, number> = { observe: 0, recommend: 1, execute: 2 };

function requireText(name: string, value: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name}-required`);
  return value;
}
function parseTime(name: string, value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${name}-invalid`);
  return time;
}
function clone<T>(value: T): T { return structuredClone(value); }

export class CompanyContextStore {
  readonly #now: () => string;
  readonly #maxLifetimeMs: number;
  readonly #contexts = new Map<string, CompanyContext>();
  readonly #revoked = new Set<string>();

  constructor(options: ContextStoreOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#maxLifetimeMs = options.maxLifetimeMs ?? 24 * 60 * 60 * 1000;
    if (!Number.isFinite(this.#maxLifetimeMs) || this.#maxLifetimeMs <= 0) throw new Error("max-lifetime-invalid");
  }

  issue(input: { context_id: string; company_id: string; actor_id: string; source: ContextSource; authority_ceiling: AuthorityCeiling; revision: number; expires_at?: string }): CompanyContext {
    requireText("context-id", input.context_id);
    requireText("company-id", input.company_id);
    requireText("actor-id", input.actor_id);
    if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error("context-revision-invalid");
    const issuedAt = this.#now();
    const issuedMs = parseTime("issued-at", issuedAt);
    const expiresAt = input.expires_at ?? new Date(issuedMs + this.#maxLifetimeMs).toISOString();
    const expiresMs = parseTime("expires-at", expiresAt);
    if (expiresMs <= issuedMs || expiresMs - issuedMs > this.#maxLifetimeMs) throw new Error("context-lifetime-invalid");
    const prior = this.#contexts.get(input.context_id);
    if (prior && prior.company_id !== input.company_id) throw new Error("context-id-reuse-cross-company");
    if (this.#revoked.has(input.context_id)) throw new Error("context-revoked");
    const context: CompanyContext = Object.freeze({ schema: COMPANY_CONTEXT_SCHEMA, context_id: input.context_id, company_id: input.company_id, actor_id: input.actor_id, source: input.source, revision: input.revision, issued_at: issuedAt, expires_at: expiresAt, authority_ceiling: input.authority_ceiling, revoked: false });
    this.#contexts.set(context.context_id, context);
    return clone(context);
  }

  rotate(previousContextId: string, next: Omit<Parameters<CompanyContextStore["issue"]>[0], "revision"> & { revision?: number }): CompanyContext {
    const previous = this.resolve(previousContextId);
    if (next.company_id !== previous.company_id || next.actor_id !== previous.actor_id) throw new Error("context-rotation-identity-mismatch");
    if (next.authority_ceiling && CEILING_RANK[next.authority_ceiling] > CEILING_RANK[previous.authority_ceiling]) throw new Error("context-rotation-authority-expansion");
    this.revoke(previous.context_id);
    return this.issue({ ...next, revision: next.revision ?? previous.revision + 1, authority_ceiling: next.authority_ceiling ?? previous.authority_ceiling });
  }

  revoke(contextId: string): void {
    const current = this.#contexts.get(requireText("context-id", contextId));
    if (current) this.#contexts.set(contextId, Object.freeze({ ...current, revoked: true }));
    this.#revoked.add(contextId);
  }

  resolve(contextId: string, at = this.#now()): CompanyContext {
    const context = this.#contexts.get(requireText("context-id", contextId));
    if (!context || context.revoked || this.#revoked.has(contextId)) throw new Error("context-revoked-or-missing");
    if (parseTime("at", at) >= parseTime("expires-at", context.expires_at)) throw new Error("context-expired");
    return clone(context);
  }

  createHandoff(input: { handoff_id: string; context_id: string; correlation_id: string; causation_id: string; requested_ceiling?: AuthorityCeiling }): ContextHandoff {
    const context = this.resolve(input.context_id);
    const requested = input.requested_ceiling ?? context.authority_ceiling;
    if (CEILING_RANK[requested] > CEILING_RANK[context.authority_ceiling]) throw new Error("handoff-authority-expansion");
    return clone(Object.freeze({ schema: CONTEXT_HANDOFF_SCHEMA, handoff_id: requireText("handoff-id", input.handoff_id), context_id: context.context_id, company_id: context.company_id, actor_id: context.actor_id, correlation_id: requireText("correlation-id", input.correlation_id), causation_id: requireText("causation-id", input.causation_id), context_revision: context.revision, requested_ceiling: requested, created_at: this.#now() }));
  }

  acceptHandoff(handoff: ContextHandoff): CompanyContext {
    if (handoff.schema !== CONTEXT_HANDOFF_SCHEMA) throw new Error("handoff-schema-invalid");
    const context = this.resolve(handoff.context_id);
    if (handoff.company_id !== context.company_id || handoff.actor_id !== context.actor_id) throw new Error("handoff-identity-mismatch");
    if (handoff.context_revision !== context.revision) throw new Error("handoff-stale-context");
    if (CEILING_RANK[handoff.requested_ceiling] > CEILING_RANK[context.authority_ceiling]) throw new Error("handoff-authority-expansion");
    return context;
  }
}
