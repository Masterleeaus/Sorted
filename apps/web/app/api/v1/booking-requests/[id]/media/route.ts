import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth/middleware";
import { withDbSession } from "@/lib/db";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export const GET = withRole(["owner", "admin"], async (request: NextRequest, session) => {
  const id = request.url.match(/\/booking-requests\/([^/]+)\/media(?:\?|$)/)?.[1];
  if (!id || !UUID.test(id)) {
    return NextResponse.json({error:{code:"NOT_FOUND",message:"Request not found"}},{status:404,headers:privateHeaders});
  }
  const data = await withDbSession(session,async client=>{
    const {rows:booking}=await client.query(
      "SELECT id FROM booking_requests WHERE id = $1 AND account_id = $2",
      [id,session.accountId],
    );
    if(!booking[0]) return null;
    const {rows}=await client.query(
      `SELECT id, original_name, mime_type, size_bytes, created_at
       FROM intake_media
       WHERE booking_request_id = $1 AND account_id = $2
       ORDER BY created_at ASC, id ASC LIMIT 100`,
      [id,session.accountId],
    );
    return rows;
  });
  if(!data) return NextResponse.json({error:{code:"NOT_FOUND",message:"Request not found"}},{status:404,headers:privateHeaders});
  return NextResponse.json({data},{headers:privateHeaders});
});
