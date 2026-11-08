import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSqliteStorage } from "@titan-zero/storage";
import { WorkforceService } from "./index.js";

describe("workforce durability and control", () => {
  it("survives process-style storage restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "titan-workforce-"));
    const file = join(dir, "workforce.db");
    try {
      const firstStorage = createSqliteStorage(file);
      const first = new WorkforceService(firstStorage);
      await first.initialize();
      await first.registerWorker("acme", { workerId: "ops", kind: "digital", role: "manager", capabilities: [] });
      const work = await first.createWork("acme", { objective: "Persistent work", creator: { type: "system", id: "signal" }, assigneeWorkerId: "ops" });
      await firstStorage.close();

      const secondStorage = createSqliteStorage(file);
      const second = new WorkforceService(secondStorage);
      await second.initialize();
      expect((await second.getWork("acme", work.workId)).objective).toBe("Persistent work");
      expect((await second.getWorker("acme", "ops")).kind).toBe("digital");
      await secondStorage.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports explicit reassignment without authority mutation", async () => {
    const storage = createSqliteStorage(":memory:");
    const service = new WorkforceService(storage);
    await service.initialize();
    await service.registerWorker("acme", { workerId: "a", kind: "digital", role: "specialist", capabilities: [] });
    await service.registerWorker("acme", { workerId: "b", kind: "digital", role: "manager", capabilities: [] });
    const work = await service.createWork("acme", { objective: "Reassign me", creator: { type: "human", id: "one" }, assigneeWorkerId: "a", authorityRequirement: "invoice.send" });
    const reassigned = await service.assignWork("acme", work.workId, "b");
    expect(reassigned.assigneeWorkerId).toBe("b");
    expect(reassigned.authorityRequirement).toBe("invoice.send");
    await storage.close();
  });

  it("blocks and resumes work through validated lifecycle states", async () => {
    const storage = createSqliteStorage(":memory:");
    const service = new WorkforceService(storage);
    await service.initialize();
    await service.registerWorker("acme", { workerId: "ops", kind: "digital", role: "manager", capabilities: [] });
    const work = await service.createWork("acme", { objective: "Need information", creator: { type: "system", id: "signal" }, assigneeWorkerId: "ops" });
    await service.claimWork("acme", work.workId, "ops");
    await service.startWork("acme", work.workId, "ops");
    expect((await service.blockWork("acme", work.workId, "missing business information")).state).toBe("BLOCKED");
    expect((await service.resumeWork("acme", work.workId)).state).toBe("READY");
    await storage.close();
  });
});
