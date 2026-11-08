import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteStorage, type StorageClient } from "@titan-zero/storage";
import { WorkforceService, type AgentRuntimeAdapter } from "./index.js";

let storage: StorageClient;
let service: WorkforceService;
const run = vi.fn(async () => ({ outcome: "completed" as const, result: { ok: true }, evidenceRefs: ["evidence:1"] }));
const runtime: AgentRuntimeAdapter = { run };

beforeEach(async () => {
  run.mockClear();
  storage = createSqliteStorage(":memory:");
  service = new WorkforceService(storage, { runtime });
  await service.initialize();
  await service.registerWorker("acme", { workerId: "ops", kind: "digital", role: "manager", capabilities: ["schedule.read", "work.delegate"] });
  await service.registerWorker("acme", { workerId: "scheduler", kind: "digital", role: "specialist", managerWorkerId: "ops", capabilities: ["schedule.read", "schedule.prepare"] });
  await service.registerWorker("acme", { workerId: "cleaner-1", kind: "human", role: "field-worker", capabilities: ["service.clean"] });
});
afterEach(async () => storage.close());

async function startAs(workId: string, workerId = "ops") {
  await service.claimWork("acme", workId, workerId);
  await service.startWork("acme", workId, workerId);
}

describe("canonical work lifecycle", () => {
  it("creates, assigns, claims, completes and persists evidence without granting authority", async () => {
    const work = await service.createWork("acme", { objective: "Prepare schedule", creator: { type: "worker", id: "ops" }, assigneeWorkerId: "scheduler", requiredCapabilities: ["schedule.prepare"], authorityRequirement: "schedule.publish" });
    expect(work.state).toBe("READY");
    const claimed = await service.claimWork("acme", work.workId, "scheduler");
    expect(claimed.state).toBe("CLAIMED");
    expect(claimed.authorityRequirement).toBe("schedule.publish");
    await service.startWork("acme", work.workId, "scheduler");
    const completed = await service.completeWork("acme", work.workId, { ok: true }, ["receipt:1"]);
    expect(completed.state).toBe("COMPLETED");
    expect(completed.evidenceRefs).toEqual(["receipt:1"]);
  });

  it("rejects duplicate claims", async () => {
    const work = await service.createWork("acme", { objective: "Review schedule", creator: { type: "system", id: "signal" }, teamId: "operations", requiredCapabilities: ["schedule.read"] });
    await service.claimWork("acme", work.workId, "ops");
    await expect(service.claimWork("acme", work.workId, "scheduler")).rejects.toThrow(/claimable/);
  });

  it("blocks dependants until prerequisites complete and rejects circular dependencies", async () => {
    const first = await service.createWork("acme", { objective: "Inspect request", creator: { type: "worker", id: "ops" } });
    const second = await service.createWork("acme", { objective: "Prepare quote", creator: { type: "worker", id: "ops" }, dependencies: [first.workId] });
    expect(second.state).toBe("CREATED");
    await startAs(first.workId);
    await service.completeWork("acme", first.workId, { inspected: true });
    expect((await service.getWork("acme", second.workId)).state).toBe("READY");
    await expect(service.addDependency("acme", first.workId, second.workId)).rejects.toThrow(/circular/);
  });

  it("supports waiting, approval waiting and resume", async () => {
    const work = await service.createWork("acme", { objective: "Wait for customer", creator: { type: "worker", id: "ops" }, assigneeWorkerId: "scheduler" });
    await startAs(work.workId, "scheduler");
    expect((await service.waitWork("acme", work.workId, "external", "customer.reply")).state).toBe("WAITING_EXTERNAL");
    expect((await service.resumeWork("acme", work.workId, "customer.reply")).state).toBe("READY");
    await startAs(work.workId, "scheduler");
    expect((await service.waitWork("acme", work.workId, "approval", "decision.approved")).state).toBe("WAITING_APPROVAL");
    expect((await service.resumeWork("acme", work.workId, "decision.approved")).state).toBe("READY");
  });

  it("delegates and decomposes without copying authority", async () => {
    const parent = await service.createWork("acme", { objective: "Sort staffing", creator: { type: "human", id: "one" }, assigneeWorkerId: "ops", authorityRequirement: "staff.notify" });
    const [child] = await service.decomposeWork("acme", parent.workId, "ops", [{ objective: "Find uncovered jobs", assigneeWorkerId: "scheduler", requiredCapabilities: ["schedule.read"] }]);
    expect(child.parentWorkId).toBe(parent.workId);
    expect(child.authorityRequirement).toBeNull();
    expect((await service.listEvents("acme", child.workId)).some(e => e.type === "work.delegated")).toBe(true);
  });

  it("escalates to a manager while preserving context and evidence references", async () => {
    const work = await service.createWork("acme", { objective: "Resolve conflict", creator: { type: "worker", id: "ops" }, assigneeWorkerId: "scheduler", contextRefs: ["memory:policy"], evidenceRefs: ["evidence:conflict"] });
    const escalated = await service.escalateWork("acme", work.workId, "scheduler", "policy_conflict");
    expect(escalated.assigneeWorkerId).toBe("ops");
    expect(escalated.contextRefs).toEqual(["memory:policy"]);
    expect(escalated.evidenceRefs).toEqual(["evidence:conflict"]);
  });

  it("distinguishes human field workers from digital runtime workers", async () => {
    const work = await service.createWork("acme", { objective: "Clean site", creator: { type: "worker", id: "ops" }, assigneeWorkerId: "cleaner-1" });
    await expect(service.dispatchReady("acme")).resolves.toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(work.assigneeWorkerId).toBe("cleaner-1");
  });

  it("dispatches ready digital work through the Agent 2 adapter", async () => {
    const work = await service.createWork("acme", { objective: "Prepare schedule", creator: { type: "worker", id: "ops" }, assigneeWorkerId: "scheduler", requiredCapabilities: ["schedule.prepare"] });
    expect(await service.dispatchReady("acme")).toEqual([work.workId]);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await service.getWork("acme", work.workId)).state).toBe("COMPLETED");
  });

  it("enforces company isolation", async () => {
    const work = await service.createWork("acme", { objective: "Private work", creator: { type: "system", id: "signal" } });
    await expect(service.getWork("other", work.workId)).rejects.toThrow(/not found/);
    await expect(service.claimWork("other", work.workId, "scheduler")).rejects.toThrow(/not found/);
  });

  it("fails and cancels work through validated transitions", async () => {
    const failed = await service.createWork("acme", { objective: "Fail me", creator: { type: "system", id: "signal" } });
    expect((await service.failWork("acme", failed.workId, "tool_error")).state).toBe("FAILED");
    const cancelled = await service.createWork("acme", { objective: "Cancel me", creator: { type: "system", id: "signal" } });
    expect((await service.cancelWork("acme", cancelled.workId, "one.request")).state).toBe("CANCELLED");
  });

  it("creates recurring work idempotently per occurrence", async () => {
    const recurring = await service.createRecurringWork("acme", { recurringId: "daily-review", schedule: "0 8 * * 1-5", template: { objective: "Review today's field schedule", creator: { type: "system", id: "scheduler" }, assigneeWorkerId: "scheduler" } });
    const a = await service.activateRecurring("acme", recurring.recurringId, "2026-09-28");
    const b = await service.activateRecurring("acme", recurring.recurringId, "2026-09-28");
    expect(a.workId).toBe(b.workId);
  });
});
