import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { readMultipartWithLimit } from "../body-limit";

const BOUNDARY = "testboundary";
const URL_ = "http://localhost/api/v1/test";

function multipartPrefix(name: string): string {
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`
  );
}

function smallMultipart(): string {
  return `${multipartPrefix("a.jpg")}hello\r\n--${BOUNDARY}--\r\n`;
}

/** A chunked body (no Content-Length) that streams `totalBytes` of file content. */
function streamedBody(totalBytes: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const prefix = enc.encode(multipartPrefix("big.jpg"));
  const chunk = new Uint8Array(64 * 1024).fill(97);
  let sent = 0;
  let sentPrefix = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sentPrefix) {
        sentPrefix = true;
        controller.enqueue(prefix);
        sent += prefix.byteLength;
        return;
      }
      if (sent >= totalBytes) {
        controller.enqueue(enc.encode(`\r\n--${BOUNDARY}--\r\n`));
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
}

function formHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, ...extra };
}

describe("readMultipartWithLimit", () => {
  it("parses a small multipart body under the cap", async () => {
    const req = new NextRequest(URL_, {
      method: "POST",
      headers: formHeaders({ "content-length": String(smallMultipart().length) }),
      body: smallMultipart(),
    });
    const result = await readMultipartWithLimit(req, 4096);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const file = result.formData.get("file") as File;
      expect(file.name).toBe("a.jpg");
    }
  });

  it("refuses a declared Content-Length above the cap without reading the body", async () => {
    const req = new NextRequest(URL_, {
      method: "POST",
      headers: formHeaders({ "content-length": "999999999" }),
      body: smallMultipart(),
    });
    const result = await readMultipartWithLimit(req, 4096);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a chunked body (no Content-Length) that streams past the cap", async () => {
    const req = new NextRequest(URL_, {
      method: "POST",
      headers: formHeaders(),
      body: streamedBody(2 * 1024 * 1024),
      duplex: "half",
    } as RequestInit);
    const result = await readMultipartWithLimit(req, 256 * 1024);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a body whose real size exceeds a lying Content-Length", async () => {
    const req = new NextRequest(URL_, {
      method: "POST",
      headers: formHeaders({ "content-length": "100" }),
      body: streamedBody(2 * 1024 * 1024),
      duplex: "half",
    } as RequestInit);
    const result = await readMultipartWithLimit(req, 256 * 1024);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("reports malformed multipart as invalid, not too large", async () => {
    const req = new NextRequest(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not multipart",
    });
    const result = await readMultipartWithLimit(req, 4096);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
