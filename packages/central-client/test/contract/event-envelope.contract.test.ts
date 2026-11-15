import { beforeAll, afterAll, describe, expect } from "vitest";
import { deliverEnvelope, startStubConsumer, type StubConsumer } from "./support/central-stub";
import { buildEnvelope, config, envelopeFixture } from "./support/fixtures";
import { contractTest, requireExport } from "./support/public-api";

/**
 * Inbound event envelope contract (EVENTS.md). Pending until packages/central-client
 * exports verifyEventEnvelopeSignature(envelope, secret): boolean.
 */

const test = contractTest(["verifyEventEnvelopeSignature"]);

type Verify = (envelope: Record<string, unknown>, secret: string) => boolean;

describe("event envelope contract (inbound verification)", () => {
  const secret = config.routeSecrets.current as string;

  for (const testCase of envelopeFixture.cases) {
    test(`${testCase.id}: ${testCase.description}`, () => {
      const verify = requireExport<Verify>("verifyEventEnvelopeSignature");
      expect(verify(buildEnvelope(testCase), secret)).toBe(testCase.expect);
    });
  }

  test("accepts an envelope that arrives over HTTP as JSON", async () => {
    const verify = requireExport<Verify>("verifyEventEnvelopeSignature");
    let consumer: StubConsumer | undefined;
    consumer = await startStubConsumer((body) => (verify(body, secret) ? 200 : 401));
    try {
      const status = await deliverEnvelope(consumer.url, buildEnvelope(envelopeFixture.cases[0]!));
      expect(status).toBe(200);
    } finally {
      await consumer.close();
    }
  });

  test("answers 401 for a tampered envelope delivered over HTTP", async () => {
    const verify = requireExport<Verify>("verifyEventEnvelopeSignature");
    const consumer = await startStubConsumer((body) => (verify(body, secret) ? 200 : 401));
    try {
      const tampered = buildEnvelope(envelopeFixture.cases.find((item) => item.id === "EV-03-payload-tampered")!);
      expect(await deliverEnvelope(consumer.url, tampered)).toBe(401);
    } finally {
      await consumer.close();
    }
  });
});
