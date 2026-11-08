import assert from "node:assert/strict";
import test from "node:test";
import { buildTitanSchedulingPlan } from "../.test-dist/workforce-native/scheduling.js";

const base = { companyId: "company-1", actorId: "owner-1" };

test("scheduling reads canonical jobs and visits", () => {
  const jobs = buildTitanSchedulingPlan({ ...base, action: "list_jobs", limit: 25 });
  assert.equal(jobs.operation?.path, "/api/v1/jobs");
  assert.equal(jobs.query.limit, "25");
  const visits = buildTitanSchedulingPlan({ ...base, action: "list_visits", jobId: "job-1" });
  assert.equal(visits.operation?.path, "/api/v1/jobs/:id/visits");
  assert.equal(visits.entity_id, "job-1");
});

test("assignment remains proposal-only and company bounded", () => {
  const plan = buildTitanSchedulingPlan({
    ...base,
    action: "propose_assignment",
    jobId: "job-1",
    job: { id: "job-1", required_skills: ["cleaning"] },
    candidates: [
      { worker_id: "tech-a", skills: ["cleaning"], score: 10 },
      { worker_id: "tech-b", skills: [], score: 99 },
    ],
  });
  assert.equal(plan.operation, null);
  assert.equal(plan.authority.assignment_is_proposal_only, true);
  assert.equal(plan.authority.execution_permitted, false);
  assert.equal(plan.conflict_policy.canonical_guard, "visit-conflicts");
  assert.equal(plan.assignment_proposal.grants_authority, false);
});

test("bulk scheduling uses canonical guarded visit route and validates windows", () => {
  const plan = buildTitanSchedulingPlan({
    ...base,
    action: "schedule_visits",
    jobId: "job-1",
    payload: {
      assigned_user_id: "11111111-1111-4111-8111-111111111111",
      days: [{ scheduled_start: "2026-09-14T08:00:00.000Z", scheduled_end: "2026-09-14T10:00:00.000Z" }],
    },
  });
  assert.equal(plan.operation?.id, "project_visits.bulk");
  assert.equal(plan.operation?.path, "/api/v1/jobs/:id/visits/bulk");
  assert.equal(plan.authority.schedule_write_requires_owner_or_admin, true);
  assert.throws(() => buildTitanSchedulingPlan({
    ...base,
    action: "schedule_visits",
    jobId: "job-1",
    payload: { days: [{ scheduled_start: "2026-09-14T10:00:00.000Z", scheduled_end: "2026-09-14T08:00:00.000Z" }] },
  }), /scheduled_end-must-follow/);
});

test("reschedule routes through canonical visit PATCH and rejects unsafe fields", () => {
  const plan = buildTitanSchedulingPlan({
    ...base,
    action: "reschedule_visit",
    visitId: "visit-1",
    payload: { scheduled_start: "2026-09-14T09:00:00.000Z", scheduled_end: "2026-09-14T11:00:00.000Z" },
  });
  assert.equal(plan.operation?.id, "visits.update");
  assert.equal(plan.operation?.method, "PATCH");
  assert.throws(() => buildTitanSchedulingPlan({ ...base, action: "reschedule_visit", visitId: "visit-1", payload: { status: "completed" } }), /reschedule-field-not-allowed/);
});

test("legacy tenant aliases fail closed", () => {
  assert.throws(() => buildTitanSchedulingPlan({ ...base, action: "propose_schedule", jobId: "job-1", payload: { tenant_company_id: "bad", scheduled_start: "2026-09-14T09:00:00Z", scheduled_end: "2026-09-14T10:00:00Z" } }), /legacy-company-boundary/);
});
