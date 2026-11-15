import { deriveEd25519Key, type TestEd25519Key } from "./keys";
import { applyPatch, signCompactEdDSA } from "./jws";
import { centralVerifyLinkAssertion, CentralLinkRejection, NonceLedger, type LinkCentralContext, type PublishedLinkKey } from "./central-stub";
import { config, loadFixture } from "./fixtures";

/** Key labels used by the fixtures. Each label derives a deterministic test key. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  "sorted-previous": "sorted-contract-2026-01",
  "sorted-current": "sorted-contract-2026-11",
  "supercharged-current": "supercharged-contract-2026-11",
  attacker: "attacker-contract-key",
  "central-token": "central-token-contract-key",
};

const keyCache = new Map<string, TestEd25519Key>();

export function keyByLabel(label: string): TestEd25519Key {
  const cached = keyCache.get(label);
  if (cached) return cached;
  const kid = KEY_LABELS[label];
  if (kid === undefined) throw new Error(`unknown fixture key label ${label}`);
  const key = deriveEd25519Key(label, kid);
  keyCache.set(label, key);
  return key;
}

const isoToSeconds = (value: string): number => Math.floor(Date.parse(value) / 1000);

/** Published link key sets, as Central holds them, built from the fixture config. */
export function publishedKeySets(): Record<string, PublishedLinkKey[]> {
  const sets: Record<string, PublishedLinkKey[]> = {};
  for (const [product, keys] of Object.entries(config.linkKeySets)) {
    sets[product] = keys.map((entry) => ({
      kid: entry.kid,
      publicKey: keyByLabel(entry.label).publicKey,
      notBefore: isoToSeconds(entry.notBefore),
      notAfter: entry.notAfter === undefined ? undefined : isoToSeconds(entry.notAfter),
    }));
  }
  return sets;
}

export type LinkCase = {
  id: string;
  description: string;
  application?: string;
  signWith?: string;
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  nowSeconds?: number;
  rawToken?: string | { repeat: string; count: number };
  verifyTwice?: boolean;
  expect: "accepted" | string;
};

export type LinkCaseFixture = { cases: LinkCase[] };

export const linkCases = loadFixture<LinkCaseFixture>("link-assertion/central-cases.json").cases;

/** Builds the token for one case and runs the stub Central verifier over it. Returns "accepted" or the rejection code. */
export function runLinkCase(testCase: LinkCase): { outcome: string; token: string } {
  const header = applyPatch(config.baseHeader, testCase.header);
  const claims = applyPatch(config.baseAssertion, testCase.claims);
  let token: string;
  if (typeof testCase.rawToken === "string") {
    token = testCase.rawToken;
  } else if (testCase.rawToken !== undefined) {
    token = testCase.rawToken.repeat.repeat(testCase.rawToken.count);
  } else {
    token = signCompactEdDSA(header, claims, keyByLabel(testCase.signWith ?? "sorted-current").privateKey);
  }

  const ctx: LinkCentralContext = {
    application: testCase.application ?? config.application,
    nowSeconds: testCase.nowSeconds ?? config.clockEpochSeconds,
    keySets: publishedKeySets(),
    record: config.centralRecord,
    command: config.command,
    nonces: new NonceLedger(),
  };

  const attempt = (): string => {
    try {
      centralVerifyLinkAssertion(token, ctx);
      return "accepted";
    } catch (error) {
      if (error instanceof CentralLinkRejection) return error.code;
      throw error;
    }
  };

  const first = attempt();
  if (testCase.verifyTwice) return { outcome: first === "accepted" ? attempt() : first, token };
  return { outcome: first, token };
}
