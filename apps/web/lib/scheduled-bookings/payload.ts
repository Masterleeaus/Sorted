import { z } from "zod";
import { EnvelopeError } from "./envelope";

/**
 * Booking payload from Scheduled. Every field is untrusted until it passes here.
 * Unknown fields are ignored (EVENTS.md, versioning rules). The payload is a
 * full booking snapshot, so every event carries the schedule fields.
 */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_RE = /^[a-z][a-z_]{0,31}$/;
// Opaque customer reference: no spaces, no '@', so it cannot carry an email or a name.
const CUSTOMER_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/;
const MAX_BOOKING_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STAFF = 20;

const isoInstant = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v), "must be an ISO 8601 instant");

const schema = z
  .object({
    bookingId: z.string().regex(ID_RE),
    companyId: z.string().regex(UUID_RE),
    occurredAt: isoInstant,
    serviceId: z.string().regex(ID_RE),
    staffIds: z.array(z.string().regex(ID_RE)).max(MAX_STAFF),
    startAt: isoInstant,
    endAt: isoInstant,
    timezone: z.string().min(1).max(64),
    status: z.string().regex(STATUS_RE),
    customerRef: z.string().regex(CUSTOMER_REF_RE),
  })
  .passthrough();

export type ScheduledBookingPayload = {
  bookingId: string;
  companyId: string;
  occurredAt: string;
  serviceId: string;
  staffIds: string[];
  startAt: string;
  endAt: string;
  timezone: string;
  status: string;
  customerRef: string;
};

function isIanaTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Validates the payload. Throws EnvelopeError (422) naming the field, never its value. */
export function parseBookingPayload(raw: Record<string, unknown>): ScheduledBookingPayload {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const field = result.error.issues[0]?.path.join(".") || "payload";
    throw new EnvelopeError("invalid_payload", 422, `payload.${field} is invalid`);
  }
  const data = result.data;
  if (!isIanaTimezone(data.timezone)) {
    throw new EnvelopeError("invalid_payload", 422, "payload.timezone is invalid");
  }
  const start = Date.parse(data.startAt);
  const end = Date.parse(data.endAt);
  if (end <= start || end - start > MAX_BOOKING_MS) {
    throw new EnvelopeError("invalid_payload", 422, "payload.endAt must be after startAt and within 7 days");
  }
  return {
    bookingId: data.bookingId,
    companyId: data.companyId,
    occurredAt: data.occurredAt,
    serviceId: data.serviceId,
    staffIds: data.staffIds,
    startAt: data.startAt,
    endAt: data.endAt,
    timezone: data.timezone,
    status: data.status,
    customerRef: data.customerRef,
  };
}
