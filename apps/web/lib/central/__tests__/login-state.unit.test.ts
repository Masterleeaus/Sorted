import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { LoginStateError, openLoginTransaction, sealLoginTransaction } from "../login-state";

const NOW = 1_794_240_000;

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}
const TX = { state: "state-1", nonce: "nonce-1", verifier: "verifier-1", iat: NOW };

describe("sealed login transaction", () => {
  const prev = process.env.APP_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  afterEach(() => {
    process.env.APP_ENCRYPTION_KEY = prev;
  });

  it("round-trips the transaction and does not expose it in the sealed value", () => {
    const sealed = sealLoginTransaction(TX);
    expect(sealed).not.toContain("verifier-1");
    expect(sealed).not.toContain("state-1");
    expect(openLoginTransaction(sealed, NOW + 5)).toEqual(TX);
  });

  it("refuses a tampered value", () => {
    const sealed = sealLoginTransaction(TX);
    const i = Math.floor(sealed.length / 2);
    const flipped = sealed.slice(0, i) + (sealed[i] === "A" ? "B" : "A") + sealed.slice(i + 1);
    expect(() => openLoginTransaction(flipped, NOW)).toThrow(LoginStateError);
  });

  it("refuses a missing cookie", () => {
    expect(() => openLoginTransaction(undefined, NOW)).toThrow(/no login transaction/);
  });

  it("refuses an expired transaction", () => {
    const sealed = sealLoginTransaction({ ...TX, iat: NOW - 601 });
    expect(errorOf(() => openLoginTransaction(sealed, NOW))).toMatchObject({ code: "expired_login_state" });
  });

  it("refuses a transaction issued in the future", () => {
    const sealed = sealLoginTransaction({ ...TX, iat: NOW + 120 });
    expect(errorOf(() => openLoginTransaction(sealed, NOW))).toMatchObject({ code: "expired_login_state" });
  });

  it("fails loudly when APP_ENCRYPTION_KEY is unset", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => sealLoginTransaction(TX)).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
