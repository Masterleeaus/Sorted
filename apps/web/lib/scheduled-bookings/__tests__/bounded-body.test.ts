import { describe, expect, it } from "vitest";
import { readBodyUpTo } from "../bounded-body";

function pulledStream(chunks: Uint8Array[]) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[pulled]);
      pulled += 1;
    },
  });
  return { body, pulledCount: () => pulled };
}

describe("readBodyUpTo", () => {
  it("returns the full text when the body is within the limit", async () => {
    const { body } = pulledStream([new TextEncoder().encode('{"a":'), new TextEncoder().encode("1}")]);
    await expect(readBodyUpTo({ body }, 64)).resolves.toBe('{"a":1}');
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode("é€");
    const { body } = pulledStream([bytes.slice(0, 1), bytes.slice(1)]);
    await expect(readBodyUpTo({ body }, 64)).resolves.toBe("é€");
  });

  it("refuses an over-limit body without reading the rest of the stream", async () => {
    const chunk = new Uint8Array(1024).fill(0x61);
    const { body, pulledCount } = pulledStream(Array.from({ length: 100 }, () => chunk));
    await expect(readBodyUpTo({ body }, 16 * 1024)).resolves.toBeNull();
    // 16 chunks of 1 KiB reach the limit; the stream must not have been drained to 100.
    expect(pulledCount()).toBeLessThan(100);
  });

  it("returns an empty string for a request with no body", async () => {
    await expect(readBodyUpTo({ body: null }, 16)).resolves.toBe("");
  });
});
