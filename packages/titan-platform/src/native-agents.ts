import {
  assertTitanBusinessOpsAgentCommandAllowed,
  type TitanBusinessOpsAgentCommandId,
  type TitanBusinessOpsAgentKey,
} from "./business-ops.js";

const clean = (value: unknown): string => String(value ?? "").trim();

export type TitanNativeAgentProposedCommand = Readonly<{
  agentKey: TitanBusinessOpsAgentKey;
  commandId: TitanBusinessOpsAgentCommandId;
  entityId?: string;
  query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  body?: unknown;
  reason: string;
  requiresHumanApproval: boolean;
}>;

export type TitanDispatchWorker = Readonly<{
  worker_id: string;
  company_id: string;
  available?: boolean;
  skills?: readonly string[];
  active_jobs?: number;
  distance_km?: number;
  site_match?: boolean;
  urgent_ready?: boolean;
}>;

export type TitanDispatchJob = Readonly<{
  id?: string;
  job_id?: string;
  company_id: string;
  required_skills?: readonly string[];
  urgent?: boolean;
  work_order_id?: string;
}>;

export type TitanDispatchProposal = Readonly<{
  schema: "titan.workforce.starter.dispatch-proposal.v1";
  company_id: string;
  job_id: string;
  recommended_worker_id: string | null;
  candidates: readonly Readonly<{ worker_id: string; score: number }>[];
  state: "PROPOSED" | "NO_MATCH";
  requires_human_approval: true;
  direct_assignment: false;
  execution_permitted: false;
  grants_authority: false;
}>;

/** Ported from the Titan Zero starter Dispatch Agent. */
export function scoreNativeDispatchCandidate(worker: TitanDispatchWorker, job: TitanDispatchJob): number {
  if (clean(worker.company_id) !== clean(job.company_id)) return Number.NEGATIVE_INFINITY;
  if (worker.available === false) return Number.NEGATIVE_INFINITY;
  let score = 0;
  const skills = new Set((worker.skills ?? []).map(clean));
  for (const skill of job.required_skills ?? []) score += skills.has(clean(skill)) ? 20 : -50;
  score -= Math.max(0, Number(worker.active_jobs ?? 0)) * 5;
  score -= Math.max(0, Number(worker.distance_km ?? 0));
  if (worker.site_match === true) score += 15;
  if (worker.urgent_ready === true && job.urgent === true) score += 20;
  return score;
}

/** Ported from the Titan Zero starter Dispatch Agent. */
export function buildNativeDispatchProposal(input: {
  company_id: string;
  job: TitanDispatchJob;
  workers: readonly TitanDispatchWorker[];
}): TitanDispatchProposal {
  const companyId = clean(input.company_id);
  if (!companyId) throw new Error("company_id-required");
  if (clean(input.job.company_id) && clean(input.job.company_id) !== companyId) throw new Error("cross-company-job");
  const job: TitanDispatchJob = { ...input.job, company_id: companyId };
  const ranked = (input.workers ?? [])
    .map((worker) => ({ worker, score: scoreNativeDispatchCandidate(worker, job) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score || clean(a.worker.worker_id).localeCompare(clean(b.worker.worker_id)));
  return {
    schema: "titan.workforce.starter.dispatch-proposal.v1",
    company_id: companyId,
    job_id: clean(job.job_id ?? job.id),
    recommended_worker_id: clean(ranked[0]?.worker.worker_id) || null,
    candidates: ranked.map(({ worker, score }) => ({ worker_id: clean(worker.worker_id), score })),
    state: ranked.length ? "PROPOSED" : "NO_MATCH",
    requires_human_approval: true,
    direct_assignment: false,
    execution_permitted: false,
    grants_authority: false,
  };
}

export function planNativeDispatch(input: {
  company_id: string;
  job: TitanDispatchJob;
  workers: readonly TitanDispatchWorker[];
}): Readonly<{ proposal: TitanDispatchProposal; commands: readonly TitanNativeAgentProposedCommand[] }> {
  const proposal = buildNativeDispatchProposal(input);
  const commands: TitanNativeAgentProposedCommand[] = [];
  const workOrderId = clean(input.job.work_order_id);
  if (proposal.recommended_worker_id && workOrderId) {
    assertTitanBusinessOpsAgentCommandAllowed("dispatch", "work_orders.list");
    commands.push({
      agentKey: "dispatch",
      commandId: "work_orders.list",
      query: { id: workOrderId },
      reason: `Validate work order ${workOrderId} before assigning recommended worker ${proposal.recommended_worker_id}.`,
      requiresHumanApproval: false,
    });
  }
  return { proposal, commands };
}

export type TitanInvoiceLineInput = Readonly<{
  line_id?: string;
  description: string;
  quantity?: number;
  unit_price_cents: number;
}>;

export type TitanInvoiceDraft = Readonly<{
  schema: "titan.workforce.starter.invoice-draft.v1";
  company_id: string;
  job_id: string;
  customer_id: string;
  currency: string;
  lines: readonly Readonly<{ line_id: string; description: string; quantity: number; unit_price_cents: number }>[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  state: "DRAFT_PROPOSAL";
  requires_review: true;
  send_permitted: false;
  payment_mutation_permitted: false;
  execution_permitted: false;
  grants_authority: false;
}>;

/** Ported from the Titan Zero starter Invoicing Agent. */
export function evaluateNativeInvoiceReadiness(input: {
  company_id: string;
  job_id?: string;
  job_completed?: boolean;
  completion_evidence_verified?: boolean;
  customer_id?: string;
  lines?: readonly TitanInvoiceLineInput[];
}) {
  const companyId = clean(input.company_id);
  if (!companyId) throw new Error("company_id-required");
  const blockers: string[] = [];
  if (!clean(input.job_id)) blockers.push("job-required");
  if (input.job_completed !== true) blockers.push("job-not-complete");
  if (input.completion_evidence_verified !== true) blockers.push("completion-evidence-unverified");
  if (!clean(input.customer_id)) blockers.push("customer-required");
  if (!(input.lines ?? []).length) blockers.push("invoice-lines-required");
  return {
    schema: "titan.workforce.starter.invoice-readiness.v1" as const,
    company_id: companyId,
    job_id: clean(input.job_id) || null,
    ready: blockers.length === 0,
    blockers,
    execution_permitted: false as const,
    grants_authority: false as const,
  };
}

/** Ported from the Titan Zero starter Invoicing Agent. */
export function buildNativeInvoiceDraft(input: {
  company_id: string;
  job_id: string;
  job_completed: boolean;
  completion_evidence_verified: boolean;
  customer_id: string;
  lines: readonly TitanInvoiceLineInput[];
  tax_rate?: number;
  currency?: string;
}): TitanInvoiceDraft {
  const readiness = evaluateNativeInvoiceReadiness(input);
  if (!readiness.ready) throw new Error(`invoice-not-ready:${readiness.blockers.join(",")}`);
  const lines = input.lines.map((line, index) => {
    if (!Number.isInteger(line.unit_price_cents) || line.unit_price_cents < 0) throw new Error("money-cents-required");
    const quantity = Number(line.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("positive-quantity-required");
    return {
      line_id: clean(line.line_id) || `line-${index + 1}`,
      description: clean(line.description),
      quantity,
      unit_price_cents: line.unit_price_cents,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unit_price_cents), 0);
  const taxRate = Number(input.tax_rate ?? 0);
  if (!Number.isFinite(taxRate) || taxRate < 0) throw new Error("invalid-tax-rate");
  const tax = Math.round(subtotal * taxRate);
  return {
    schema: "titan.workforce.starter.invoice-draft.v1",
    company_id: readiness.company_id,
    job_id: clean(input.job_id),
    customer_id: clean(input.customer_id),
    currency: clean(input.currency) || "AUD",
    lines,
    subtotal_cents: subtotal,
    tax_cents: tax,
    total_cents: subtotal + tax,
    state: "DRAFT_PROPOSAL",
    requires_review: true,
    send_permitted: false,
    payment_mutation_permitted: false,
    execution_permitted: false,
    grants_authority: false,
  };
}

export function planNativeInvoice(input: Parameters<typeof buildNativeInvoiceDraft>[0]): Readonly<{
  draft: TitanInvoiceDraft;
  commands: readonly TitanNativeAgentProposedCommand[];
}> {
  const draft = buildNativeInvoiceDraft(input);
  assertTitanBusinessOpsAgentCommandAllowed("invoicing", "invoices.create");
  return {
    draft,
    commands: [{
      agentKey: "invoicing",
      commandId: "invoices.create",
      body: {
        job_id: draft.job_id,
        customer_id: draft.customer_id,
        currency: draft.currency,
        lines: draft.lines,
      },
      reason: "Create a native Business Ops invoice draft from verified completed-work evidence.",
      requiresHumanApproval: true,
    }],
  };
}

export function scoreNativeRebookingCandidate(input: {
  priorCompletedServices: number;
  daysSinceLastService?: number;
  cadenceDays?: number;
  consentKnown: boolean;
  consentPermitted: boolean;
  optedOut?: boolean;
  activeBookingExists?: boolean;
  openComplaint?: boolean;
  recurringInterest?: boolean;
}): Readonly<{ score: number; recommendation: "NONE" | "REBOOK"; reasons: readonly string[] }> {
  const reasons: string[] = [];
  if (!input.consentKnown || !input.consentPermitted || input.optedOut) return { score: 0, recommendation: "NONE", reasons: ["CONSENT_BLOCK"] };
  if (input.activeBookingExists) return { score: 0, recommendation: "NONE", reasons: ["ACTIVE_BOOKING_EXISTS"] };
  if (input.openComplaint) return { score: 0, recommendation: "NONE", reasons: ["OPEN_COMPLAINT"] };
  let score = 0;
  if (input.priorCompletedServices >= 3) { score += 30; reasons.push("MULTIPLE_COMPLETED_SERVICES"); }
  else if (input.priorCompletedServices === 2) { score += 22; reasons.push("REPEAT_SERVICE_EVIDENCE"); }
  else if (input.priorCompletedServices === 1) { score += 10; reasons.push("ONE_COMPLETED_SERVICE"); }
  if (input.recurringInterest) { score += 30; reasons.push("CUSTOMER_RECURRING_INTEREST"); }
  if (Number.isFinite(input.daysSinceLastService) && Number.isFinite(input.cadenceDays) && Number(input.cadenceDays) > 0) {
    const ratio = Number(input.daysSinceLastService) / Number(input.cadenceDays);
    if (ratio >= 1) { score += 35; reasons.push("DUE_OR_OVERDUE"); }
    else if (ratio >= 0.8) { score += 20; reasons.push("APPROACHING_DUE_DATE"); }
  }
  score = Math.max(0, Math.min(100, score));
  return { score, recommendation: score >= 50 ? "REBOOK" : "NONE", reasons };
}

export function planNativeRebooking(input: {
  company_id: string;
  customer_id: string;
  priorCompletedServices: number;
  daysSinceLastService?: number;
  cadenceDays?: number;
  consentKnown: boolean;
  consentPermitted: boolean;
  optedOut?: boolean;
  activeBookingExists?: boolean;
  openComplaint?: boolean;
  recurringInterest?: boolean;
  requestedService?: string;
}): Readonly<{ assessment: ReturnType<typeof scoreNativeRebookingCandidate>; commands: readonly TitanNativeAgentProposedCommand[] }> {
  if (!clean(input.company_id)) throw new Error("company_id-required");
  if (!clean(input.customer_id)) throw new Error("customer_id-required");
  const assessment = scoreNativeRebookingCandidate(input);
  if (assessment.recommendation !== "REBOOK") return { assessment, commands: [] };
  assertTitanBusinessOpsAgentCommandAllowed("rebooking", "booking_requests.create");
  return {
    assessment,
    commands: [{
      agentKey: "rebooking",
      commandId: "booking_requests.create",
      body: {
        client_id: clean(input.customer_id),
        requested_service: clean(input.requestedService) || undefined,
        source: "titan-rebooking-agent",
        metadata: { rebooking_score: assessment.score, reasons: assessment.reasons },
      },
      reason: "Create a governed repeat-service opportunity from deterministic rebooking evidence.",
      requiresHumanApproval: true,
    }],
  };
}

export function planNativeEstimate(input: {
  customer_id: string;
  property_id?: string;
  lines: readonly Readonly<{ description: string; quantity?: number; unit_price_cents: number }>[];
  notes?: string;
}): Readonly<{ commands: readonly TitanNativeAgentProposedCommand[] }> {
  if (!clean(input.customer_id)) throw new Error("customer_id-required");
  if (!(input.lines ?? []).length) throw new Error("estimate-lines-required");
  assertTitanBusinessOpsAgentCommandAllowed("quote", "estimates.create");
  return {
    commands: [{
      agentKey: "quote",
      commandId: "estimates.create",
      body: {
        customer_id: clean(input.customer_id),
        property_id: clean(input.property_id) || undefined,
        lines: input.lines,
        notes: clean(input.notes) || undefined,
      },
      reason: "Create a native Business Ops estimate draft using the Estimating Agent profile.",
      requiresHumanApproval: true,
    }],
  };
}

export function planNativeCrm(input: {
  mode: "search" | "create";
  query?: string;
  client?: Readonly<Record<string, unknown>>;
}): Readonly<{ commands: readonly TitanNativeAgentProposedCommand[] }> {
  if (input.mode === "search") {
    assertTitanBusinessOpsAgentCommandAllowed("crm", "clients.list");
    return { commands: [{ agentKey: "crm", commandId: "clients.list", query: { q: clean(input.query) }, reason: "Find matching CRM customers before creating duplicates.", requiresHumanApproval: false }] };
  }
  assertTitanBusinessOpsAgentCommandAllowed("crm", "clients.create");
  return { commands: [{ agentKey: "crm", commandId: "clients.create", body: input.client ?? {}, reason: "Create a customer through the native Business Ops CRM API.", requiresHumanApproval: true }] };
}

export type TitanNativeAgentPlanInput =
  | Readonly<{ agentKey: "dispatch"; payload: Parameters<typeof planNativeDispatch>[0] }>
  | Readonly<{ agentKey: "invoicing"; payload: Parameters<typeof planNativeInvoice>[0] }>
  | Readonly<{ agentKey: "rebooking"; payload: Parameters<typeof planNativeRebooking>[0] }>
  | Readonly<{ agentKey: "quote"; payload: Parameters<typeof planNativeEstimate>[0] }>
  | Readonly<{ agentKey: "crm"; payload: Parameters<typeof planNativeCrm>[0] }>;

export function planTitanNativeAgent(input: TitanNativeAgentPlanInput) {
  switch (input.agentKey) {
    case "dispatch": return planNativeDispatch(input.payload);
    case "invoicing": return planNativeInvoice(input.payload);
    case "rebooking": return planNativeRebooking(input.payload);
    case "quote": return planNativeEstimate(input.payload);
    case "crm": return planNativeCrm(input.payload);
  }
}
