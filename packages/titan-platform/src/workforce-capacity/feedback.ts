import { assertCompanyId, rejectLegacyTenantBoundary, type CapacityState, type CapacitySubjectKind } from './contracts.js';

export const WORKFORCE_ROUTING_FEEDBACK_SCHEMA = 'titan.workforce.routing-feedback.v1' as const;

export interface RoutingFeedbackObservation {
  company_id: string;
  subject_kind: CapacitySubjectKind;
  subject_id: string;
  observation_window_id: string;
  verified_outcome_count?: number;
  quality_score?: number | null;
  sla_breach_rate?: number | null;
  failure_rate?: number | null;
  rework_rate?: number | null;
  capacity_state?: CapacityState | null;
  previous_adjustment?: number | null;
  source_refs?: string[];
}

export interface RoutingCandidateInput {
  company_id: string;
  subject_kind: CapacitySubjectKind;
  subject_id: string;
  eligible: boolean;
  base_routing_score: number;
  feedback_adjustment?: number | null;
  source_refs?: string[];
}

function bounded(value: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function rate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function unique(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
}

function qualityDelta(score: number | null): { delta: number; reason?: string } {
  if (score == null) return { delta: 0 };
  if (score >= 0.9) return { delta: 3, reason: 'SUSTAINED_HIGH_QUALITY' };
  if (score >= 0.75) return { delta: 1, reason: 'GOOD_QUALITY' };
  if (score < 0.55) return { delta: -4, reason: 'LOW_QUALITY' };
  return { delta: -1, reason: 'QUALITY_REVIEW_RANGE' };
}

export function buildRoutingFeedbackAdjustment(input: RoutingFeedbackObservation) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const subject_id = String(input.subject_id ?? '').trim();
  const observation_window_id = String(input.observation_window_id ?? '').trim();
  if (!subject_id) throw new Error('subject_id is required');
  if (!observation_window_id) throw new Error('observation_window_id is required');
  if (!['worker', 'agent', 'supervisor'].includes(input.subject_kind)) throw new Error('unsupported feedback subject kind');

  const sample = nonNegativeInt(input.verified_outcome_count);
  const quality = rate(input.quality_score);
  const slaBreach = rate(input.sla_breach_rate);
  const failure = rate(input.failure_rate);
  const rework = rate(input.rework_rate);
  const previous = bounded(input.previous_adjustment, -15, 15, 0);
  const reasons: string[] = [];
  let rawDelta = 0;

  // Small samples are visible evidence but do not steer routing yet.
  if (sample < 3) {
    reasons.push('INSUFFICIENT_VERIFIED_SAMPLE');
  } else {
    const qualityResult = qualityDelta(quality);
    rawDelta += qualityResult.delta;
    if (qualityResult.reason) reasons.push(qualityResult.reason);

    if (slaBreach != null) {
      if (slaBreach >= 0.25) { rawDelta -= 4; reasons.push('ELEVATED_SLA_BREACH_RATE'); }
      else if (slaBreach === 0 && sample >= 5) { rawDelta += 1; reasons.push('NO_VERIFIED_SLA_BREACHES'); }
    }
    if (failure != null) {
      if (failure >= 0.2) { rawDelta -= 4; reasons.push('ELEVATED_FAILURE_RATE'); }
      else if (failure === 0 && sample >= 5) { rawDelta += 1; reasons.push('NO_VERIFIED_FAILURES'); }
    }
    if (rework != null && rework >= 0.15) { rawDelta -= 3; reasons.push('ELEVATED_REWORK_RATE'); }

    if (input.capacity_state === 'SATURATED' || input.capacity_state === 'UNAVAILABLE') {
      rawDelta -= 5;
      reasons.push(input.capacity_state === 'SATURATED' ? 'CAPACITY_SATURATED' : 'CAPACITY_UNAVAILABLE');
    } else if (input.capacity_state === 'DEGRADED') {
      rawDelta -= 3;
      reasons.push('CAPACITY_DEGRADED');
    } else if (input.capacity_state === 'CONSTRAINED') {
      rawDelta -= 1;
      reasons.push('CAPACITY_CONSTRAINED');
    }
  }

  // Bounded step prevents one observation window from swinging routing abruptly.
  const appliedDelta = bounded(rawDelta, -5, 5, 0);
  const adjustment = sample < 3 ? previous : bounded(previous + appliedDelta, -15, 15, 0);

  return {
    schema: WORKFORCE_ROUTING_FEEDBACK_SCHEMA,
    company_id,
    subject_kind: input.subject_kind,
    subject_id,
    observation_window_id,
    verified_outcome_count: sample,
    metrics: {
      quality_score: quality,
      sla_breach_rate: slaBreach,
      failure_rate: failure,
      rework_rate: rework,
      capacity_state: input.capacity_state ?? null,
    },
    previous_adjustment: previous,
    raw_delta: rawDelta,
    applied_delta: sample < 3 ? 0 : appliedDelta,
    routing_adjustment: adjustment,
    reasons: unique(reasons),
    minimum_verified_sample: 3,
    max_step_change: 5,
    max_absolute_adjustment: 15,
    deterministic_policy: true,
    audited_inputs_only: true,
    recommendation_only: true,
    policy_mutation_permitted: false,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
    source_refs: unique(input.source_refs),
  } as const;
}

export function rankRoutingCandidatesWithFeedback(input: { company_id: string; candidates: RoutingCandidateInput[] }) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const candidates = (Array.isArray(input.candidates) ? input.candidates : []).map((candidate) => {
    rejectLegacyTenantBoundary(candidate as unknown as Record<string, unknown>);
    if (candidate.company_id !== company_id) throw new Error('cross-company routing candidate rejected');
    const subject_id = String(candidate.subject_id ?? '').trim();
    if (!subject_id) throw new Error('candidate subject_id is required');
    if (!['worker', 'agent', 'supervisor'].includes(candidate.subject_kind)) throw new Error('unsupported candidate subject kind');
    const base = bounded(candidate.base_routing_score, 0, 100, 0);
    const adjustment = bounded(candidate.feedback_adjustment, -15, 15, 0);
    return {
      company_id,
      subject_kind: candidate.subject_kind,
      subject_id,
      eligible: candidate.eligible === true,
      base_routing_score: base,
      feedback_adjustment: adjustment,
      adjusted_routing_score: Number(Math.max(0, Math.min(100, base + adjustment)).toFixed(4)),
      source_refs: unique(candidate.source_refs),
      eligibility_is_external_gate: true,
      feedback_cannot_create_eligibility: true,
      recommendation_only: true,
      execution_permitted: false,
      grants_authority: false,
    } as const;
  });

  const ranked = candidates
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => {
      if (b.adjusted_routing_score !== a.adjusted_routing_score) return b.adjusted_routing_score - a.adjusted_routing_score;
      if (b.base_routing_score !== a.base_routing_score) return b.base_routing_score - a.base_routing_score;
      return `${a.subject_kind}:${a.subject_id}`.localeCompare(`${b.subject_kind}:${b.subject_id}`);
    });

  return {
    schema: 'titan.workforce.routing-feedback-ranking.v1',
    company_id,
    ranked,
    ineligible: candidates.filter((candidate) => !candidate.eligible),
    deterministic: true,
    eligibility_is_external_gate: true,
    feedback_cannot_create_eligibility: true,
    feedback_cannot_grant_authority: true,
    recommendation_only: true,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
  } as const;
}
