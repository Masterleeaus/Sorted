import { NextRequest, NextResponse } from "next/server";
import { withTokenAccountContext } from "../../../_lib/account-context";
import { readScheduledBookingConfig, ScheduledBookingConfigError } from "@/lib/scheduled-bookings/config";
import { handleScheduledBookingEvent } from "@/lib/scheduled-bookings/handler";
import { MAX_ENVELOPE_BYTES } from "@/lib/scheduled-bookings/envelope";
import { readBodyUpTo } from "@/lib/scheduled-bookings/bounded-body";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Inbound Scheduled booking events delivered by Central's outbox (EVENTS.md).
 * Default off: unless SCHEDULED_BOOKING_EVENTS_ENABLED is "1", the route answers 404
 * and reads nothing. Authentication is the envelope HMAC, checked inside the handler.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let config;
  try {
    config = readScheduledBookingConfig();
  } catch (err) {
    if (err instanceof ScheduledBookingConfigError) {
      logger.error("[scheduled booking events] misconfigured", { variable: err.variable });
    }
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: "Scheduled booking events are not configured" } },
      { status: 503 },
    );
  }
  if (!config.enabled) {
    return new NextResponse(null, { status: 404 });
  }

  // A declared length is an early refusal only. When it is absent or malformed, readBodyUpTo
  // still stops at the limit while reading, so the full body is never buffered.
  const declaredHeader = request.headers.get("content-length");
  const declared = declaredHeader !== null && /^\d+$/.test(declaredHeader.trim()) ? Number(declaredHeader) : 0;
  const tooLarge = () =>
    NextResponse.json(
      { error: { code: "payload_too_large", message: "envelope exceeds the size limit" } },
      { status: 413 },
    );
  if (declared > MAX_ENVELOPE_BYTES) return tooLarge();

  const rawBody = await readBodyUpTo(request, MAX_ENVELOPE_BYTES);
  if (rawBody === null) return tooLarge();
  const result = await handleScheduledBookingEvent({
    rawBody,
    config,
    runInTenant: (tenantId, fn) => withTokenAccountContext(tenantId, fn, "owner"),
  });
  return NextResponse.json(result.body, { status: result.status });
}
