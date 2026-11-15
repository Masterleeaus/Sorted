import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { CentralClientError } from "./errors";
import type { RandomBytesSource } from "./pkce";

/** AES-256-GCM sealing of PKCE verifiers and nonces at rest. Format: "v1." + base64url(iv | tag | ciphertext). */
const PREFIX = "v1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Decodes TITAN_OIDC_STATE_KEY. Must be canonical base64 of exactly 32 bytes. */
export function parseStateKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new CentralClientError("config_invalid", "state key must be base64 of 32 bytes");
  }
  return key;
}

/** Opaque random token for `state` and `nonce`: 32 bytes, base64url. */
export function generateRandomToken(random: RandomBytesSource = randomBytes): string {
  return random(32).toString("base64url");
}

/** Digest used as the storage key for pending logins. Raw state is never stored. */
export function stateDigest(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("base64url");
}

export interface LoginStateSealer {
  seal(plaintext: string, aad: string, random?: RandomBytesSource): string;
  open(sealed: string, aad: string): string;
}

export function createLoginStateSealer(key: Buffer): LoginStateSealer {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new CentralClientError("config_invalid", "32-byte key required");
  }
  return {
    seal(plaintext, aad, random = randomBytes) {
      if (plaintext.length === 0 || aad.length === 0) {
        throw new CentralClientError("seal_invalid", "invalid seal input");
      }
      const iv = random(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    open(sealed, aad) {
      if (typeof sealed !== "string" || !sealed.startsWith(PREFIX)) {
        throw new CentralClientError("seal_rejected", "sealed value rejected");
      }
      const raw = Buffer.from(sealed.slice(PREFIX.length), "base64url");
      if (raw.length < IV_BYTES + TAG_BYTES + 1) {
        throw new CentralClientError("seal_rejected", "sealed value rejected");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      try {
        return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
      } catch {
        throw new CentralClientError("seal_rejected", "sealed value rejected");
      }
    },
  };
}
