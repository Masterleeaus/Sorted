import { describe, expect, it } from "vitest";
import { LocalMemoryKnowledgeStore } from "../src/memory-knowledge.js";
import { MemoryIngestionPipeline } from "../src/memory-ingestion.js";

const candidate = (overrides = {}) => ({
  companyId: "company-a",
  subject: "customer:abc",
  type: "preference" as const,
  scope: "customer" as const,
  scopeId: "customer:abc",
  content: "Use the side gate",
  source: "user" as const,
  sourceId: "message-1",
  observedAt: "2026-09-27T10:00:00Z",
  evidenceRefs: ["message-1"],
  confidence: 0.95,
  ...overrides,
});

describe("MemoryIngestionPipeline", () => {
  it("creates a governed memory with provenance", async () => {
    const store = new LocalMemoryKnowledgeStore();
    const pipeline = new MemoryIngestionPipeline(store);
    const result = await pipeline.ingest(candidate());
    expect(result.disposition).toBe("created");
    expect(result.memory?.provenance.sourceId).toBe("message-1");
  });

  it("deduplicates replayed source events", async () => {
    const store = new LocalMemoryKnowledgeStore();
    const pipeline = new MemoryIngestionPipeline(store);
    const first = await pipeline.ingest(candidate());
    const second = await pipeline.ingest(candidate({ content: "USE THE SIDE GATE" }));
    expect(first.disposition).toBe("created");
    expect(second.disposition).toBe("duplicate");
    expect(second.duplicateOf).toBe(first.memory?.memoryId);
  });

  it("does not deduplicate across companies", async () => {
    const store = new LocalMemoryKnowledgeStore();
    const pipeline = new MemoryIngestionPipeline(store);
    const a = await pipeline.ingest(candidate());
    const b = await pipeline.ingest(candidate({ companyId: "company-b" }));
    expect(a.memory?.memoryId).not.toBe(b.memory?.memoryId);
    expect(b.disposition).toBe("created");
  });

  it("allows newer equally trusted direct instruction to supersede", async () => {
    const store = new LocalMemoryKnowledgeStore();
    const pipeline = new MemoryIngestionPipeline(store);
    const old = await pipeline.ingest(candidate());
    const next = await pipeline.ingest(candidate({
      sourceId: "message-2",
      content: "Please use the front door from now on",
      observedAt: "2026-09-28T10:00:00Z",
    }));
    expect(next.disposition).toBe("superseded");
    expect(next.memory?.supersedes).toBe(old.memory?.memoryId);
  });

  it("does not let lower-confidence model inference silently replace direct memory", async () => {
    const store = new LocalMemoryKnowledgeStore();
    const pipeline = new MemoryIngestionPipeline(store);
    const direct = await pipeline.ingest(candidate());
    const inferred = await pipeline.ingest(candidate({
      source: "model_output" as const,
      sourceId: "model-1",
      content: "Customer probably prefers the front door",
      observedAt: "2026-09-28T10:00:00Z",
      confidence: 0.99,
    }));
    expect(inferred.disposition).toBe("created");
    expect(inferred.memory?.confidence).toBe(0.4);
    expect(inferred.memory?.conflictWith).toEqual([direct.memory?.memoryId]);
    expect(inferred.memory?.supersedes).toBeUndefined();
  });

  it("rejects malformed candidates before persistence", async () => {
    const store = new LocalMemoryKnowledgeStore();
    const pipeline = new MemoryIngestionPipeline(store);
    const result = await pipeline.ingest(candidate({ companyId: "" }));
    expect(result.disposition).toBe("rejected");
    expect(await store.retrieveMemory({ companyId: "company-a" })).toHaveLength(0);
  });
});
