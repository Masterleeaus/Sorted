/**
 * Inbound event envelope signature check (Central contract, docs/EVENTS.md).
 *
 * Ported from apps/web/lib/scheduled-bookings/envelope.ts. The envelope carries a hex HMAC-SHA256
 * `signature` over the canonical JSON (object keys sorted at every depth, no whitespace) of every
 * other field, keyed by the route secret. This check only authenticates the envelope. Tenant binding
 * and payload checks happen after it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_RE = /^[0-9a-f]{64}$/;
const MAX_DEPTH = 16;

/** Canonical JSON as Central writes it. Throws on values that are not JSON. Internal to this module. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error('envelope nesting too deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('envelope numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) throw new Error('envelope values must be JSON');
      parts.push(`${JSON.stringify(key)}:${canonicalJson(item, depth + 1)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new Error('envelope values must be JSON');
}

/**
 * Constant-time check of an envelope signature against one route secret.
 * Returns false for any malformed or mismatched signature; never throws on attacker input.
 */
export function verifyEventEnvelopeSignature(envelope: Record<string, unknown>, secret: string): boolean {
  const { signature, ...unsigned } = envelope;
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) return false;
  let expected: Buffer;
  try {
    expected = createHmac('sha256', secret).update(canonicalJson(unsigned), 'utf8').digest();
  } catch {
    return false;
  }
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
