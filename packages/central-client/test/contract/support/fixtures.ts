import { readFileSync } from "node:fs";
import { applyPatch } from "./jws";
import { centralSignEnvelope } from "./central-stub";

/** Loads a JSON fixture from test/fixtures. */
export function loadFixture<T>(relativePath: string): T {
  const url = new URL(`../../fixtures/${relativePath}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

export type ContractConfig = {
  product: string;
  application: string;
  linkAudience: string;
  clockEpochSeconds: number;
  linkKeySets: Record<string, Array<{ kid: string; label: string; notBefore: string; notAfter?: string }>>;
  centralRecord: { sub: string; org: string };
  command: { lu: string; la: string };
  baseHeader: Record<string, unknown>;
  baseAssertion: Record<string, unknown>;
  serviceClient: {
    clientId: string;
    clientSecret: string;
    tokenPath: string;
    audience: string;
    otherAudience: string;
    tokenTtlSeconds: number;
    tokenKeyLabel: string;
    tokenIssuer: string;
  };
  routeSecrets: Record<string, string>;
};

export const config = loadFixture<ContractConfig>("contract-config.json");

export type EnvelopeCase = {
  id: string;
  description: string;
  signedWith?: string;
  signatureMode?: "as-issued" | "upper" | "missing" | "truncated";
  patch?: Record<string, unknown>;
  reverseKeyOrder?: boolean;
  expect: boolean;
};

export type EnvelopeFixture = {
  base: Record<string, unknown>;
  goldenValidSignature: string;
  cases: EnvelopeCase[];
};

export const envelopeFixture = loadFixture<EnvelopeFixture>("events/envelopes.json");

/** Builds the wire envelope for one case, as the fixture describes it. */
export function buildEnvelope(testCase: EnvelopeCase): Record<string, unknown> {
  const secret = config.routeSecrets[testCase.signedWith ?? "current"];
  if (!secret) throw new Error(`fixture route secret ${testCase.signedWith} missing`);
  // The signature covers the intended content, before any tampering patch.
  const signature = centralSignEnvelope(envelopeFixture.base, secret);
  let envelope: Record<string, unknown> = applyPatch({ ...envelopeFixture.base }, testCase.patch);
  envelope.signature = signature;
  if (testCase.signatureMode === "upper") envelope.signature = signature.toUpperCase();
  if (testCase.signatureMode === "truncated") envelope.signature = signature.slice(0, 62);
  if (testCase.signatureMode === "missing") delete envelope.signature;
  if (testCase.reverseKeyOrder) {
    envelope = Object.fromEntries(Object.entries(envelope).reverse());
  }
  return envelope;
}
