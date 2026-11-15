import { createHmac, createPublicKey, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { signCompactEdDSA } from "./jws";
import type { TestEd25519Key } from "./keys";

/**
 * Stub Central for contract tests. It is a reference implementation written from
 * docs/LINKING.md and docs/EVENTS.md. It does not import the package under test.
 */

// ---------------------------------------------------------------------------
// Account-link assertions (LINKING.md, "Verification order")
// ---------------------------------------------------------------------------

export const LINK_REJECTION_CODES = [
  "unknown_product",
  "malformed",
  "bad_algorithm",
  "forbidden_claim",
  "product_mismatch",
  "wrong_audience",
  "unknown_key",
  "key_inactive",
  "bad_signature",
  "missing_claim",
  "bad_lifetime",
  "future_dated",
  "expired",
  "identifier_not_permitted",
  "subject_mismatch",
  "organisation_mismatch",
  "account_mismatch",
  "replayed",
] as const;

export type LinkRejectionCode = (typeof LINK_REJECTION_CODES)[number];

export class CentralLinkRejection extends Error {
  readonly code: LinkRejectionCode;
  constructor(code: LinkRejectionCode) {
    super(code);
    this.name = "CentralLinkRejection";
    this.code = code;
  }
}

export const LINK_APPLICATIONS: Readonly<Record<string, string>> = {
  field: "sorted",
  desk: "supercharged",
  academy: "lms",
};

export type PublishedLinkKey = {
  kid: string;
  publicKey: KeyObject;
  /** Epoch seconds. */
  notBefore: number;
  /** Epoch seconds, exclusive. */
  notAfter?: number;
};

/** Single-use nonce ledger, scoped per product, pruned at expiry. */
export class NonceLedger {
  private readonly seen = new Map<string, number>();

  /** Returns false when the nonce was already consumed. */
  consume(product: string, nonce: string, expiresAtSeconds: number, nowSeconds: number): boolean {
    for (const [key, expiry] of this.seen) {
      if (expiry <= nowSeconds) this.seen.delete(key);
    }
    const key = `${product}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, expiresAtSeconds);
    return true;
  }
}

export type LinkCentralContext = {
  application: string;
  nowSeconds: number;
  keySets: Readonly<Record<string, PublishedLinkKey[]>>;
  record: Readonly<{ sub: string; org: string }>;
  command: Readonly<{ lu: string; la: string }>;
  nonces: NonceLedger;
};

const FORBIDDEN_CLAIMS = [
  "email",
  "email_verified",
  "name",
  "given_name",
  "family_name",
  "display_name",
  "displayName",
  "preferred_username",
  "username",
  "nickname",
  "phone_number",
];
const REQUIRED_CLAIMS = ["iss", "aud", "sub", "org", "lu", "la", "nonce", "iat", "exp"];
const ALLOWED_HEADER = ["alg", "typ", "kid"];
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOKEN_MAX_LENGTH = 4096;
const MAX_LIFETIME_SECONDS = 300;
const FUTURE_SKEW_SECONDS = 30;

function reject(code: LinkRejectionCode): never {
  throw new CentralLinkRejection(code);
}

function parseObjectSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Verifies a link assertion the way Central does, in the documented order. Returns the claims on success. */
export function centralVerifyLinkAssertion(token: string, ctx: LinkCentralContext): Record<string, unknown> {
  const product = LINK_APPLICATIONS[ctx.application];
  if (product === undefined) reject("unknown_product");

  if (typeof token !== "string" || token.length > TOKEN_MAX_LENGTH) reject("malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !SEGMENT_PATTERN.test(part))) reject("malformed");
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  const header = parseObjectSegment(headerSegment) ?? reject("malformed");
  if (header.alg !== "EdDSA" || header.typ !== "titan-link+jwt") reject("bad_algorithm");
  if (Object.keys(header).some((key) => !ALLOWED_HEADER.includes(key))) reject("malformed");
  if (typeof header.kid !== "string") reject("malformed");

  const payload = parseObjectSegment(payloadSegment) ?? reject("malformed");
  if (FORBIDDEN_CLAIMS.some((key) => key in payload)) reject("forbidden_claim");

  const iss = payload.iss;
  const keys = typeof iss === "string" ? ctx.keySets[iss] : undefined;
  if (keys === undefined) reject("unknown_product");
  if (iss !== product) reject("product_mismatch");
  if (payload.aud !== "titan-central") reject("wrong_audience");

  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (key === undefined) reject("unknown_key");
  if (ctx.nowSeconds < key.notBefore || (key.notAfter !== undefined && ctx.nowSeconds >= key.notAfter)) {
    reject("key_inactive");
  }

  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`, "ascii");
  if (!verify(null, signingInput, key.publicKey, Buffer.from(signatureSegment, "base64url"))) {
    reject("bad_signature");
  }

  for (const claim of REQUIRED_CLAIMS) {
    if (!(claim in payload)) reject("missing_claim");
  }
  const { iat, exp } = payload as { iat: unknown; exp: unknown };
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) reject("bad_lifetime");
  const iatSeconds = iat as number;
  const expSeconds = exp as number;
  if (expSeconds <= iatSeconds || expSeconds - iatSeconds > MAX_LIFETIME_SECONDS) reject("bad_lifetime");
  if (iatSeconds > ctx.nowSeconds + FUTURE_SKEW_SECONDS) reject("future_dated");
  if (ctx.nowSeconds >= expSeconds) reject("expired");

  for (const field of ["sub", "org", "lu", "la"]) {
    const value = payload[field];
    if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) reject("identifier_not_permitted");
  }
  if (typeof payload.nonce !== "string" || !NONCE_PATTERN.test(payload.nonce)) reject("malformed");

  if (payload.sub !== ctx.record.sub) reject("subject_mismatch");
  if (payload.org !== ctx.record.org) reject("organisation_mismatch");
  if (payload.lu !== ctx.command.lu || payload.la !== ctx.command.la) reject("account_mismatch");

  if (!ctx.nonces.consume(product, payload.nonce, expSeconds, ctx.nowSeconds)) reject("replayed");
  return payload;
}

// ---------------------------------------------------------------------------
// Event envelopes (EVENTS.md, "Envelope" and "Key rotation")
// ---------------------------------------------------------------------------

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical JSON: object keys sorted at every depth, no whitespace. Mirrors Central's canonicalJson. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** hex HMAC-SHA256 over the canonical JSON of every field except `signature`. */
export function centralSignEnvelope(unsigned: Record<string, unknown>, secret: string): string {
  const { signature: _ignored, ...fields } = unsigned;
  return createHmac("sha256", secret).update(canonicalJson(fields), "utf8").digest("hex");
}

/** Constant-time check of an envelope against one route secret. Mirrors Central's verifyEnvelopeSignature. */
export function centralVerifyEnvelope(envelope: Record<string, unknown>, secret: string): boolean {
  const { signature, ...unsigned } = envelope;
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(centralSignEnvelope(unsigned, secret), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---------------------------------------------------------------------------
// HTTP stub: token endpoint, protected API and a consumer that receives events
// ---------------------------------------------------------------------------

export type TokenRequest = {
  method: string;
  path: string;
  authorization: string | undefined;
  form: Record<string, string>;
};

export type ApiRequest = {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
};

export type TokenResponse = { status: number; body?: unknown; raw?: string };

export type StubCentralOptions = Readonly<{
  clock: { nowSeconds: number };
  tokenKey: TestEd25519Key;
  tokenKid: string;
  tokenIssuer: string;
  tokenPath: string;
  clientId: string;
  clientSecret: string;
  defaultAudience: string;
  tokenTtlSeconds: number;
}>;

export type StubCentral = {
  origin: string;
  tokenRequests: TokenRequest[];
  apiRequests: ApiRequest[];
  /** Overridable responder for the token endpoint. */
  onToken: (request: TokenRequest, issue: (audience?: string) => string) => TokenResponse;
  /** Overridable responder for the protected API (`/v1/*`). */
  onApi: (request: ApiRequest, bearerValid: boolean) => TokenResponse;
  issueToken: (audience?: string) => string;
  close: () => Promise<void>;
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startStubCentral(options: StubCentralOptions): Promise<StubCentral> {
  const tokenRequests: TokenRequest[] = [];
  const apiRequests: ApiRequest[] = [];
  const expectedBasic = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
  const issuerPublicKey = createPublicKey(options.tokenKey.privateKey);

  const issueToken = (audience: string = options.defaultAudience): string => {
    const iat = options.clock.nowSeconds;
    return signCompactEdDSA(
      { alg: "EdDSA", typ: "JWT", kid: options.tokenKid },
      {
        iss: options.tokenIssuer,
        aud: audience,
        sub: "svc_contract_sorted",
        iat,
        exp: iat + options.tokenTtlSeconds,
      },
      options.tokenKey.privateKey,
    );
  };

  const bearerValid = (authorization: string | undefined): boolean => {
    if (!authorization?.startsWith("Bearer ")) return false;
    const parts = authorization.slice("Bearer ".length).split(".");
    if (parts.length !== 3) return false;
    const claims = parseObjectSegment(parts[1] as string);
    if (!claims || typeof claims.exp !== "number" || claims.exp <= options.clock.nowSeconds) return false;
    return verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"), issuerPublicKey, Buffer.from(parts[2] as string, "base64url"));
  };

  const stub = {
    origin: "",
    tokenRequests,
    apiRequests,
    onToken: (_request: TokenRequest, issue: (audience?: string) => string): TokenResponse => ({
      status: 200,
      body: { access_token: issue(), token_type: "Bearer", expires_in: options.tokenTtlSeconds },
    }),
    onApi: (_request: ApiRequest, valid: boolean): TokenResponse => (valid ? { status: 200, body: { ok: true } } : { status: 401 }),
    issueToken,
    close: async () => undefined,
  };

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://stub.invalid");
    const raw = await readBody(request);

    if (request.method === "POST" && url.pathname === options.tokenPath) {
      const form = Object.fromEntries(new URLSearchParams(raw));
      const tokenRequest: TokenRequest = {
        method: request.method,
        path: url.pathname,
        authorization: request.headers.authorization,
        form,
      };
      tokenRequests.push(tokenRequest);
      if (request.headers.authorization !== expectedBasic || form.grant_type !== "client_credentials") {
        sendJson(response, 401, { error: "invalid_client" });
        return;
      }
      const reply = stub.onToken(tokenRequest, (audience) => issueToken(audience ?? form.resource ?? options.defaultAudience));
      if (reply.raw !== undefined) {
        response.writeHead(reply.status, { "content-type": "application/json" });
        response.end(reply.raw);
      } else {
        sendJson(response, reply.status, reply.body ?? {});
      }
      return;
    }

    if (url.pathname.startsWith("/v1/")) {
      let body: unknown = undefined;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      const apiRequest: ApiRequest = {
        method: request.method ?? "GET",
        path: url.pathname,
        authorization: request.headers.authorization,
        body,
      };
      apiRequests.push(apiRequest);
      const reply = stub.onApi(apiRequest, bearerValid(request.headers.authorization));
      sendJson(response, reply.status, reply.body ?? {});
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  stub.origin = `http://127.0.0.1:${port}`;
  stub.close = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return stub;
}

export type ReceivedDelivery = {
  path: string;
  contentType: string | undefined;
  headerNames: string[];
  body: Record<string, unknown>;
};

export type StubConsumer = {
  url: string;
  received: ReceivedDelivery[];
  close: () => Promise<void>;
};

/** A consumer endpoint. The handler decides the status code it answers with. */
export async function startStubConsumer(
  handler: (body: Record<string, unknown>) => number,
): Promise<StubConsumer> {
  const received: ReceivedDelivery[] = [];
  const server: Server = createServer(async (request, response) => {
    const raw = await readBody(request);
    const body = JSON.parse(raw) as Record<string, unknown>;
    received.push({
      path: request.url ?? "",
      contentType: request.headers["content-type"],
      headerNames: Object.keys(request.headers),
      body,
    });
    response.writeHead(handler(body), { "content-type": "text/plain" });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/outbox`,
    received,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/** Central side of a delivery: POSTs the signed envelope as JSON, with no other headers. */
export async function deliverEnvelope(url: string, envelope: Record<string, unknown>): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  return response.status;
}

export function parseSegmentObject(segment: string): Record<string, unknown> | null {
  return parseObjectSegment(segment);
}
