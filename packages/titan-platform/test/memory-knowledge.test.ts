import { describe, expect, it } from "vitest";
import { LocalMemoryKnowledgeStore, type MemoryRecord } from "../src/memory-knowledge.js";

const memory = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  memoryId: "m1",
  companyId: "c1",
  subject: "customer:abc",
  type: "preference",
  scope: "customer",
  scopeId: "customer:abc",
  content: "Customer prefers SMS",
  provenance: { source: "user", sourceId: "msg-1", observedAt: "2026-09-27T00:00:00Z", evidenceRefs: ["msg-1"] },
  confidence: 0.95,
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-09-27T00:00:00Z",
  ...overrides,
});

describe("LocalMemoryKnowledgeStore", () => {
  it("writes and retrieves bounded company-scoped entity memory", async () => {
    const store = new LocalMemoryKnowledgeStore();
    await store.writeMemory(memory());
    expect(await store.retrieveMemory({ companyId: "c1", subject: "customer:abc" })).toHaveLength(1);
    expect(await store.retrieveMemory({ companyId: "c2", subject: "customer:abc" })).toHaveLength(0);
  });

  it("prevents cross-company supersession", async () => {
    const store = new LocalMemoryKnowledgeStore();
    await store.writeMemory(memory());
    await expect(store.writeMemory(memory({ memoryId: "m2", companyId: "c2", supersedes: "m1" }))).rejects.toThrow("cross-company");
  });

  it("supersedes contradictory old memory instead of returning both", async () => {
    const store = new LocalMemoryKnowledgeStore();
    await store.writeMemory(memory());
    await store.writeMemory(memory({ memoryId: "m2", content: "Customer prefers email", provenance: { source: "user", sourceId: "msg-2", observedAt: "2026-09-28T00:00:00Z" }, supersedes: "m1", createdAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z" }));
    const found = await store.retrieveMemory({ companyId: "c1", subject: "customer:abc" });
    expect(found.map((m) => m.memoryId)).toEqual(["m2"]);
  });

  it("expires memory", async () => {
    const store = new LocalMemoryKnowledgeStore();
    await store.writeMemory(memory({ expiresAt: "2026-09-27T01:00:00Z" }));
    expect(await store.retrieveMemory({ companyId: "c1", now: "2026-09-27T02:00:00Z" })).toHaveLength(0);
  });

  it("caps model inference confidence", async () => {
    const store = new LocalMemoryKnowledgeStore();
    await store.writeMemory(memory({ provenance: { source: "agent_inference", observedAt: "2026-09-27T00:00:00Z" }, confidence: 0.99 }));
    const [found] = await store.retrieveMemory({ companyId: "c1" });
    expect(found.confidence).toBe(0.55);
  });

  it("keeps agent private memory out of another agent context", async () => {
    const store = new LocalMemoryKnowledgeStore();
    await store.writeMemory(memory({ scope: "agent", scopeId: "agent-a" }));
    expect((await store.assembleContext({ companyId: "c1", agentId: "agent-b" })).memories).toHaveLength(0);
    expect((await store.assembleContext({ companyId: "c1", agentId: "agent-a" })).memories).toHaveLength(1);
  });

  it("discovers company/global skills without granting authority", async () => {
    const store = new LocalMemoryKnowledgeStore();
    await store.registerSkill({ skillId: "complaint-triage", version: "1.0.0", description: "Triage cleaning customer complaints and inspect evidence", instructions: "Inspect service record and evidence; prepare response; escalate consequential action.", tags: ["complaint", "cleaning"], provenance: { source: "verified_evidence", observedAt: "2026-09-27T00:00:00Z" }, lifecycle: "active", enabled: true });
    const skills = await store.getRelevantSkills("c1", "customer cleaning complaint", 3);
    expect(skills[0]?.skillId).toBe("complaint-triage");
    expect("authority" in (skills[0] ?? {})).toBe(false);
  });
});
