export const GO_SCHEDULE_INTELLIGENCE_VERSION = "1.0";

function required(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label}-required`);
  return value.trim();
}

function rejectLegacy(input) {
  if (input && typeof input === "object" && ("tenant_company_id" in input || "tenant_id" in input)) {
    throw new TypeError("tenant_company_id-not-authoritative");
  }
}

function risk(code, level, title, detail, recovery) {
  return Object.freeze({ code, level, title, detail, recovery });
}

function analyseJob(job) {
  const risks = [];
  if (job.access !== "confirmed") {
    risks.push(risk("access_unconfirmed", "critical", "Access not confirmed", "Key, code or contact evidence is incomplete.", "Ask the Access Failure Prevention Specialist to verify entry before departure."));
  }
  if (job.supplies === "missing_item") {
    risks.push(risk("supply_missing", "warning", "Spot cleaner missing", "The assigned vehicle does not show the required spot cleaner.", "Collect it before leaving the current area or ask dispatch to stage a replacement."));
  }
  if (job.parking === "limited") {
    risks.push(risk("parking_limited", "warning", "Parking may add 8 minutes", "No dedicated bay is recorded near the service entrance.", "Use the loading zone on Juniper Lane and allow an eight-minute buffer."));
  }
  const riskLevel = risks.some(({ level }) => level === "critical") ? "critical" : risks.length ? "warning" : "clear";
  const preparationMinutes = risks.reduce((total, item) => total + (item.code === "parking_limited" ? 8 : item.code === "supply_missing" ? 10 : 6), 0);
  return Object.freeze({
    ...job,
    risks: Object.freeze(risks),
    risk_level: riskLevel,
    preparation_minutes: preparationMinutes,
    predicted_arrival_minutes: job.start_minutes + preparationMinutes,
  });
}

export function analyseGoSchedule(input) {
  rejectLegacy(input);
  const jobs = Object.freeze((input.jobs ?? []).map(analyseJob));
  const jobsNeedingPreparation = jobs.filter(({ risk_level }) => risk_level !== "clear").length;
  const criticalRisks = jobs.reduce((total, job) => total + job.risks.filter(({ level }) => level === "critical").length, 0);
  return Object.freeze({
    schema_version: GO_SCHEDULE_INTELLIGENCE_VERSION,
    company_id: required(input.company_id, "company_id"),
    actor_id: required(input.actor_id, "actor_id"),
    device_id: required(input.device_id, "device_id"),
    projection_revision: required(input.projection_revision, "projection_revision"),
    now_minutes: input.now_minutes,
    health: criticalRisks ? "at_risk" : jobsNeedingPreparation ? "attention" : "healthy",
    jobs,
    summary: Object.freeze({
      total_jobs: jobs.length,
      jobs_needing_preparation: jobsNeedingPreparation,
      critical_risks: criticalRisks,
      recoverable_minutes: jobs.reduce((total, job) => total + job.preparation_minutes, 0),
    }),
    authority_neutral: true,
  });
}

export function prepareScheduleRecovery(analysis, request) {
  rejectLegacy(request);
  const job = analysis.jobs.find(({ job_id }) => job_id === request.job_id);
  if (!job) throw new TypeError("schedule-job-not-found");
  const allowed = ["notify_dispatch", "prepare_customer_eta", "verify_access", "stage_supply"];
  if (!allowed.includes(request.action)) throw new TypeError("schedule-recovery-not-supported");
  const now = request.now ?? new Date().toISOString();
  const stamp = String(Date.parse(now) || now).replace(/[^a-z0-9]/gi, "");
  const commandId = `go-schedule-${job.job_id}-${stamp}`;
  const intent = Object.freeze({
    schema_version: GO_SCHEDULE_INTELLIGENCE_VERSION,
    command_id: commandId,
    company_id: analysis.company_id,
    actor_id: analysis.actor_id,
    device_id: analysis.device_id,
    surface: "go",
    job_id: job.job_id,
    projection_revision: analysis.projection_revision,
    capability_id: "schedule.recovery",
    operation: request.action,
    idempotency_key: `go:schedule:${job.job_id}:${request.action}:${stamp}`,
    correlation_id: `go-schedule-correlation-${job.job_id}-${stamp}`,
    payload: Object.freeze({ note: required(request.note, "recovery_note"), risk_codes: Object.freeze(job.risks.map(({ code }) => code)) }),
    transport: "titan-command-bus",
    execution_authorised: false,
    requires_server_acceptance: true,
    requires_receipt: true,
  });
  if (request.online === false) {
    return Object.freeze({
      status: "queued_offline",
      intent,
      queue_item: Object.freeze({
        operation_id: commandId,
        company_id: analysis.company_id,
        actor_id: analysis.actor_id,
        device_id: analysis.device_id,
        job_id: job.job_id,
        base_projection_revision: analysis.projection_revision,
        occurred_at: now,
        intent,
        replay_authorised: false,
        requires_revalidation: true,
      }),
      schedule_changed: false,
    });
  }
  return Object.freeze({ status: "awaiting_receipt", intent, queue_item: null, schedule_changed: false });
}
