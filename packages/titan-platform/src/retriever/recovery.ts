export const RETRIEVER_RECOVERY_SESSION_SCHEMA = "titan-zero-retriever-recovery-session/v1";
export const RETRIEVER_RECOVERY_RESULT_SCHEMA = "titan-zero-retriever-recovery-result/v1";

const clean = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function rejectLegacy(input: object): void {
  if ("tenant_id" in input || "tenant_company_id" in input) {
    throw new TypeError("legacy tenant boundaries are not accepted by Retriever recovery");
  }
}

function requireCompanyId(value: unknown): string {
  const companyId = clean(value);
  if (!companyId) throw new TypeError("canonical company_id is required");
  return companyId;
}

function requireText(value: unknown, name: string): string {
  const result = clean(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

export type RetrieverRecoverySession = Readonly<{
  schema: typeof RETRIEVER_RECOVERY_SESSION_SCHEMA;
  company_id: string;
  session_id: string;
  connection_key: string;
  epoch: number;
  created_at: number;
  last_seen_at: number;
  resumable: boolean;
  authority_snapshot_ref: null;
  identity_grants_authority: false;
  execution_authority: false;
}>;

export function createRetrieverRecoverySession(input: Record<string, unknown> = {}): RetrieverRecoverySession {
  rejectLegacy(input);
  const company_id = requireCompanyId(input.company_id);
  const session_id = requireText(input.session_id, "session_id");
  const connection_key = requireText(input.connection_key, "connection_key");
  const created_at = Number.isFinite(input.created_at) ? Number(input.created_at) : Date.now();
  const last_seen_at = Number.isFinite(input.last_seen_at) ? Number(input.last_seen_at) : created_at;
  const epoch = Number.isInteger(input.epoch) && Number(input.epoch) >= 0 ? Number(input.epoch) : 0;
  return Object.freeze({
    schema: RETRIEVER_RECOVERY_SESSION_SCHEMA,
    company_id,
    session_id,
    connection_key,
    epoch,
    created_at,
    last_seen_at,
    resumable: input.resumable !== false,
    authority_snapshot_ref: null,
    identity_grants_authority: false,
    execution_authority: false,
  });
}

export function classifyRetrieverRecoverySession(
  session: RetrieverRecoverySession,
  current: Record<string, unknown> = {},
) {
  if (!session || session.schema !== RETRIEVER_RECOVERY_SESSION_SCHEMA) {
    throw new TypeError("valid Retriever recovery session is required");
  }
  rejectLegacy(current);
  const company_id = requireCompanyId(current.company_id);
  if (company_id !== session.company_id) {
    throw new TypeError("recovery company_id mismatch");
  }
  const connection_key = requireText(current.connection_key, "connection_key");
  const now = Number.isFinite(current.now) ? Number(current.now) : Date.now();
  const stale_after_ms = Math.max(1, Number.isFinite(current.stale_after_ms) ? Number(current.stale_after_ms) : 30_000);
  const age_ms = Math.max(0, now - session.last_seen_at);
  const connection_changed = connection_key !== session.connection_key;
  const stale = age_ms >= stale_after_ms;

  if (!connection_changed && !stale) {
    return Object.freeze({
      status: "current",
      recoverable: true,
      reason: null,
      age_ms,
      connection_changed: false,
      execution_authority: false,
      identity_grants_authority: false,
    });
  }
  if (!session.resumable) {
    return Object.freeze({
      status: stale ? "stale_non_resumable" : "connection_non_resumable",
      recoverable: false,
      reason: stale ? "stale_session_not_resumable" : "connection_changed_session_not_resumable",
      age_ms,
      connection_changed,
      execution_authority: false,
      identity_grants_authority: false,
    });
  }
  return Object.freeze({
    status: stale ? "stale_resumable" : "connection_resumable",
    recoverable: true,
    reason: stale ? "session_stale" : "connection_changed",
    age_ms,
    connection_changed,
    execution_authority: false,
    identity_grants_authority: false,
  });
}

export function recoverRetrieverSession(
  session: RetrieverRecoverySession,
  current: Record<string, unknown> = {},
) {
  const classification = classifyRetrieverRecoverySession(session, current);
  const company_id = requireCompanyId(current.company_id);
  if (!classification.recoverable) {
    return Object.freeze({
      schema: RETRIEVER_RECOVERY_RESULT_SCHEMA,
      recovered: false,
      company_id,
      previous_session_id: session.session_id,
      recovery_status: classification.status,
      reason: classification.reason,
      requires_new_negotiation: true,
      requires_fresh_authority_evaluation: true,
      prior_authority_reused: false,
      identity_grants_authority: false,
      execution_authority: false,
    });
  }

  const changed = classification.status !== "current";
  const now = Number.isFinite(current.now) ? Number(current.now) : Date.now();
  const connection_key = requireText(current.connection_key, "connection_key");
  return Object.freeze({
    schema: RETRIEVER_RECOVERY_RESULT_SCHEMA,
    recovered: true,
    company_id,
    session: createRetrieverRecoverySession({
      ...session,
      company_id,
      connection_key,
      epoch: changed ? session.epoch + 1 : session.epoch,
      last_seen_at: now,
      authority_snapshot_ref: null,
    }),
    recovery_status: classification.status,
    reason: classification.reason,
    requires_new_negotiation: changed,
    requires_fresh_authority_evaluation: changed,
    prior_authority_reused: false,
    identity_grants_authority: false,
    execution_authority: false,
  });
}

export function createRetrieverReconnectPlan(input: {
  company_id: string;
  trigger: "navigation" | "reload" | "restart" | "transport_disconnect";
  recovery: ReturnType<typeof recoverRetrieverSession>;
}) {
  rejectLegacy(input);
  const company_id = requireCompanyId(input.company_id);
  const trigger = input.trigger;
  if (!["navigation", "reload", "restart", "transport_disconnect"].includes(trigger)) {
    throw new TypeError("valid reconnect trigger is required");
  }
  const recovery = input.recovery;
  if (!recovery || recovery.schema !== RETRIEVER_RECOVERY_RESULT_SCHEMA) {
    throw new TypeError("valid Retriever recovery result is required");
  }
  if (recovery.company_id !== company_id) throw new TypeError("recovery company_id mismatch");

  const actions: string[] = [];
  if (recovery.recovered && recovery.requires_new_negotiation) {
    actions.push("restore_lifecycle_checkpoint", "renegotiate_retriever");
  }
  if (recovery.recovered && recovery.requires_fresh_authority_evaluation) {
    actions.push("reevaluate_execution_authority");
  }
  if (!recovery.recovered) {
    actions.push(
      "discard_stale_session",
      "restore_lifecycle_checkpoint",
      "create_new_session",
      "renegotiate_retriever",
      "reevaluate_execution_authority",
    );
  }
  if (recovery.recovered && !recovery.requires_new_negotiation) {
    actions.push("resume_existing_session");
  }

  return Object.freeze({
    schema: "titan-zero-retriever-reconnect-plan/v1",
    trigger,
    company_id,
    actions: Object.freeze(actions),
    auto_execute_after_reconnect: false,
    prior_authority_reused_after_reconnect: false,
    identity_grants_authority: false,
    execution_authority: false,
  });
}
