import test from "node:test";
import assert from "node:assert/strict";

import {
  getTitanBusinessOpsAgentCommand,
  assessTitanBusinessOpsAgentCommand,
  materializeTitanBusinessOpsPath,
} from "../.test-dist/business-ops.js";

test("Field donors converge onto the existing Job/Work Order/Visit command seam", () => {
  const expected = [
    ["projects.get", "/api/v1/jobs/:id"],
    ["work_orders.list", "/api/v1/work-orders"],
    ["work_orders.complete", "/api/v1/work-orders/:id/complete"],
    ["work_orders.start_visit", "/api/v1/work-orders/:id/start-visit"],
    ["visits.get", "/api/v1/visits/:id"],
    ["visits.transition", "/api/v1/visits/:id/transition"],
    ["visits.on_my_way", "/api/v1/visits/:id/on-my-way"],
  ];
  for (const [id, path] of expected) assert.equal(getTitanBusinessOpsAgentCommand(id)?.path, path);
});

test("Field mutations remain explicitly governed rather than advisory authority", () => {
  for (const id of ["work_orders.complete", "work_orders.start_visit", "visits.transition", "visits.on_my_way"]) {
    const command = getTitanBusinessOpsAgentCommand(id);
    assert.equal(command?.mutating, true);
    const risk = assessTitanBusinessOpsAgentCommand({ companyId: "company-a", commandId: id });
    assert.equal(risk.company_id, "company-a");
  }
});

test("Field entity paths are constrained to the existing command template", () => {
  assert.equal(materializeTitanBusinessOpsPath("/api/v1/visits/:id/transition", "visit-123"), "/api/v1/visits/visit-123/transition");
  assert.throws(() => materializeTitanBusinessOpsPath("/api/v1/visits/:id/transition", "../other-company"), /valid entity id/);
});
