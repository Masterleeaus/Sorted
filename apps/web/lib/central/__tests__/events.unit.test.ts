import { describe, it, expect } from "vitest";
import {
  InboundEventError,
  canonicalJson,
  handleInboundEvent,
  signUnsignedFields,
  verifyInboundEnvelope,
  type ConsumerRoute,
  type ProcessedEventStore,
} from "../events";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const ORG = "org_test_0001";
const OLD_SECRET = "old-route-secret-0123456789abcdef";
const NEW_SECRET = "new-route-secret-0123456789abcdef";

const ROUTE: ConsumerRoute = {
  consumer: "sorted-inbox",
  organisationId: ORG,
  eventTypes: ["example.v1"],
  keys: [{ id: "current", secret: NEW_SECRET, notBefore: "2026-11-10T00:00:00.000Z" }],
};

function envelope(over: Partial<Record<string, unknown>> = {}, secret = NEW_SECRET): Record<string, unknown> {
  const unsigned: Record<string, unknown> = {
    eventId: "11111111-1111-4111-8111-111111111111",
    organisationId: ORG,
    sourceProduct: "central",
    eventType: "example.v1",
    schemaVersion: 1,
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    occurredAt: new Date(NOW - 60_000).toISOString(),
    payload: { b: 2, a: { d: 4, c: 3 } },
    ...over,
  };
  return { ...unsigned, signature: signUnsignedFields(unsigned, secret) };
}

class MemoryStore implements ProcessedEventStore {
  readonly seen = new Set<string>();
  async claim(consumer: string, eventId: string): Promise<boolean> {
    const k = `${consumer}:${eventId}`;
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
  async release(consumer: string, eventId: string): Promise<void> {
    this.seen.delete(`${consumer}:${eventId}`);
  }
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    return e instanceof InboundEventError ? e.code : "unexpected";
  }
  return null;
}

describe("canonical JSON", () => {
  it("sorts keys recursively with no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });
});

describe("inbound envelope verification", () => {
  it("accepts a correctly signed, routed, fresh envelope", () => {
    const e = verifyInboundEnvelope(envelope(), ROUTE, NOW);
    expect(e.eventType).toBe("example.v1");
  });

  it("refuses a tampered payload before reading it", () => {
    const e = envelope() as Record<string, unknown>;
    (e.payload as Record<string, unknown>).a = { d: 4, c: 999 };
    expect(codeOf(() => verifyInboundEnvelope(e, ROUTE, NOW))).toBe("bad_signature");
  });

  it("refuses an unsigned envelope and a malformed signature", () => {
    const { signature: _omit, ...unsigned } = envelope() as Record<string, unknown> & { signature: string };
    expect(codeOf(() => verifyInboundEnvelope(unsigned, ROUTE, NOW))).toBe("invalid_envelope");
    expect(codeOf(() => verifyInboundEnvelope(envelope({ signature: "not-hex" }), ROUTE, NOW))).toBe("bad_signature");
  });

  it("refuses an envelope signed with the wrong secret", () => {
    expect(codeOf(() => verifyInboundEnvelope(envelope({}, "some-other-secret-0123456789abcdef"), ROUTE, NOW))).toBe("bad_signature");
  });

  it("refuses a correctly signed envelope for another tenant", () => {
    expect(codeOf(() => verifyInboundEnvelope(envelope({ organisationId: "org_other_0002" }), ROUTE, NOW))).toBe("tenant_mismatch");
  });

  it("refuses an event type not routed to this consumer", () => {
    expect(codeOf(() => verifyInboundEnvelope(envelope({ eventType: "other.v1" }), ROUTE, NOW))).toBe("event_type_not_routed");
  });

  it("refuses stale and future-dated events", () => {
    const stale = envelope({ occurredAt: new Date(NOW - 25 * 3600_000).toISOString() });
    const future = envelope({ occurredAt: new Date(NOW + 5 * 60_000).toISOString() });
    expect(codeOf(() => verifyInboundEnvelope(stale, ROUTE, NOW))).toBe("stale_event");
    expect(codeOf(() => verifyInboundEnvelope(future, ROUTE, NOW))).toBe("future_dated");
  });

  it("refuses an oversize payload and an oversize envelope", () => {
    const big = envelope({ payload: { blob: "x".repeat(4100) } });
    expect(codeOf(() => verifyInboundEnvelope(big, ROUTE, NOW))).toBe("payload_too_large");
    const huge = envelope({ payload: { blob: "x".repeat(4000) }, correlationId: "y".repeat(20_000) });
    expect(codeOf(() => verifyInboundEnvelope(huge, ROUTE, NOW))).toBe("envelope_too_large");
  });

  it("accepts an overlap during key rotation and refuses an expired or not-yet-valid key", () => {
    const rotating: ConsumerRoute = {
      ...ROUTE,
      keys: [
        { id: "old", secret: OLD_SECRET, notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2026-11-20T00:00:00.000Z" },
        { id: "new", secret: NEW_SECRET, notBefore: "2026-11-10T00:00:00.000Z" },
      ],
    };
    expect(codeOf(() => verifyInboundEnvelope(envelope({}, OLD_SECRET), rotating, NOW))).toBeNull();
    expect(codeOf(() => verifyInboundEnvelope(envelope({}, NEW_SECRET), rotating, NOW))).toBeNull();

    const expiredOnly: ConsumerRoute = { ...ROUTE, keys: [{ id: "old", secret: OLD_SECRET, notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2026-11-14T00:00:00.000Z" }] };
    expect(codeOf(() => verifyInboundEnvelope(envelope({}, OLD_SECRET), expiredOnly, NOW))).toBe("bad_signature");

    const notYet: ConsumerRoute = { ...ROUTE, keys: [{ id: "new", secret: NEW_SECRET, notBefore: "2026-12-01T00:00:00.000Z" }] };
    expect(codeOf(() => verifyInboundEnvelope(envelope(), notYet, NOW))).toBe("bad_signature");
  });
});

describe("handleInboundEvent", () => {
  it("runs the handler once per eventId and reports a duplicate", async () => {
    const store = new MemoryStore();
    const seen: string[] = [];
    const handler = async (e: { eventId: string }) => {
      seen.push(e.eventId);
    };
    expect(await handleInboundEvent({ raw: envelope(), route: ROUTE, now: NOW, store, handler })).toBe("processed");
    expect(await handleInboundEvent({ raw: envelope(), route: ROUTE, now: NOW, store, handler })).toBe("duplicate");
    expect(seen).toHaveLength(1);
  });

  it("runs no handler for a rejected envelope", async () => {
    const store = new MemoryStore();
    let ran = false;
    await expect(
      handleInboundEvent({ raw: envelope({}, "wrong-secret-0123456789abcdef0123"), route: ROUTE, now: NOW, store, handler: async () => { ran = true; } }),
    ).rejects.toMatchObject({ code: "bad_signature" });
    expect(ran).toBe(false);
    expect(store.seen.size).toBe(0);
  });

  it("releases the claim when the handler fails, so a redelivery can retry", async () => {
    const store = new MemoryStore();
    let attempts = 0;
    const handler = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("effect failed");
    };
    await expect(handleInboundEvent({ raw: envelope(), route: ROUTE, now: NOW, store, handler })).rejects.toThrow("effect failed");
    expect(await handleInboundEvent({ raw: envelope(), route: ROUTE, now: NOW, store, handler })).toBe("processed");
    expect(attempts).toBe(2);
  });
});
