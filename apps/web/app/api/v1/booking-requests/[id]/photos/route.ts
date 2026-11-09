/**
 * GET /api/v1/booking-requests/[id]/photos — read-only list of the customer photos
 * linked to a booking request. Owner and admin only, matching the request detail page.
 * Returns metadata only; there is no file URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth/middleware";
import { listRequestIntakePhotos } from "@/lib/intake/request-photos";

export const dynamic = "force-dynamic";

function extractId(url: string): string | null {
  return url.match(/\/booking-requests\/([^/]+)\/photos/)?.[1] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withRole(["owner", "admin"], async (request: NextRequest, session) => {
  const id = extractId(request.url);
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Booking request not found", traceId: session.traceId } },
      { status: 404 },
    );
  }

  const photos = await listRequestIntakePhotos(session, id);
  if (photos === null) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Booking request not found", traceId: session.traceId } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: photos });
});
