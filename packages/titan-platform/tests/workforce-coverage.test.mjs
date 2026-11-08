import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkforceCoverageClosed, createWorkforceCoverageClosure } from "../.test-dist/workforce-coverage.js";
const agents = [
  { agent_id: "agent-z", company_id: "company-a", kind: "ai", capability_ids: ["dispatch", "evidence"], parent_agent_id: "orchestrator" },
  { agent_id: "orchestrator", company_id: "company-a", kind: "orchestrator", capability_ids: ["dispatch", "evidence"] },
];
test("assigns a deterministic eligible owner and closes coverage", () => {
  const closure = createWorkforceCoverageClosure({ company_id: "company-a", revision: "wf-4", agents, requirements: [{ coverage_id: "coverage-1", company_id: "company-a", outcome_key: "job.completed", required_capability_ids: ["dispatch", "evidence"] }] });
  assert.equal(closure.entries[0].owner_agent_id, "agent-z"); assert.equal(assertWorkforceCoverageClosed(closure), closure);
});
test("fails closed for missing capability coverage, cycles, and cross-company inputs", () => {
  const missing = createWorkforceCoverageClosure({ company_id: "company-a", revision: "wf-4", agents, requirements: [{ coverage_id: "coverage-2", company_id: "company-a", outcome_key: "invoice.verified", required_capability_ids: ["finance"] }] });
  assert.equal(missing.entries[0].status, "MISSING"); assert.throws(() => assertWorkforceCoverageClosed(missing), { message: "workforce-coverage-incomplete" });
  assert.throws(() => createWorkforceCoverageClosure({ company_id: "company-a", revision: "wf-4", agents: [{ ...agents[0], parent_agent_id: "agent-z" }], requirements: [] }), { message: "workforce-hierarchy-cycle" });
  assert.throws(() => createWorkforceCoverageClosure({ company_id: "company-a", revision: "wf-4", agents, requirements: [{ coverage_id: "coverage-3", company_id: "company-b", outcome_key: "job.completed", required_capability_ids: ["dispatch"] }] }), { message: "coverage-company-mismatch" });
});
