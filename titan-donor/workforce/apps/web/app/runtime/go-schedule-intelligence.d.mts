export interface GoScheduleJobInput {
  job_id: string;
  start_minutes: number;
  duration_minutes: number;
  travel_minutes: number;
  access: "confirmed" | "unconfirmed";
  supplies: "ready" | "missing_item";
  parking: "known" | "limited";
}

export interface GoScheduleRisk {
  code: string;
  level: "warning" | "critical";
  title: string;
  detail: string;
  recovery: string;
}

export interface GoScheduleAnalysis {
  schema_version: "1.0";
  company_id: string;
  actor_id: string;
  device_id: string;
  projection_revision: string;
  now_minutes: number;
  health: "healthy" | "attention" | "at_risk";
  jobs: readonly (GoScheduleJobInput & { risks: readonly GoScheduleRisk[]; risk_level: "clear" | "warning" | "critical"; preparation_minutes: number; predicted_arrival_minutes: number })[];
  summary: Readonly<{ total_jobs: number; jobs_needing_preparation: number; critical_risks: number; recoverable_minutes: number }>;
  authority_neutral: true;
}

export function analyseGoSchedule(input: { company_id: string; actor_id: string; device_id: string; projection_revision: string; now_minutes: number; jobs: readonly GoScheduleJobInput[] }): GoScheduleAnalysis;
export function prepareScheduleRecovery(analysis: GoScheduleAnalysis, request: { job_id: string; action: "notify_dispatch" | "prepare_customer_eta" | "verify_access" | "stage_supply"; note: string; online?: boolean; now?: string }): { status: "awaiting_receipt" | "queued_offline"; intent: Readonly<Record<string, unknown>>; queue_item: Readonly<Record<string, unknown>> | null; schedule_changed: false };
