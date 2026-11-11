import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { withAuth } from "../../../../../../../../lib/auth/middleware";
import type { AuthSession } from "../../../../../../../../lib/auth/middleware";
import { queryOneForSession } from "../../../../../../../../lib/db";
import { logger } from "../../../../../../../../lib/logger";
import { UPLOAD_ROOT, resolveStoredUpload } from "../../../../../../../../lib/uploads/paths";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session: AuthSession) => {
  const itemId = request.url.match(/\/vault-items\/([^/]+)\/media/)?.[1];
  const mediaId = request.url.match(/\/media\/([^/]+)\/image/)?.[1];
  if (!itemId || !mediaId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Media not found", traceId: session.traceId } },
      { status: 404 }
    );
  }

  const item = await queryOneForSession<{ id: string }>(
    session,
    `SELECT id FROM property_vault_items WHERE id = $1 AND account_id = $2`,
    [itemId, session.accountId]
  );
  if (!item) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Vault item not found", traceId: session.traceId } },
      { status: 404 }
    );
  }

  const media = await queryOneForSession<{ filename: string; mime_type: string }>(
    session,
    `SELECT filename, mime_type FROM property_vault_item_media
     WHERE id = $1 AND vault_item_id = $2 AND account_id = $3`,
    [mediaId, itemId, session.accountId]
  );
  if (!media) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Media not found", traceId: session.traceId } },
      { status: 404 }
    );
  }

  const filePath = resolveStoredUpload(path.join(UPLOAD_ROOT, "vault-items"), itemId, media.filename);
  if (!filePath) {
    logger.warn("[vault-item-media image GET] rejected stored filename", { itemId, mediaId });
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Image file not found", traceId: session.traceId } },
      { status: 404 }
    );
  }
  try {
    const buffer = fs.readFileSync(filePath);
    return new NextResponse(buffer, {
      status: 200,
      headers: { "Content-Type": media.mime_type },
    });
  } catch (err) {
    logger.warn("[vault-item-media image GET] file not found on disk", { filePath, err });
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Image file not found", traceId: session.traceId } },
      { status: 404 }
    );
  }
});
