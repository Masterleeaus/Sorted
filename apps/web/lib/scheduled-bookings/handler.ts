import type { PoolClient } from "pg";
import { applyScheduledBookingEvent, CustomerUnmappedError, type BookingEventOutcome } from "./apply";
import {
  assertEnvelopeShape,
  EnvelopeError,
  parseEnvelopeBody,
  SCHEDULED_BOOKING_EVENT_TYPES,
  SCHEDULED_BOOKING_SCHEMA_VERSION,
  SCHEDULED_SOURCE_PRODUCT,
  verifyEnvelopeSignature,
  type ScheduledBookingEventType,
} from "./envelope";
import type { ScheduledBookingConfig } from "./config";
import { parseBookingPayload } from "./payload";

/**
 * Request handling for Scheduled booking events. Order is fixed:
 *   1. parse the bounded body (shape only)
 *   2. verify the HMAC signature (before anything else is trusted)
 *   3. shape-check the envelope, source product, event type and schema version
 *   4. tenant binding: envelope organisationId and payload companyId must equal the route's bound tenant
 *   5. validate the payload
 *   6. run the effect in the tenant transaction (receipt first, which is the idempotency gate)
 */

export type EnabledScheduledBookingConfig = Extract<ScheduledBookingConfig, { enabled: true }>;

export type TenantRunner = <T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
) => Promise<T>;

export type HandlerResult = {
  status: number;
  body: { data: { outcome: BookingEventOutcome } } | { error: { code: string; message: string } };
};

function fail(code: string, status: number, message: string): HandlerResult {
  return { status, body: { error: { code, message } } };
}

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function handleScheduledBookingEvent(input: {
  rawBody: string;
  config: EnabledScheduledBookingConfig;
  runInTenant: TenantRunner;
}): Promise<HandlerResult> {
  const { rawBody, config, runInTenant } = input;

  let raw: Record<string, unknown>;
  try {
    raw = parseEnvelopeBody(rawBody);
  } catch (err) {
    if (err instanceof EnvelopeError) return fail(err.code, err.status, err.message);
    throw err;
  }

  // Signature first. No field is read for a decision before this passes.
  if (!verifyEnvelopeSignature(raw, config.secret)) {
    return fail("bad_signature", 401, "envelope signature does not verify");
  }

  let envelope;
  try {
    envelope = assertEnvelopeShape(raw);
  } catch (err) {
    if (err instanceof EnvelopeError) return fail(err.code, err.status, err.message);
    throw err;
  }

  if (envelope.sourceProduct !== SCHEDULED_SOURCE_PRODUCT) {
    return fail("source_not_allowed", 403, "envelope source is not Scheduled");
  }
  if (!sameId(envelope.organisationId, config.organisationId)) {
    return fail("tenant_mismatch", 403, "event belongs to another tenant");
  }
  if (!(SCHEDULED_BOOKING_EVENT_TYPES as readonly string[]).includes(envelope.eventType)) {
    return fail("unknown_event_type", 422, "event type is not a booking event");
  }
  if (envelope.schemaVersion !== SCHEDULED_BOOKING_SCHEMA_VERSION) {
    return fail("unsupported_schema_version", 422, "schema version is not supported");
  }
  const eventType = envelope.eventType as ScheduledBookingEventType;

  let payload;
  try {
    payload = parseBookingPayload(envelope.payload);
  } catch (err) {
    if (err instanceof EnvelopeError) return fail(err.code, err.status, err.message);
    throw err;
  }
  if (!sameId(payload.companyId, config.organisationId)) {
    return fail("tenant_mismatch", 403, "payload company does not match the bound tenant");
  }

  try {
    const result = await runInTenant(config.organisationId, (client) =>
      applyScheduledBookingEvent(client, {
        tenantId: config.organisationId,
        actorUserId: config.actorUserId,
        eventType,
        envelope,
        payload,
      }),
    );
    return { status: 200, body: { data: { outcome: result.outcome } } };
  } catch (err) {
    // The tenant transaction rolled back, including the receipt, so Central's retry can run it again.
    if (err instanceof CustomerUnmappedError) {
      return fail("customer_unmapped", 409, "customer reference has no mapping yet; retry after mapping");
    }
    throw err;
  }
}
