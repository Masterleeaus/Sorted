import { describe, expect, it } from "vitest";
import { escapeHtml, hrefAttr, safeUrl } from "../escape.js";

describe("escapeHtml", () => {
  it("escapes tags, quotes, ampersands and apostrophes", () => {
    expect(escapeHtml(`<script>alert("x & 'y'")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;",
    );
  });

  it("does not double-escape existing entities", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("returns empty string for null/undefined and stringifies numbers", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(7)).toBe("7");
  });
});

describe("safeUrl", () => {
  it.each([
    "https://example.test/a?x=1&y=2",
    "http://example.test/path",
    "mailto:jane@example.test",
  ])("allows %s", (url) => {
    expect(safeUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "/relative/path",
    "https://exa mple.test",
    "https://",
    "",
    null,
    undefined,
  ])("rejects %j", (url) => {
    expect(safeUrl(url as string | null | undefined)).toBeNull();
  });
});

describe("hrefAttr", () => {
  it("escapes quotes and ampersands in allowed URLs", () => {
    expect(hrefAttr(`https://example.test/?a=1&b="x"`)).toBe(
      "https://example.test/?a=1&amp;b=&quot;x&quot;",
    );
  });

  it("replaces unsafe URLs with #", () => {
    expect(hrefAttr("javascript:alert(1)")).toBe("#");
    expect(hrefAttr(null)).toBe("#");
  });
});
