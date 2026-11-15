import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

/**
 * Deterministic Ed25519 keys for contract fixtures. Each seed is the SHA-256 of a
 * fixed label, so no key material is committed. These keys are not used anywhere
 * outside this test harness.
 */

// PKCS#8 wrapper for an Ed25519 private key seed (RFC 8410).
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type TestEd25519Key = Readonly<{
  label: string;
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicJwk: Readonly<{ kty: "OKP"; crv: "Ed25519"; x: string }>;
}>;

export function deriveEd25519Key(label: string, kid: string): TestEd25519Key {
  const seed = createHash("sha256").update(`titan-central-client-contract/${label}`, "utf8").digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (typeof jwk.x !== "string") throw new Error("public key export missing x");
  return { label, kid, privateKey, publicKey, publicJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x } };
}
