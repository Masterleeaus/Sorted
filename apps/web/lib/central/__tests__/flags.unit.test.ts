import { describe, it, expect } from "vitest";
import { booleanFlag, createFlagReader, enumFlag, integerFlag, type FlagReaderDeps } from "../flags";
import { ORIGIN, fakeFetch, jsonResponse } from "./fakes";

const TOKENS = { getToken: async () => "svc-token" };

function clock(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function deps(over: Partial<FlagReaderDeps> & { handler?: Parameters<typeof fakeFetch>[0]; c?: ReturnType<typeof clock> } = {}) {
  const c = over.c ?? clock(0);
  const f = fakeFetch(over.handler ?? (() => jsonResponse({ error: "undeclared_flag" }, 404)));
  const d: FlagReaderDeps = {
    fetch: f.fn,
    tokens: TOKENS,
    origin: ORIGIN,
    enabled: true,
    now: c.now,
    ...over,
  };
  return { reader: createFlagReader(d), calls: f.calls, clock: c };
}

const FLAG = booleanFlag("example_flag", false);

describe("flag declarations", () => {
  it("reject keys outside the Central key syntax", () => {
    expect(() => booleanFlag("Bad-Key", false)).toThrow(/invalid flag key/);
    expect(() => booleanFlag("", false)).toThrow(/invalid flag key/);
  });

  it("reject defaults that are not valid for their type", () => {
    expect(() => enumFlag("mode", ["a", "b"], "c" as "a")).toThrow(/default is not an allowed value/);
    expect(() => integerFlag("limit", 1, 10, 11)).toThrow(/out of bounds/);
  });
});

describe("flag reads", () => {
  it("uses the declared default when reads are disabled, without a network call", async () => {
    const { reader, calls } = deps({ enabled: false });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
    expect(calls).toHaveLength(0);
  });

  it("uses the declared default when service config or tokens are missing", async () => {
    const { reader, calls } = deps({ tokens: null, origin: null });
    expect(await reader.read(FLAG, "production")).toEqual({ value: false, source: "default" });
    expect(calls).toHaveLength(0);
  });

  it("falls back to the default for an undeclared flag (404)", async () => {
    const { reader } = deps();
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
  });

  it("returns a Central value, sends only the key and environment, and caches it for 60 seconds", async () => {
    const c = clock(0);
    const { reader, calls } = deps({
      c,
      handler: () => jsonResponse({ key: "example_flag", value: true, source: "rollout", revision: 3 }),
    });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: true, source: "central" });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: true, source: "central" });
    expect(calls.filter((x) => x.url.includes("/internal/"))).toHaveLength(1);

    const url = new URL(calls.find((x) => x.url.includes("/internal/"))!.url);
    expect(url.pathname).toBe("/internal/v1/config/staging/example_flag");
    expect([...url.searchParams.keys()]).toEqual([]);
    expect((calls.find((x) => x.url.includes("/internal/"))!.init!.headers as Record<string, string>).authorization).toBe("Bearer svc-token");

    c.advance(61_000);
    await reader.read(FLAG, "staging");
    expect(calls.filter((x) => x.url.includes("/internal/"))).toHaveLength(2);
  });

  it("does not cache a fallback answer and uses the default", async () => {
    const { reader, calls } = deps({
      handler: () => jsonResponse({ key: "example_flag", value: true, source: "fallback", revision: null }),
    });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
    expect(calls.filter((x) => x.url.includes("/internal/"))).toHaveLength(2);
  });

  it("uses the default when Central returns a value of the wrong type", async () => {
    const { reader } = deps({
      handler: () => jsonResponse({ key: "example_flag", value: "yes", source: "global", revision: 1 }),
    });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
  });

  it("uses the default when the answer is for a different key", async () => {
    const { reader } = deps({
      handler: () => jsonResponse({ key: "other_flag", value: true, source: "global", revision: 1 }),
    });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
  });

  it("uses the default when the call times out or throws", async () => {
    const { reader } = deps({
      handler: () => {
        throw new Error("timeout");
      },
    });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
  });

  it("uses the default on a non-200 answer", async () => {
    const { reader } = deps({ handler: () => new Response("nope", { status: 503 }) });
    expect(await reader.read(FLAG, "staging")).toEqual({ value: false, source: "default" });
  });

  it("validates enum and integer values against their declarations", async () => {
    const mode = enumFlag("mode", ["off", "on"], "off");
    const limit = integerFlag("limit", 1, 10, 5);
    const { reader } = deps({
      handler: (url) =>
        url.endsWith("/mode")
          ? jsonResponse({ key: "mode", value: "on", source: "global", revision: 1 })
          : jsonResponse({ key: "limit", value: 11, source: "global", revision: 1 }),
    });
    expect(await reader.read(mode, "development")).toEqual({ value: "on", source: "central" });
    expect(await reader.read(limit, "development")).toEqual({ value: 5, source: "default" });
  });
});
