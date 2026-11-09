/**
 * Integration: cross-account isolation in worker automations and the notification queue.
 *
 * Two accounts (A and B) share a technician name, and B owns rows that A's
 * automations could wrongly join or match by id or by key. Each test checks that
 * A's run never uses B's rows.
 *
 * Requires:
 *   TEST_DATABASE_URL         admin URL, used to seed fixtures
 *   TEST_WORKER_DATABASE_URL  the ai_fsm_worker role (optional; falls back to TEST_DATABASE_URL)
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findEligibleJobs } from "./review-request.js";
import { findEligibleBookings } from "./booking-confirmed.js";
import { findEligibleVisits } from "./visit-reminder.js";
import { findOverdueInvoices } from "./invoice-followup.js";
import { enqueueNotification, cancelNotificationsForEntity } from "./notification/enqueue.js";
import { PRIORITY } from "./notification/priority.js";
import type { AutomationRow } from "./automations/types.js";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL ?? ADMIN_URL;
const shouldRun = !!ADMIN_URL;

interface Tenant {
  accountId: string;
  userId: string;
  clientId: string;
  clientName: string;
  propertyId: string;
  propertyAddress: string;
  jobId: string;
}

describe.skipIf(!shouldRun)("cross-account isolation (worker)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  const worker = new Client({ connectionString: WORKER_URL });
  const tag = randomUUID().slice(0, 8);
  let a: Tenant;
  let b: Tenant;

  // The DB's write-time triggers already refuse cross-account invoice payers and jobs.
  // These fixtures bypass them (admin session, replica role) to test the read-side join,
  // which is defence in depth for legacy or bypassed rows.
  async function insertInvoiceFixture(sql: string, params: unknown[]): Promise<string> {
    await admin.query("BEGIN");
    try {
      await admin.query("SET LOCAL session_replication_role = replica");
      const r = await admin.query<{ id: string }>(sql, params);
      await admin.query("COMMIT");
      return r.rows[0].id;
    } catch (err) {
      await admin.query("ROLLBACK");
      throw err;
    }
  }

  async function makeTenant(label: string): Promise<Tenant> {
    const acc = await admin.query<{ id: string }>(
      `INSERT INTO accounts (name) VALUES ($1) RETURNING id`,
      [`iso-${label}-${tag}`]
    );
    const accountId = acc.rows[0].id;

    // Both tenants have a technician with the same full name.
    const user = await admin.query<{ id: string }>(
      `INSERT INTO users (account_id, email, password_hash, full_name, role)
       VALUES ($1, $2, 'hash', 'Sam Tech', 'owner') RETURNING id`,
      [accountId, `${label}-${tag}-${accountId}@iso.test`]
    );
    const userId = user.rows[0].id;

    const clientName = `Client ${label} ${tag}`;
    const cl = await admin.query<{ id: string }>(
      `INSERT INTO clients (account_id, name, email)
       VALUES ($1, $2, $3) RETURNING id`,
      [accountId, clientName, `client-${label}-${tag}@iso.test`]
    );

    const propertyAddress = `${label} Street ${tag}`;
    const prop = await admin.query<{ id: string }>(
      `INSERT INTO properties (account_id, address) VALUES ($1, $2) RETURNING id`,
      [accountId, propertyAddress]
    );

    const job = await admin.query<{ id: string }>(
      `INSERT INTO jobs (account_id, client_id, property_id, title, status, created_by, updated_at)
       VALUES ($1, $2, $3, $4, 'completed', $5, now() - interval '36 hours')
       RETURNING id`,
      [accountId, cl.rows[0].id, prop.rows[0].id, `${label} job ${tag}`, userId]
    );

    return {
      accountId,
      userId,
      clientId: cl.rows[0].id,
      clientName,
      propertyId: prop.rows[0].id,
      propertyAddress,
      jobId: job.rows[0].id,
    };
  }

  function automationFor(t: Tenant, type: string, config: Record<string, unknown> = {}): AutomationRow {
    return {
      id: randomUUID(),
      account_id: t.accountId,
      type,
      config,
      enabled: true,
      next_run_at: new Date().toISOString(),
    };
  }

  beforeAll(async () => {
    await admin.connect();
    await worker.connect();
    a = await makeTenant("a");
    b = await makeTenant("b");
  });

  afterAll(async () => {
    if (!admin) return;
    const ids = [a?.accountId, b?.accountId].filter(Boolean);
    if (ids.length) {
      await admin.query(`DELETE FROM notification_queue WHERE account_id = ANY($1)`, [ids]);
      await admin.query(`DELETE FROM accounts WHERE id = ANY($1)`, [ids]);
    }
    await worker.end();
    await admin.end();
  });

  // ---------------------------------------------------------------------------
  // Finding 1: review-request technician name must come from the same account.
  // ---------------------------------------------------------------------------
  describe("review-request technician join", () => {
    it("returns one row for a job and the same-account technician name", async () => {
      await admin.query(
        `INSERT INTO visits (account_id, job_id, assigned_user_id, status, scheduled_start,
                             scheduled_end, completed_at, visit_type)
         VALUES ($1, $2, $3, 'completed', now() - interval '31 hours',
                 now() - interval '30 hours', now() - interval '30 hours', 'site_visit')`,
        [a.accountId, a.jobId, a.userId]
      );

      const rows = await findEligibleJobs(worker, automationFor(a, "review_request", { days_after: 1 }));
      const forJob = rows.filter((r) => r.id === a.jobId);

      // Before the fix, the name-based join matched both "Sam Tech" users and returned two rows.
      expect(forJob).toHaveLength(1);
      expect(forJob[0].tech_name).toBe("Sam Tech");
    });

    it("omits the technician name when the job has no same-account technician", async () => {
      const noVisitJob = await admin.query<{ id: string }>(
        `INSERT INTO jobs (account_id, client_id, property_id, title, status, created_by, updated_at)
         VALUES ($1, $2, $3, $4, 'completed', $5, now() - interval '36 hours') RETURNING id`,
        [a.accountId, a.clientId, a.propertyId, `no-visit job ${tag}`, a.userId]
      );

      const rows = await findEligibleJobs(worker, automationFor(a, "review_request", { days_after: 1 }));
      const row = rows.find((r) => r.id === noVisitJob.rows[0].id);

      expect(row).toBeDefined();
      expect(row?.tech_name ?? null).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 3: id-only joins must not pull client or property content from another account.
  // ---------------------------------------------------------------------------
  describe("booking-confirmed joins", () => {
    it("does not supply a client from another account", async () => {
      const crossJob = await admin.query<{ id: string }>(
        `INSERT INTO jobs (account_id, client_id, title, status, created_by)
         VALUES ($1, $2, $3, 'scheduled', $4) RETURNING id`,
        [a.accountId, b.clientId, `cross-client job ${tag}`, a.userId]
      );
      const visit = await admin.query<{ id: string }>(
        `INSERT INTO visits (account_id, job_id, assigned_user_id, status, scheduled_start, scheduled_end, visit_type)
         VALUES ($1, $2, $3, 'scheduled', now() + interval '12 hours', now() + interval '13 hours', 'site_visit')
         RETURNING id`,
        [a.accountId, crossJob.rows[0].id, a.userId]
      );

      const rows = await findEligibleBookings(worker, automationFor(a, "booking_confirmed"));
      const row = rows.find((r) => r.id === visit.rows[0].id);

      expect(row?.client_name ?? null).not.toBe(b.clientName);
      expect(row ?? null).toBeNull();
    });

    it("does not supply a property address from another account", async () => {
      const crossJob = await admin.query<{ id: string }>(
        `INSERT INTO jobs (account_id, client_id, property_id, title, status, created_by)
         VALUES ($1, $2, $3, $4, 'scheduled', $5) RETURNING id`,
        [a.accountId, a.clientId, b.propertyId, `cross-property job ${tag}`, a.userId]
      );
      const visit = await admin.query<{ id: string }>(
        `INSERT INTO visits (account_id, job_id, assigned_user_id, status, scheduled_start, scheduled_end, visit_type)
         VALUES ($1, $2, $3, 'scheduled', now() + interval '12 hours', now() + interval '13 hours', 'site_visit')
         RETURNING id`,
        [a.accountId, crossJob.rows[0].id, a.userId]
      );

      const rows = await findEligibleBookings(worker, automationFor(a, "booking_confirmed"));
      const row = rows.find((r) => r.id === visit.rows[0].id);

      expect(row?.property_address ?? null).not.toBe(b.propertyAddress);
    });
  });

  describe("visit-reminder joins", () => {
    it("does not supply a client from another account", async () => {
      const crossJob = await admin.query<{ id: string }>(
        `INSERT INTO jobs (account_id, client_id, title, status, created_by)
         VALUES ($1, $2, $3, 'scheduled', $4) RETURNING id`,
        [a.accountId, b.clientId, `reminder cross-client ${tag}`, a.userId]
      );
      const visit = await admin.query<{ id: string }>(
        `INSERT INTO visits (account_id, job_id, assigned_user_id, status, scheduled_start, scheduled_end, visit_type)
         VALUES ($1, $2, $3, 'scheduled', now() + interval '12 hours', now() + interval '13 hours', 'site_visit')
         RETURNING id`,
        [a.accountId, crossJob.rows[0].id, a.userId]
      );

      const rows = await findEligibleVisits(worker, automationFor(a, "visit_reminder", { hours_before: 24 }));
      const row = rows.find((r) => r.id === visit.rows[0].id);

      expect(row ?? null).toBeNull();
    });

    it("does not supply a property address from another account", async () => {
      const crossJob = await admin.query<{ id: string }>(
        `INSERT INTO jobs (account_id, client_id, property_id, title, status, created_by)
         VALUES ($1, $2, $3, $4, 'scheduled', $5) RETURNING id`,
        [a.accountId, a.clientId, b.propertyId, `reminder cross-property ${tag}`, a.userId]
      );
      const visit = await admin.query<{ id: string }>(
        `INSERT INTO visits (account_id, job_id, assigned_user_id, status, scheduled_start, scheduled_end, visit_type)
         VALUES ($1, $2, $3, 'scheduled', now() + interval '12 hours', now() + interval '13 hours', 'site_visit')
         RETURNING id`,
        [a.accountId, crossJob.rows[0].id, a.userId]
      );

      const rows = await findEligibleVisits(worker, automationFor(a, "visit_reminder", { hours_before: 24 }));
      const row = rows.find((r) => r.id === visit.rows[0].id);

      expect(row?.property_address ?? null).not.toBe(b.propertyAddress);
    });
  });

  describe("invoice-followup joins", () => {
    it("does not supply a client from another account", async () => {
      const invId = await insertInvoiceFixture(
        `INSERT INTO invoices (account_id, client_id, invoice_number, status, due_date, total_cents, created_by)
         VALUES ($1, $2, $3, 'overdue', (now() - interval '10 days')::date, 1000, $4) RETURNING id`,
        [a.accountId, b.clientId, `CROSS-C-${tag}`, a.userId]
      );

      const rows = await findOverdueInvoices(worker, automationFor(a, "invoice_followup"));
      expect(rows.find((r) => r.id === invId) ?? null).toBeNull();
    });

    it("does not let another account's job status gate an invoice", async () => {
      // B's job is completed, so it would pass the job-status check if the join ignored account.
      const invId = await insertInvoiceFixture(
        `INSERT INTO invoices (account_id, client_id, job_id, invoice_number, status, due_date, total_cents, created_by)
         VALUES ($1, $2, $3, $4, 'overdue', (now() - interval '10 days')::date, 1000, $5) RETURNING id`,
        [a.accountId, a.clientId, b.jobId, `CROSS-J-${tag}`, a.userId]
      );

      const rows = await findOverdueInvoices(worker, automationFor(a, "invoice_followup"));
      expect(rows.find((r) => r.id === invId) ?? null).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 2: idempotency keys and cancellation are scoped to the account.
  // ---------------------------------------------------------------------------
  describe("notification queue", () => {
    async function insertQueueRow(
      accountId: string,
      key: string,
      status: string,
      subject: string,
      entityId: string | null = null,
      cancelOn: string[] = []
    ): Promise<string> {
      const r = await admin.query<{ id: string }>(
        `INSERT INTO notification_queue
           (account_id, automation_type, to_address, subject, html_body, idempotency_key,
            status, entity_type, entity_id, cancel_on_events)
         VALUES ($1, 'review_request', 'x@iso.test', $2, '<p>x</p>', $3, $4,
                 CASE WHEN $5::uuid IS NULL THEN NULL ELSE 'job' END, $5::uuid, $6)
         RETURNING id`,
        [accountId, subject, key, status, entityId, cancelOn]
      );
      return r.rows[0].id;
    }

    function enqueueFor(accountId: string, key: string) {
      return enqueueNotification(worker, {
        accountId,
        clientId: null,
        automationType: "review_request",
        priority: PRIORITY.LOW,
        toAddress: "a@iso.test",
        subject: "A mail",
        htmlBody: "<p>a</p>",
        idempotencyKey: key,
      });
    }

    it("treats a same-account pending key as a duplicate", async () => {
      const key = `dup-same-${tag}`;
      await insertQueueRow(a.accountId, key, "pending", "A existing");

      await expect(enqueueFor(a.accountId, key)).resolves.toBe("duplicate");
    });

    it("does not report another account's pending key as a duplicate", async () => {
      const key = `dup-cross-${tag}`;
      await insertQueueRow(b.accountId, key, "pending", "B existing");

      let outcome: string;
      try {
        outcome = await enqueueFor(a.accountId, key);
      } catch (err) {
        // The old global UNIQUE (idempotency_key) still exists, so the insert fails closed.
        outcome = (err as { code?: string }).code ?? "error";
      }

      expect(outcome).not.toBe("duplicate");
      const rows = await admin.query<{ account_id: string; subject: string; status: string }>(
        `SELECT account_id, subject, status FROM notification_queue WHERE idempotency_key = $1`,
        [key]
      );
      const bRow = rows.rows.find((r) => r.account_id === b.accountId);
      expect(bRow?.subject).toBe("B existing");
      expect(bRow?.status).toBe("pending");
    });

    it("does not reset another account's failed row on key conflict", async () => {
      const key = `reset-cross-${tag}`;
      await insertQueueRow(b.accountId, key, "failed", "B failed");

      try {
        await enqueueFor(a.accountId, key);
      } catch {
        // Fail closed: the insert is rejected rather than overwriting B's row.
      }

      const rows = await admin.query<{ account_id: string; status: string }>(
        `SELECT account_id, status FROM notification_queue WHERE idempotency_key = $1`,
        [key]
      );
      const bRow = rows.rows.find((r) => r.account_id === b.accountId);
      expect(bRow?.status).toBe("failed");
    });

    it("resets a same-account failed row on enqueue (happy path)", async () => {
      const key = `reset-same-${tag}`;
      const id = await insertQueueRow(a.accountId, key, "failed", "A failed");

      await expect(enqueueFor(a.accountId, key)).resolves.toBe("enqueued");
      const row = await admin.query<{ status: string }>(
        `SELECT status FROM notification_queue WHERE id = $1`,
        [id]
      );
      expect(row.rows[0].status).toBe("pending");
    });

    it("does not cancel another account's pending rows for the same entity", async () => {
      const entityId = randomUUID();
      const bId = await insertQueueRow(b.accountId, `cancel-cross-${tag}`, "pending", "B pending", entityId, ["invoice.paid"]);

      const cancelled = await cancelNotificationsForEntity(worker, "job", entityId, "invoice.paid", a.accountId);

      expect(cancelled).toBe(0);
      const row = await admin.query<{ status: string }>(
        `SELECT status FROM notification_queue WHERE id = $1`,
        [bId]
      );
      expect(row.rows[0].status).toBe("pending");
    });

    it("cancels the same account's pending rows for the entity (happy path)", async () => {
      const entityId = randomUUID();
      const aId = await insertQueueRow(a.accountId, `cancel-same-${tag}`, "pending", "A pending", entityId, ["invoice.paid"]);

      const cancelled = await cancelNotificationsForEntity(worker, "job", entityId, "invoice.paid", a.accountId);

      expect(cancelled).toBe(1);
      const row = await admin.query<{ status: string }>(
        `SELECT status FROM notification_queue WHERE id = $1`,
        [aId]
      );
      expect(row.rows[0].status).toBe("cancelled");
    });
  });
});
