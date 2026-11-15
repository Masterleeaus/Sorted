import { test } from "node:test";
import { strict as assert } from "node:assert";
import { auditWorkflowActions, inspectWorkflowDirectory } from "./check-action-runtime.mjs";

test("repository workflows use supported runtime action majors", () => {
  assert.deepEqual(inspectWorkflowDirectory(), []);
});
test("rejects legacy checkout, pnpm, node and upload artifact actions", () => {
  const failures = auditWorkflowActions([["ci.yml",
    ["- uses: actions/checkout@v4",
     "- uses: actions/setup-node@v4",
     "- uses: pnpm/action-setup@v4",
     "- uses: actions/upload-artifact@v4"].join("\n")]]);
  assert.equal(failures.length, 4);
});
test("permits reviewed modern majors and unrelated third-party actions", () => {
  const failures = auditWorkflowActions([["ci.yml",
    ["- uses: actions/checkout@v7",
     "- uses: actions/setup-node@v7",
     "- uses: pnpm/action-setup@v6",
     "- uses: actions/upload-artifact@v7",
     "- uses: anthropics/claude-code-action@v1"].join("\n")]]);
  assert.deepEqual(failures, []);
});
