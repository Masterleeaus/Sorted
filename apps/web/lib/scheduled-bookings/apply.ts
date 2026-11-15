import type { PoolClient } from "pg";
import { createDefaultWorkOrderForJob } from "../work-orders/create-default";
import type { ScheduledBookingEventType, ScheduledEnvelope } from "./envelope";
import type { ScheduledBookingPayload } from "./payload";

/**
 * Applies one verified, tenant-bound, validated Scheduled booking event inside
 * the caller's tenant transaction (withTokenAccountContext). The receipt insert
 * is first, so a duplicate key stops here with no further write. The whole
 * effect rolls back together with the receipt if anything throws, so a retry
 * can run it again.
 */

export class CustomerUnmappedError extends Error {
  constructor() {
    super("customer reference has no Sorted client mapping");
    this.name = "CustomerUnmappedError";
  }
}

export type BookingEventOutcome =
  | "created"
  | "updated"
  | "rescheduled"
  | "cancelled"
  | "job_not_cancellable"
  | "no_linked_job"
  | "stale"
  | "duplicate";

export type ApplyInput = {
  tenantId: string;
  actorUserId: string;
  eventType: ScheduledBookingEventType;
  envelope: ScheduledEnvelope;
  payload: ScheduledBookingPayload;
};

const CANCELLABLE_JOB_STATUSES = ["draft", "quoted", "scheduled"];

export async function applyScheduledBookingEvent(
  client: PoolClient,
  input: ApplyInput,
): Promise<{ outcome: BookingEventOutcome; jobId: string | null }> {
  const { tenantId, actorUserId, eventType, envelope, payload } = input;

  const receipt = await client.query(
    `INSERT INTO scheduled_booking_receipts (company_id, idempotency_key, event_type, booking_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [tenantId, envelope.idempotencyKey, eventType, payload.bookingId],
  );
  if ((receipt.rowCount ?? receipt.rows.length) === 0) {
    return { outcome: "duplicate", jobId: null };
  }

  const linkResult = await client.query<{
    job_id: string;
    last_occurred_at: Date;
  }>(
    `SELECT job_id, last_occurred_at FROM scheduled_booking_links
     WHERE company_id = $1 AND booking_id = $2
     FOR UPDATE`,
    [tenantId, payload.bookingId],
  );
  const link = linkResult.rows[0] ?? null;

  // Per-booking order guard across different keys: an older snapshot never overwrites a newer one.
  if (link && link.last_occurred_at && link.last_occurred_at.getTime() > Date.parse(payload.occurredAt)) {
    return { outcome: "stale", jobId: link.job_id };
  }

  if (eventType === "booking.created") {
    if (link) {
      await upsertLink(client, tenantId, payload, link.job_id, "scheduled");
      return { outcome: "updated", jobId: link.job_id };
    }
    const clientId = await resolveClient(client, tenantId, payload.customerRef);
    const jobId = await insertJob(client, tenantId, actorUserId, clientId, payload);
    await createDefaultWorkOrderForJob({
      client,
      accountId: tenantId,
      clientId,
      jobId,
      title: `Scheduled: ${payload.serviceId}`,
      scope: null,
      createdBy: actorUserId,
    });
    await upsertLink(client, tenantId, payload, jobId, "scheduled");
    return { outcome: "created", jobId };
  }

  if (!link) return { outcome: "no_linked_job", jobId: null };

  if (eventType === "booking.rescheduled") {
    await upsertLink(client, tenantId, payload, link.job_id, "rescheduled");
    return { outcome: "rescheduled", jobId: link.job_id };
  }

  // booking.cancelled
  await upsertLink(client, tenantId, payload, link.job_id, "cancelled");
  const cancelled = await client.query(
    `UPDATE jobs SET status = 'cancelled', updated_at = now()
     WHERE account_id = $1 AND id = $2 AND status = ANY($3::text[])`,
    [tenantId, link.job_id, CANCELLABLE_JOB_STATUSES],
  );
  return {
    outcome: (cancelled.rowCount ?? 0) > 0 ? "cancelled" : "job_not_cancellable",
    jobId: link.job_id,
  };
}

async function resolveClient(client: PoolClient, tenantId: string, customerRef: string): Promise<string> {
  const { rows } = await client.query<{ client_id: string }>(
    `SELECT client_id FROM scheduled_customer_links
     WHERE company_id = $1 AND customer_ref = $2`,
    [tenantId, customerRef],
  );
  if (!rows[0]) throw new CustomerUnmappedError();
  return rows[0].client_id;
}

async function insertJob(
  client: PoolClient,
  tenantId: string,
  actorUserId: string,
  clientId: string,
  payload: ScheduledBookingPayload,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO jobs (account_id, client_id, title, description, job_type, status, created_by)
     VALUES ($1, $2, $3, NULL, 'custom', 'draft', $4)
     RETURNING id`,
    [tenantId, clientId, `Scheduled: ${payload.serviceId}`, actorUserId],
  );
  return rows[0].id;
}

async function upsertLink(
  client: PoolClient,
  tenantId: string,
  payload: ScheduledBookingPayload,
  jobId: string,
  status: string,
): Promise<void> {
  await client.query(
    `INSERT INTO scheduled_booking_links
       (company_id, booking_id, job_id, status, service_id, staff_ids, start_at, end_at, timezone, last_occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
     ON CONFLICT (company_id, booking_id) DO UPDATE SET
       status = EXCLUDED.status,
       service_id = EXCLUDED.service_id,
       staff_ids = EXCLUDED.staff_ids,
       start_at = EXCLUDED.start_at,
       end_at = EXCLUDED.end_at,
       timezone = EXCLUDED.timezone,
       last_occurred_at = EXCLUDED.last_occurred_at,
       updated_at = now()`,
    [
      tenantId,
      payload.bookingId,
      jobId,
      status,
      payload.serviceId,
      JSON.stringify(payload.staffIds),
      payload.startAt,
      payload.endAt,
      payload.timezone,
      payload.occurredAt,
    ],
  );
}
