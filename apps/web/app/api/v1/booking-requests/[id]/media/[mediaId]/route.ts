import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth/middleware";
import { withDbSession } from "@/lib/db";
import { intakeMediaFilePath } from "@/lib/intake/media-storage";
import { readPrivateIntakeFile } from "@/lib/intake/media-files";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateHeaders = {
  "Cache-Control":"private, no-store",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'; sandbox",
};
export const GET = withRole(["owner","admin"], async (request: NextRequest, session) => {
  const ids = request.url.match(/\/booking-requests\/([^/]+)\/media\/([^/?]+)(?:\?|$)/);
  const bookingId=ids?.[1], mediaId=ids?.[2];
  if(!bookingId || !mediaId || !UUID.test(bookingId) || !UUID.test(mediaId)) {
    return NextResponse.json({error:{code:"NOT_FOUND",message:"Photo not found"}},{status:404,headers:privateHeaders});
  }
  const media=await withDbSession(session,async client=>{
    const {rows}=await client.query<{intake_invite_id:string;filename:string;mime_type:string}>(
      `SELECT im.intake_invite_id, im.filename, im.mime_type
       FROM intake_media im
       JOIN booking_requests br ON br.id = im.booking_request_id
       WHERE im.id = $1 AND im.booking_request_id = $2
         AND im.account_id = $3 AND br.account_id = $3`,
      [mediaId,bookingId,session.accountId],
    );
    return rows[0] ?? null;
  });
  if(!media) return NextResponse.json({error:{code:"NOT_FOUND",message:"Photo not found"}},{status:404,headers:privateHeaders});
  const storedPath=intakeMediaFilePath(media.intake_invite_id,media.filename);
  const bytes=storedPath ? readPrivateIntakeFile(storedPath) : null;
  if(!bytes) return NextResponse.json({error:{code:"NOT_FOUND",message:"Photo unavailable"}},{status:404,headers:privateHeaders});
  return new NextResponse(new Blob([Buffer.from(bytes)]), {
    status:200,
    headers:{
      ...privateHeaders,
      "Content-Type":media.mime_type,
      "Content-Disposition":"attachment; filename=\"intake-photo\"",
      "Content-Length":String(bytes.byteLength),
    },
  });
});
