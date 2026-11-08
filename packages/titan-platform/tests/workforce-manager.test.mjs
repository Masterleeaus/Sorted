import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkforceManagerAgent, validateWorkforceManagerTeam } from "../.test-dist/workforce-manager/manager-contract.js";
const agent = { company_id: "company-a", agent_id: "agent-1", display_name: "Scheduler", capabilities: ["schedule.read"], evidence_refs: ["evidence-1"], eligible_for_authority_evaluation: true, authority_granted: false };
test("keeps workforce eligibility separate from authority", () => assert.doesNotThrow(() => validateWorkforceManagerAgent(agent)));
test("rejects authority grants and unscoped teams", () => { assert.throws(() => validateWorkforceManagerAgent({ ...agent, authority_granted: true }), /grant authority/); assert.throws(() => validateWorkforceManagerTeam({ company_id: "", team_id: "team-1", member_agent_ids: ["agent-1"], capability_ids: ["schedule.read"] }), /company/); });

