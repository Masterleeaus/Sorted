import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canonicalJson,
  centralSignEnvelope,
  centralVerifyEnvelope,
  centralVerifyLinkAssertion,
  deliverEnvelope,
  LINK_REJECTION_CODES,
  NonceLedger,
  startStubConsumer,
  type StubConsumer,
} from "./support/central-stub";
import { buildEnvelope, config, envelopeFixture } from "./support/fixtures";
import { linkCases, publishedKeySets, runLinkCase } from "./support/link-cases";

/**
 * Harness self-test. These run without the package under test. They check that the
 * stub Central reproduces the fixture expectations taken from the Central docs,
 * so that a later failure points at the client, not at the harness.
 */

describe("canonical JSON (EVENTS.md signature input)", () => {
  it("sorts object keys at every depth with no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: "x" }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"y":"x","z":1}]},"b":1}',
    );
  });

  it("gives the same canonical text for members in any order", () => {
    expect(canonicalJson({ x: 1, y: [2, 3] })).toBe(canonicalJson({ y: [2, 3], x: 1 }));
  });
});

describe("event envelope fixtures", () => {
  it("reproduces the golden signature for the base envelope", () => {
    expect(centralSignEnvelope(envelopeFixture.base, config.routeSecrets.current)).toBe(
      envelopeFixture.goldenValidSignature,
    );
  });

  for (const testCase of envelopeFixture.cases) {
    it(`${testCase.id}: stub Central verification gives ${testCase.expect}`, () => {
      const envelope = buildEnvelope(testCase);
      // Always verified against the route secret, as the consumer would.
      expect(centralVerifyEnvelope(envelope, config.routeSecrets.current as string)).toBe(testCase.expect);
    });
  }
});

describe("link assertion fixtures", () => {
  it("covers every rejection code documented in LINKING.md", () => {
    const covered = new Set(linkCases.map((testCase) => testCase.expect));
    const missing = LINK_REJECTION_CODES.filter((code) => !covered.has(code));
    expect(missing).toEqual([]);
  });

  for (const testCase of linkCases) {
    it(`${testCase.id}: stub Central gives ${testCase.expect}`, () => {
      expect(runLinkCase(testCase).outcome).toBe(testCase.expect);
    });
  }

  it("keeps the base assertion inside the documented lifetime", () => {
    const claims = config.baseAssertion as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBeGreaterThan(0);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
  });

  it("publishes the previous and current sorted keys with their windows", () => {
    const keys = publishedKeySets().sorted as Array<{ kid: string; notAfter?: number }>;
    expect(keys.map((key) => key.kid)).toEqual(["sorted-contract-2026-01", "sorted-contract-2026-11"]);
    expect(keys[1]?.notAfter).toBeUndefined();
  });

  it("refuses a nonce that is replayed against the same ledger", () => {
    const ledger = new NonceLedger();
    expect(ledger.consume("sorted", "nonce-aaaaaaaaaaaaaaaaaaaa", 100, 50)).toBe(true);
    expect(ledger.consume("sorted", "nonce-aaaaaaaaaaaaaaaaaaaa", 100, 60)).toBe(false);
    expect(ledger.consume("sorted", "nonce-aaaaaaaaaaaaaaaaaaaa", 100, 101)).toBe(true);
  });
});

describe("stub consumer delivery", () => {
  let consumer: StubConsumer;

  beforeAll(async () => {
    consumer = await startStubConsumer(() => 200);
  });

  afterAll(async () => {
    await consumer.close();
  });

  it("receives the envelope as a JSON body with no signature header", async () => {
    const envelope = buildEnvelope(envelopeFixture.cases[0]!);
    const status = await deliverEnvelope(consumer.url, envelope);
    expect(status).toBe(200);
    const last = consumer.received[consumer.received.length - 1]!;
    expect(last.contentType).toBe("application/json");
    expect(last.body).toEqual(envelope);
    expect(last.headerNames.some((name) => name.startsWith("x-"))).toBe(false);
  });
});
