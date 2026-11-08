export type GoVisitStage = "ready" | "travel" | "arrived" | "work" | "complete";
export type GoTransition = "travel" | "arrive" | "start" | "complete";

export interface GoFieldSession {
  schema_version: "1.0";
  company_id: string;
  actor_id: string;
  device_id: string;
  job_id: string;
  projection_revision: string;
  stage: GoVisitStage;
  route_ready: boolean;
  equipment_ready: boolean;
  access_status: "pending" | "confirmed" | "failed";
  checklist: readonly boolean[];
  evidence_count: number;
  required_evidence_count: number;
  last_receipt_id: string | null;
  authority_neutral: true;
}

export interface GoCommandIntent {
  schema_version: "1.0";
  command_id: string;
  company_id: string;
  actor_id: string;
  device_id: string;
  surface: "go";
  job_id: string;
  projection_revision: string;
  capability_id: string;
  operation: string;
  idempotency_key: string;
  correlation_id: string;
  payload: Readonly<Record<string, unknown>>;
  transport: "titan-command-bus";
  execution_authorised: false;
  requires_server_acceptance: true;
  requires_receipt: true;
}

export interface GoQueueItem {
  schema_version: "1.0";
  operation_id: string;
  company_id: string;
  actor_id: string;
  device_id: string;
  job_id: string;
  base_projection_revision: string;
  occurred_at: string;
  idempotency_key: string;
  intent: GoCommandIntent;
  replay_authorised: false;
  requires_revalidation: true;
}

export interface GoBlocker { code: string; message: string; recovery: string }
export interface GoTransitionResult {
  status: "blocked" | "queued_offline" | "awaiting_receipt";
  session: GoFieldSession;
  blockers: readonly GoBlocker[];
  intent: GoCommandIntent | null;
  queue_item: GoQueueItem | null;
}

export function createGoFieldSession(input: Partial<GoFieldSession> & Pick<GoFieldSession, "company_id" | "actor_id" | "device_id" | "job_id" | "projection_revision">): GoFieldSession;
export function prepareGoTransition(session: GoFieldSession, action: GoTransition, options?: { online?: boolean; now?: string }): GoTransitionResult;
export function applyGoReceipt(session: GoFieldSession, intent: GoCommandIntent, receipt: { receipt_id: string; command_id: string; correlation_id: string; company_id: string; status: string }): GoFieldSession;
export function revalidateGoQueue(queue: readonly GoQueueItem[], projection: { company_id: string; actor_id: string; device_id: string; projection_revision: string }): { ready: readonly GoQueueItem[]; conflicts: readonly { item: GoQueueItem; reason: string }[]; replay_authorised: false };
export function prepareGoIssue(session: GoFieldSession, issue: { type: string; note: string; online?: boolean; now?: string }): { status: "queued_offline" | "awaiting_receipt"; session: GoFieldSession; intent: GoCommandIntent; signal: Readonly<Record<string, unknown>>; queue_item: GoQueueItem | null };
