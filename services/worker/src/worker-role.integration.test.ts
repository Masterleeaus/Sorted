/**
 * Integration: the worker's runtime role runs cross-account sweeps.
 *
 * Model (scripts/db-provision-runtime.sh, docs/working/rls-web-tier-flip.md):
 * ai_fsm_worker carries BYPASSRLS and DML only on the explicit table list in the
 * provisioner (SELECT only on accounts). These tests prove that sweeps connected
 * as that role see and change rows in every account, and that the role has no
 * DDL or superuser rights.
 *
 * Sweeps catch their own errors and return errors: 1, so every assertion also
 * checks errors === 0 and the row-level effect in the database.
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
import { expireEstimates } from "./expire-estimates.js";
import { closeStaleBookingRequests } from "./stale-booking-requests.js";
import { pruneLocationEvents } from "./prune-location-events.js";

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

  it("the worker has no privilege on a table outside its grant list", async () => {
    // schema_migrations is migration bookkeeping; the worker must never touch it.
    await expect(worker.query("SELECT 1 FROM schema_migrations LIMIT 1"))
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

describe.skipIf(!shouldRun)("worker runtime role: other cross-account sweeps", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  const worker = new Client({ connectionString: WORKER_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const accounts = [accountA, accountB];
  let userA = "";
  let userB = "";
  let clientA = "";
  let clientB = "";
  let expiredEstimateA = "";
  let expiredEstimateB = "";
  let liveEstimateA = "";
  let staleBrA = "";
  let staleBrB = "";
  let freshBrA = "";
  let oldLocA = "";
  let oldLocB = "";
  let newLocA = "";

  beforeAll(async () => {
    await admin.connect();
    await worker.connect();
    await admin.query(
      "INSERT INTO accounts (id, name) VALUES ($1, 'Worker sweep C'), ($2, 'Worker sweep D')",
      accounts,
    );
    const users = await admin.query<{ id: string; account_id: string }>(
      `INSERT INTO users (account_id, email, password_hash, full_name, role)
       VALUES ($1, 'worker-sweep-c@test.com', 'hash', 'Sweep C', 'owner'),
              ($2, 'worker-sweep-d@test.com', 'hash', 'Sweep D', 'owner')
       RETURNING id, account_id`,
      accounts,
    );
    userA = users.rows.find((r) => r.account_id === accountA)!.id;
    userB = users.rows.find((r) => r.account_id === accountB)!.id;
    const clients = await admin.query<{ id: string; account_id: string }>(
      `INSERT INTO clients (account_id, name, email)
       VALUES ($1, 'Sweep client C', 'c@sweep.test'), ($2, 'Sweep client D', 'd@sweep.test')
       RETURNING id, account_id`,
      accounts,
    );
    clientA = clients.rows.find((r) => r.account_id === accountA)!.id;
    clientB = clients.rows.find((r) => r.account_id === accountB)!.id;

    const one = async (sql: string, params: unknown[]) =>
      (await admin.query<{ id: string }>(`${sql} RETURNING id`, params)).rows[0].id;
    expiredEstimateA = await one(
      `INSERT INTO estimates (account_id, client_id, created_by, status, expires_at)
       VALUES ($1, $2, $3, 'sent', now() - interval '3 days')`, [accountA, clientA, userA]);
    expiredEstimateB = await one(
      `INSERT INTO estimates (account_id, client_id, created_by, status, expires_at)
       VALUES ($1, $2, $3, 'sent', now() - interval '3 days')`, [accountB, clientB, userB]);
    liveEstimateA = await one(
      `INSERT INTO estimates (account_id, client_id, created_by, status, expires_at)
       VALUES ($1, $2, $3, 'sent', now() + interval '30 days')`, [accountA, clientA, userA]);

    staleBrA = await one(
      `INSERT INTO booking_requests (account_id, name, service_description, status, updated_at)
       VALUES ($1, 'stale A', 'faucet', 'pending', now() - interval '90 days')`, [accountA]);
    staleBrB = await one(
      `INSERT INTO booking_requests (account_id, name, service_description, status, updated_at)
       VALUES ($1, 'stale B', 'faucet', 'pending', now() - interval '90 days')`, [accountB]);
    freshBrA = await one(
      `INSERT INTO booking_requests (account_id, name, service_description, status, updated_at)
       VALUES ($1, 'fresh A', 'faucet', 'pending', now())`, [accountA]);

    oldLocA = await one(
      `INSERT INTO location_events (account_id, occurred_at, kind)
       VALUES ($1, now() - interval '200 days', 'location_update')`, [accountA]);
    oldLocB = await one(
      `INSERT INTO location_events (account_id, occurred_at, kind)
       VALUES ($1, now() - interval '200 days', 'location_update')`, [accountB]);
    newLocA = await one(
      `INSERT INTO location_events (account_id, occurred_at, kind)
       VALUES ($1, now(), 'location_update')`, [accountA]);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM status_history WHERE account_id = ANY($1::uuid[])", [accounts]);
    await admin.query("DELETE FROM location_events WHERE account_id = ANY($1::uuid[])", [accounts]);
    await admin.query("DELETE FROM booking_requests WHERE account_id = ANY($1::uuid[])", [accounts]);
    await admin.query("DELETE FROM estimates WHERE account_id = ANY($1::uuid[])", [accounts]);
    await admin.query("DELETE FROM clients WHERE account_id = ANY($1::uuid[])", [accounts]);
    await admin.query("DELETE FROM users WHERE account_id = ANY($1::uuid[])", [accounts]);
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [accounts]);
    await admin.end();
    await worker.end();
  });

  it("expireEstimates expires past-due sent estimates in every account and leaves live ones", async () => {
    const result = await expireEstimates(worker);
    expect(result).toEqual({ expired: expect.any(Number), errors: 0 });
    expect(result.expired).toBeGreaterThanOrEqual(2);

    const { rows } = await admin.query<{ id: string; status: string }>(
      "SELECT id, status FROM estimates WHERE id = ANY($1::uuid[])",
      [[expiredEstimateA, expiredEstimateB, liveEstimateA]],
    );
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status[expiredEstimateA]).toBe("expired");
    expect(status[expiredEstimateB]).toBe("expired");
    expect(status[liveEstimateA]).toBe("sent");
  });

  it("closeStaleBookingRequests closes idle requests in every account and keeps fresh ones", async () => {
    const result = await closeStaleBookingRequests(worker);
    expect(result).toEqual({ closed: expect.any(Number), errors: 0 });
    expect(result.closed).toBeGreaterThanOrEqual(2);

    const { rows } = await admin.query<{ id: string; status: string; closed_reason: string | null }>(
      "SELECT id, status, closed_reason FROM booking_requests WHERE id = ANY($1::uuid[])",
      [[staleBrA, staleBrB, freshBrA]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[staleBrA]).toMatchObject({ status: "lost", closed_reason: "stale" });
    expect(byId[staleBrB]).toMatchObject({ status: "lost", closed_reason: "stale" });
    expect(byId[freshBrA]).toMatchObject({ status: "pending" });
  });

  it("pruneLocationEvents reads each account's retention and deletes old breadcrumbs only", async () => {
    const result = await pruneLocationEvents(worker);
    expect(result).toEqual({ deleted: expect.any(Number), errors: 0 });
    expect(result.deleted).toBeGreaterThanOrEqual(2);

    const { rows } = await admin.query<{ id: string }>(
      "SELECT id FROM location_events WHERE id = ANY($1::uuid[])",
      [[oldLocA, oldLocB, newLocA]],
    );
    const remaining = rows.map((r) => r.id);
    expect(remaining).toEqual([newLocA]);
  });
});
