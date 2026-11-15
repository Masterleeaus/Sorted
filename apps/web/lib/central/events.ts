/**
 * Consumer side of Central's signed outbox events (Central docs/EVENTS.md).
 *
 * Order of checks, each before anything else runs:
 *   1. size and shape of the envelope
 *   2. HMAC-SHA256 over the canonical JSON of every other field, against a key
 *      valid now (rotation keys; a key outside its window never verifies)
 *   3. tenant binding: organisationId must equal this route's tenant
 *   4. the event type must be routed to this consumer
 *   5. freshness: occurredAt not too old and not in the future
 * Only then is the event claimed by eventId and the handler run. A handler
 * failure releases the claim so a redelivery can retry.
 *
 * Delivery is at least once. Dedupe is by eventId through an injected store;
 * production needs a durable, transactional store (not in this change).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_ENVELOPE_BYTES = 16 * 1024;
const MAX_PAYLOAD_BYTES = 4096;
const MAX_CLOCK_SKEW_MS = 60_000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_DEPTH = 16;

export class InboundEventError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InboundEventError";
    this.code = code;
  }
}

interface OutboxEnvelope {
  readonly eventId: string;
  readonly organisationId: string;
  readonly sourceProduct: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
  readonly signature: string;
}

export interface RouteSecretKey {
  readonly id: string;
  readonly secret: string;
  readonly notBefore: string;
  readonly notAfter?: string;
}

export interface ConsumerRoute {
  readonly consumer: string;
  readonly organisationId: string;
  readonly eventTypes: readonly string[];
  readonly keys: readonly RouteSecretKey[];
  readonly maxAgeMs?: number;
}

export interface ProcessedEventStore {
  /** Returns true when the key was newly claimed, false when it was already processed. */
  claim(consumer: string, eventId: string): Promise<boolean>;
  /** Drops a claim after a failed handler so a redelivery can run it again. */
  release(consumer: string, eventId: string): Promise<void>;
}

/** Canonical JSON: object keys sorted recursively, no whitespace. Same rule as Central's canonicalJson. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value, 0));
}

function sortKeys(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new InboundEventError("invalid_payload", "payload nesting too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InboundEventError("invalid_payload", "payload numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sortKeys(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  throw new InboundEventError("invalid_payload", "unsupported value in payload");
}

/** Hex HMAC-SHA256 over the canonical JSON of the unsigned fields. */
export function signUnsignedFields(unsigned: Record<string, unknown>, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(unsigned), "utf8").digest("hex");
}

const SIGNATURE_RE = /^[0-9a-f]{64}$/;
const STRING_FIELDS = ["eventId", "organisationId", "sourceProduct", "eventType", "correlationId", "idempotencyKey", "occurredAt", "signature"] as const;

function parseKeyTime(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new InboundEventError("bad_route", "route key time is not an ISO instant");
  return ms;
}

function validKeys(keys: readonly RouteSecretKey[], nowMs: number): string[] {
  return keys
    .filter((key) => {
      const from = parseKeyTime(key.notBefore);
      const until = key.notAfter === undefined ? Number.POSITIVE_INFINITY : parseKeyTime(key.notAfter);
      return from <= nowMs && nowMs < until;
    })
    .map((key) => key.secret);
}

function verifySignature(unsigned: Record<string, unknown>, signature: string, secrets: readonly string[]): boolean {
  if (!SIGNATURE_RE.test(signature)) return false;
  const given = Buffer.from(signature, "hex");
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(signUnsignedFields(unsigned, secret), "hex");
    if (expected.length === given.length && timingSafeEqual(expected, given)) matched = true;
  }
  return matched;
}

/**
 * Verifies a raw inbound envelope for one route. Returns the typed envelope or
 * throws InboundEventError with a fixed code. Nothing from the body is logged here.
 */
export function verifyInboundEnvelope(raw: unknown, route: ConsumerRoute, nowMs: number): OutboxEnvelope {
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    throw new InboundEventError("invalid_envelope", "envelope is not JSON");
  }
  if (serialized === undefined) throw new InboundEventError("invalid_envelope", "envelope is missing");
  if (Buffer.byteLength(serialized, "utf8") > MAX_ENVELOPE_BYTES) {
    throw new InboundEventError("envelope_too_large", "envelope exceeds the size limit");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InboundEventError("invalid_envelope", "envelope must be an object");
  }
  const envelope = raw as Record<string, unknown>;
  for (const field of STRING_FIELDS) {
    if (typeof envelope[field] !== "string" || (envelope[field] as string).length === 0) {
      throw new InboundEventError("invalid_envelope", `envelope.${field} is required`);
    }
  }
  if (!Number.isInteger(envelope.schemaVersion) || (envelope.schemaVersion as number) < 1) {
    throw new InboundEventError("invalid_envelope", "envelope.schemaVersion must be an integer >= 1");
  }
  if (typeof envelope.payload !== "object" || envelope.payload === null || Array.isArray(envelope.payload)) {
    throw new InboundEventError("invalid_envelope", "envelope.payload must be an object");
  }
  if (Buffer.byteLength(canonicalJson(envelope.payload), "utf8") > MAX_PAYLOAD_BYTES) {
    throw new InboundEventError("payload_too_large", "payload exceeds the size limit");
  }

  // 2. signature, before any field is trusted.
  const { signature, ...unsigned } = envelope;
  const secrets = validKeys(route.keys, nowMs);
  if (secrets.length === 0 || !verifySignature(unsigned, signature as string, secrets)) {
    throw new InboundEventError("bad_signature", "envelope signature does not verify with a key valid now");
  }

  // 3. tenant binding.
  if (envelope.organisationId !== route.organisationId) {
    throw new InboundEventError("tenant_mismatch", "envelope is not for this consumer's tenant");
  }

  // 4. routing.
  if (!route.eventTypes.includes(envelope.eventType as string)) {
    throw new InboundEventError("event_type_not_routed", "event type is not routed to this consumer");
  }

  // 5. freshness.
  const occurredMs = Date.parse(envelope.occurredAt as string);
  if (!Number.isFinite(occurredMs)) throw new InboundEventError("invalid_envelope", "envelope.occurredAt is not a time");
  if (occurredMs > nowMs + MAX_CLOCK_SKEW_MS) throw new InboundEventError("future_dated", "event is dated in the future");
  if (nowMs - occurredMs > (route.maxAgeMs ?? DEFAULT_MAX_AGE_MS)) throw new InboundEventError("stale_event", "event is too old to accept");

  return envelope as unknown as OutboxEnvelope;
}

type InboundOutcome = "processed" | "duplicate";

/**
 * Verifies, claims by eventId, runs the handler once. A duplicate eventId
 * returns "duplicate" and runs nothing. A failing handler releases the claim.
 */
export async function handleInboundEvent(args: {
  raw: unknown;
  route: ConsumerRoute;
  now: number;
  store: ProcessedEventStore;
  handler: (envelope: OutboxEnvelope) => Promise<void>;
}): Promise<InboundOutcome> {
  const envelope = verifyInboundEnvelope(args.raw, args.route, args.now);
  const claimed = await args.store.claim(args.route.consumer, envelope.eventId);
  if (!claimed) return "duplicate";
  try {
    await args.handler(envelope);
  } catch (error) {
    await args.store.release(args.route.consumer, envelope.eventId);
    throw error;
  }
  return "processed";
}
