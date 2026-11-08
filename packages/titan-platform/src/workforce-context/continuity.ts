import type { WorkforceContextHandoff } from "./handoff.js";
import type { WorkforceTaskCheckpoint } from "./checkpoint.js";

export const WORKFORCE_CONTINUITY_FLOW = [
  "reception", "sales", "quote", "booking", "scheduling", "jobs", "invoice", "care-rebooking",
] as const;
export type WorkforceContinuityStage = (typeof WORKFORCE_CONTINUITY_FLOW)[number];

export type WorkforceContinuityStep = Readonly<{
  stage: WorkforceContinuityStage;
  handoff: WorkforceContextHandoff;
  checkpoint?: WorkforceTaskCheckpoint | null;
}>;

export type WorkforceContinuityReport = Readonly<{
  schema: "titan.workforce.context-continuity/v1";
  company_id: string;
  objective_id: string;
  correlation_id: string | null;
  stages: readonly WorkforceContinuityStage[];
  status: "PASS";
  policies: Readonly<{
    company_boundary_preserved: true;
    objective_preserved: true;
    correlation_preserved: true;
    checkpoint_revision_monotonic: true;
    handoff_is_not_authority: true;
    canonical_records_remain_source_of_truth: true;
  }>;
}>;

export function verifyWorkforceContextContinuity(
  steps: readonly WorkforceContinuityStep[],
): WorkforceContinuityReport {
  if (steps.length !== WORKFORCE_CONTINUITY_FLOW.length) {
    throw new TypeError(`continuity flow requires ${WORKFORCE_CONTINUITY_FLOW.length} stages`);
  }
  const first = steps[0];
  if (!first) throw new TypeError("continuity flow is empty");
  const companyId = first.handoff.company_id;
  const objectiveId = first.handoff.objective_id;
  const correlationId = first.handoff.correlation_id;
  let priorRevision = 0;

  steps.forEach((step, index) => {
    const expectedStage = WORKFORCE_CONTINUITY_FLOW[index];
    if (step.stage !== expectedStage) throw new TypeError(`continuity stage order mismatch: expected ${expectedStage}`);
    if (step.handoff.company_id !== companyId) throw new TypeError(`continuity company_id changed at ${step.stage}`);
    if (step.handoff.objective_id !== objectiveId) throw new TypeError(`continuity objective_id changed at ${step.stage}`);
    if (step.handoff.correlation_id !== correlationId) throw new TypeError(`continuity correlation_id changed at ${step.stage}`);
    if (!step.handoff.policies?.handoff_is_not_authority) throw new TypeError(`handoff authority guard missing at ${step.stage}`);
    if (!step.handoff.policies?.canonical_records_remain_source_of_truth) throw new TypeError(`canonical source-of-truth guard missing at ${step.stage}`);

    if (step.checkpoint) {
      if (step.checkpoint.company_id !== companyId) throw new TypeError(`checkpoint company_id changed at ${step.stage}`);
      if (step.checkpoint.objective_id !== objectiveId) throw new TypeError(`checkpoint objective_id changed at ${step.stage}`);
      if (step.checkpoint.checkpoint_revision <= priorRevision) throw new TypeError(`checkpoint revision is not monotonic at ${step.stage}`);
      priorRevision = step.checkpoint.checkpoint_revision;
      if (!step.checkpoint.policies?.checkpoint_is_not_authority) throw new TypeError(`checkpoint authority guard missing at ${step.stage}`);
    }
  });

  return Object.freeze({
    schema: "titan.workforce.context-continuity/v1",
    company_id: companyId,
    objective_id: objectiveId,
    correlation_id: correlationId,
    stages: WORKFORCE_CONTINUITY_FLOW,
    status: "PASS",
    policies: Object.freeze({
      company_boundary_preserved: true,
      objective_preserved: true,
      correlation_preserved: true,
      checkpoint_revision_monotonic: true,
      handoff_is_not_authority: true,
      canonical_records_remain_source_of_truth: true,
    }),
  });
}
