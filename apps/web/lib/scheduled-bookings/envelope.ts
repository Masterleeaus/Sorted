import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Central outbox envelope verification for Scheduled booking events.
 *
 * Contract: central/docs/EVENTS.md. The envelope carries a hex HMAC-SHA256
 * `signature` over the canonical JSON (object keys sorted at every depth, no
 * whitespace) of every other field, keyed by the route secret. This module only
 * authenticates the envelope. Tenant binding and payload checks happen after it.
 */

export const SCHEDULED_SOURCE_PRODUCT = "scheduled";
export const SCHEDULED_BOOKING_EVENT_TYPES = [
  "booking.created",
  "booking.cancelled",
  "booking.rescheduled",
] as const;
export type ScheduledBookingEventType = (typeof SCHEDULED_BOOKING_EVENT_TYPES)[number];
export const SCHEDULED_BOOKING_SCHEMA_VERSION = 1;

export const MIN_ROUTE_SECRET_LENGTH = 32;
/** Matches the sender's 16 KiB request body cap (EVENTS.md, Transport). */
export const MAX_ENVELOPE_BYTES = 16 * 1024;

const SIGNATURE_RE = /^[0-9a-f]{64}$/;
const MAX_DEPTH = 16;

export class EnvelopeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "EnvelopeError";
    this.code = code;
    this.status = status;
  }
}

export type ScheduledEnvelope = {
  eventId: string;
  organisationId: string;
  sourceProduct: string;
  eventType: string;
  schemaVersion: number;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  signature: string;
};

/** Canonical JSON as Central writes it: keys sorted at every depth, no whitespace. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new EnvelopeError("invalid_envelope", 422, "envelope nesting too deep");
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new EnvelopeError("invalid_envelope", 422, "envelope numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) throw new EnvelopeError("invalid_envelope", 422, "envelope values must be JSON");
      parts.push(`${JSON.stringify(key)}:${canonicalJson(item, depth + 1)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new EnvelopeError("invalid_envelope", 422, "envelope values must be JSON");
}

/**
 * Constant-time check of the envelope signature against one route secret.
 * Returns false for any malformed signature; never throws on attacker input.
 */
export function verifyEnvelopeSignature(raw: Record<string, unknown>, secret: string): boolean {
  const { signature, ...unsigned } = raw;
  if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) return false;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", secret).update(canonicalJson(unsigned), "utf8").digest();
  } catch {
    return false;
  }
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Sign an envelope the same way Central does. Used by tests and fixtures only. */
export function signEnvelope(unsigned: Record<string, unknown>, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(unsigned), "utf8").digest("hex");
}

/** Parses the raw body with a size cap. No field is trusted here; only shape is checked. */
export function parseEnvelopeBody(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, "utf8") > MAX_ENVELOPE_BYTES) {
    throw new EnvelopeError("payload_too_large", 413, "envelope exceeds the size limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EnvelopeError("invalid_envelope", 400, "body is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EnvelopeError("invalid_envelope", 400, "envelope must be an object");
  }
  return value as Record<string, unknown>;
}

/**
 * Shape check after the signature has verified. The signature covers every
 * field, so a field that fails here was signed by Central but is still refused.
 */
export function assertEnvelopeShape(raw: Record<string, unknown>): ScheduledEnvelope {
  const stringFields = [
    "eventId",
    "organisationId",
    "sourceProduct",
    "eventType",
    "correlationId",
    "idempotencyKey",
    "occurredAt",
  ] as const;
  for (const field of stringFields) {
    const value = raw[field];
    if (typeof value !== "string" || value.length === 0 || value.length > 200) {
      throw new EnvelopeError("invalid_envelope", 422, `envelope.${field} is invalid`);
    }
  }
  if (!Number.isSafeInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 1) {
    throw new EnvelopeError("invalid_envelope", 422, "envelope.schemaVersion is invalid");
  }
  if (!raw.payload || typeof raw.payload !== "object" || Array.isArray(raw.payload)) {
    throw new EnvelopeError("invalid_envelope", 422, "envelope.payload must be an object");
  }
  return raw as unknown as ScheduledEnvelope;
}
