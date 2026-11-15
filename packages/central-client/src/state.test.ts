import { describe, expect, it } from "vitest";
import { CentralClientError } from "./errors";
import { createLoginStateSealer, generateRandomToken, parseStateKey, stateDigest } from "./state";

describe("state and nonce", () => {
  it("creates 43 character tokens from injected randomness", () => {
    expect(generateRandomToken(() => Buffer.alloc(32, 2))).toHaveLength(43);
  });

  it("digests state with SHA-256 and never returns the raw value", () => {
    const digest = stateDigest("state-value");
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digest).not.toContain("state-value");
    expect(stateDigest("state-value")).toBe(digest);
  });

  it("parses only canonical base64 of 32 bytes", () => {
    expect(parseStateKey(Buffer.alloc(32, 3).toString("base64"))).toHaveLength(32);
    expect(() => parseStateKey(Buffer.alloc(31, 3).toString("base64"))).toThrow(CentralClientError);
    expect(() => parseStateKey("not base64 at all!")).toThrow(CentralClientError);
  });

  it("round-trips a sealed value and binds it to its AAD", () => {
    const sealer = createLoginStateSealer(Buffer.alloc(32, 4));
    const sealed = sealer.seal("verifier-value", "sorted|oidc-login|digest|verifier");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("verifier-value");
    expect(sealer.open(sealed, "sorted|oidc-login|digest|verifier")).toBe("verifier-value");
    expect(() => sealer.open(sealed, "sorted|oidc-login|digest|nonce")).toThrow(CentralClientError);
  });

  it("rejects tampered and foreign-key ciphertext", () => {
    const sealer = createLoginStateSealer(Buffer.alloc(32, 4));
    const sealed = sealer.seal("value", "aad");
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(() => sealer.open(tampered, "aad")).toThrow(CentralClientError);
    const other = createLoginStateSealer(Buffer.alloc(32, 5));
    expect(() => other.open(sealed, "aad")).toThrow(CentralClientError);
  });
});
