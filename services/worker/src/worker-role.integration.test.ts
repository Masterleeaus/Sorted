/**
 * Integration: the worker's runtime role runs cross-account sweeps.
 *
 * Model (scripts/db-provision-runtime.sh, docs/working/rls-web-tier-flip.md):
 * ai_fsm_worker carries BYPASSRLS and only DML on RLS tables. These tests prove
 * that a sweep connected as that role sees and deletes rows in every account,
 * and that the role has no DDL or superuser rights.
 *
 * Requires:
 *   TEST_DATABASE_URL         admin URL, used to seed fixtures
 *   TEST_WORKER_DATABASE_URL  the ai_fsm_worker role, provisioned after migrations
 * Skipped when either is unset.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneAttentionEvents } from "./prune-attention-events.js";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL;
const shouldRun = !!ADMIN_URL && !!WORKER_URL;

describe.skipIf(!shouldRun)("worker runtime role (ai_fsm_worker)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  const worker = new Client({ connectionString: WORKER_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const staleIds: string[] = [];
  let freshId = "";

  beforeAll(async () => {
    await admin.connect();
    await worker.connect();
    await admin.query(
      "INSERT INTO accounts (id, name) VALUES ($1, 'Worker sweep A'), ($2, 'Worker sweep B')",
      [accountA, accountB],
    );
    const entityId = randomUUID();
    const { rows } = await admin.query<{ id: string; title: string }>(
      `INSERT INTO attention_events (account_id, type, entity_type, entity_id, title, href, created_at)
       VALUES ($1, 'worker_test', 'job', $3, 'stale A', '/test', now() - interval '200 days'),
              ($2, 'worker_test', 'job', $3, 'stale B', '/test', now() - interval '200 days'),
              ($1, 'worker_test', 'job', $3, 'fresh A', '/test', now())
       RETURNING id, title`,
      [accountA, accountB, entityId],
    );
    for (const row of rows) {
      if (row.title.startsWith("stale")) staleIds.push(row.id);
      else freshId = row.id;
    }
  });

  afterAll(async () => {
    await admin.query("DELETE FROM attention_events WHERE account_id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
    await worker.end();
  });

  it("connects as the worker role: BYPASSRLS, no superuser, no DB or role creation", async () => {
    const { rows: [role] } = await worker.query(
      `SELECT current_user AS name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = current_user`,
    );
    expect(role.name).toBe("ai_fsm_worker");
    expect([role.rolsuper, role.rolbypassrls, role.rolcreatedb, role.rolcreaterole])
      .toEqual([false, true, false, false]);
    await expect(worker.query("CREATE TABLE public.worker_must_not_create (id int)"))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("a cross-account sweep deletes eligible rows in every account and keeps recent ones", async () => {
    const result = await pruneAttentionEvents(worker);
    expect(result).toEqual({ deleted: expect.any(Number), errors: 0 });
    expect(result.deleted).toBeGreaterThanOrEqual(staleIds.length);

    const { rows: stale } = await admin.query(
      "SELECT id FROM attention_events WHERE id = ANY($1::uuid[])",
      [staleIds],
    );
    expect(stale).toEqual([]);
    const { rows: fresh } = await admin.query(
      "SELECT id, account_id FROM attention_events WHERE id = $1",
      [freshId],
    );
    expect(fresh).toEqual([{ id: freshId, account_id: accountA }]);
  });
});
