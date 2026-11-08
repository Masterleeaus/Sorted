import { NextRequest, NextResponse } from "next/server";

/**
 * Bounded multipart parsing for upload routes.
 *
 * `request.formData()` buffers the whole body before any per-file check runs, so each
 * route first enforces a body cap:
 *   1. A declared Content-Length above the cap is refused before the body is read.
 *   2. Otherwise the body stream is counted as it is read (covers chunked bodies and
 *      a Content-Length that lies). Reading stops as soon as the cap is passed.
 * Per-file MIME and size checks still run after parsing.
 *
 * The matching production proxy limit is documented in docs/working/upload-body-limits.md.
 */

const MIB = 1024 * 1024;

/** Documented body caps per route. Each is the route's per-file limit plus multipart overhead. */
export const UPLOAD_BODY_LIMITS = {
  /** Visit and vault-item photos: 10 MB file. */
  mediaPhoto: 11 * MIB,
  /** Expense receipt photo: 10 MB file. */
  expenseReceipt: 11 * MIB,
  /** Captures: 25 MB audio + 10 MB photo + transcript text. */
  captures: 40 * MIB,
  /** Expense CSV import preview: 5 MB file. */
  expenseImportPreview: 6 * MIB,
} as const;

export type UploadBodyLimit = (typeof UPLOAD_BODY_LIMITS)[keyof typeof UPLOAD_BODY_LIMITS];

export function formatLimit(maxBytes: number): string {
  return `${Math.round(maxBytes / MIB)} MB`;
}

export type MultipartResult =
  | { ok: true; formData: FormData }
  | { ok: false; reason: "too_large" | "invalid" };

class BodyLimitExceeded extends Error {
  constructor() {
    super("request body exceeds upload limit");
  }
}

export async function readMultipartWithLimit(request: NextRequest, maxBytes: number): Promise<MultipartResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  if (!request.body) {
    return { ok: false, reason: "invalid" };
  }

  let received = 0;
  let exceeded = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        exceeded = true;
        controller.error(new BodyLimitExceeded());
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");

  try {
    const bounded = new Request(request.url, {
      method: "POST",
      headers,
      body: request.body.pipeThrough(counter),
      duplex: "half",
    } as RequestInit);
    const formData = await bounded.formData();
    if (exceeded) return { ok: false, reason: "too_large" };
    return { ok: true, formData };
  } catch {
    return { ok: false, reason: exceeded ? "too_large" : "invalid" };
  }
}

export function payloadTooLargeResponse(traceId: string, maxBytes: number): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: `Upload is larger than the ${formatLimit(maxBytes)} limit for this request`,
        traceId,
      },
    },
    { status: 413 },
  );
}
