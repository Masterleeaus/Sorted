import test from "node:test";
import assert from "node:assert/strict";

import {
  createMemoryStorageAdapter,
  createCompanyRepository,
} from "../.test-dist/storage/index.js";
import {
  createOfflineOperationIdentity,
  createOfflineOperationRegistry,
} from "../.test-dist/offline/index.js";

const ctx = (company_id = "company-a", extra = {}) => ({
  company_id,
  actor_id: "field-worker-1",
  operation_id: "op-1",
  idempotency_key: "idem-1",
  ...extra,
});

function setup() {
  const repository = createCompanyRepository({ adapter: createMemoryStorageAdapter(), clock: () => 1000 });
  const registry = createOfflineOperationRegistry({ repository, clock: () => 1000 });
  return { repository, registry };
}

test("offline operation identity is deterministic and company scoped", () => {
  const a = createOfflineOperationIdentity(ctx(), {
    mutation_kind: "UPDATE",
    target: "jobs/j1",
    payload: { b: 2, a: 1 },
  });
  const b = createOfflineOperationIdentity(ctx(), {
    mutation_kind: "update",
    target: "jobs/j1",
    payload: { a: 1, b: 2 },
  });
  assert.deepEqual(a, b);
  assert.equal(a.company_id, "company-a");
});

test("legacy and cross-company payload boundaries fail closed", () => {
  assert.throws(
    () => createOfflineOperationIdentity(ctx(), {
      mutation_kind: "update",
      target: "jobs/j1",
      payload: { tenant_id: "legacy" },
    }),
    /legacy tenant boundary/i,
  );
  assert.throws(
    () => createOfflineOperationIdentity(ctx(), {
      mutation_kind: "update",
      target: "jobs/j1",
      payload: { company_id: "company-b" },
    }),
    /cross-company/i,
  );
});

test("first prepare persists a neutral receipt and duplicate delivery returns it", async () => {
  const { registry } = setup();
  const input = { mutation_kind: "update", target: "jobs/j1", payload: { status: "done" } };
  const first = await registry.prepare(ctx(), input);
  const duplicate = await registry.prepare(ctx(), input);
  assert.equal(first.status, "prepared");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.receipt.operation_id, "op-1");
  assert.equal(duplicate.receipt.grants_authority, false);
});

test("same idempotency key with different mutation conflicts without overwriting receipt", async () => {
  const { registry } = setup();
  await registry.prepare(ctx(), {
    mutation_kind: "update",
    target: "jobs/j1",
    payload: { status: "open" },
  });
  const conflict = await registry.prepare(ctx(), {
    mutation_kind: "update",
    target: "jobs/j1",
    payload: { status: "done" },
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.reason, "idempotency_key_reused");
  const stored = await registry.get(ctx(), "op-1");
  assert.equal(stored.state, "prepared");
});

test("operation id reused with another idempotency key conflicts", async () => {
  const { registry } = setup();
  await registry.prepare(ctx(), {
    mutation_kind: "create",
    target: "notes/n1",
    payload: { text: "a" },
  });
  const conflict = await registry.prepare(ctx("company-a", { idempotency_key: "idem-2" }), {
    mutation_kind: "create",
    target: "notes/n1",
    payload: { text: "a" },
  });
  assert.equal(conflict.reason, "operation_id_reused");
});

test("same operation identity is isolated between companies", async () => {
  const { registry } = setup();
  const input = { mutation_kind: "update", target: "jobs/j1", payload: { status: "done" } };
  assert.equal((await registry.prepare(ctx("company-a"), input)).status, "prepared");
  assert.equal((await registry.prepare(ctx("company-b"), input)).status, "prepared");
  assert.equal((await registry.list(ctx("company-a"))).length, 1);
  assert.equal((await registry.list(ctx("company-b"))).length, 1);
});

test("receipt transitions preserve authority neutrality and terminal receipts cannot mutate", async () => {
  const { registry } = setup();
  await registry.prepare(ctx(), {
    mutation_kind: "update",
    target: "jobs/j1",
    payload: { status: "done" },
  });
  const queued = await registry.transition(ctx(), "op-1", "queued");
  const committed = await registry.transition(ctx(), "op-1", "committed", { evidence: { server_revision: 7 } });
  assert.equal(queued.terminal, false);
  assert.equal(committed.terminal, true);
  assert.equal(committed.grants_authority, false);
  assert.equal(committed.automatic_effect_replay, false);
  await assert.rejects(() => registry.transition(ctx(), "op-1", "submitted"), /terminal/i);
});

test("registry descriptor makes identity-not-authority explicit", () => {
  const { registry } = setup();
  assert.equal(registry.descriptor.idempotency_required, true);
  assert.equal(registry.descriptor.duplicate_delivery_safe, true);
  assert.equal(registry.descriptor.identity_grants_authority, false);
  assert.equal(registry.descriptor.execution_authority, false);
});
