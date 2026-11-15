/**
 * Reads a request body as UTF-8 text, stopping once more than `limit` bytes have arrived.
 * Used because Content-Length can be absent or malformed, so the limit has to hold while reading.
 * Returns null when the body is over the limit; the rest of the stream is cancelled unread.
 */
export async function readBodyUpTo(
  request: Pick<Request, "body">,
  limit: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}
