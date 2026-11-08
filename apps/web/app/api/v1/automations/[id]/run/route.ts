import { NextRequest, NextResponse } from "next/server";
import { withRole } from "../../../../../../lib/auth/middleware";
import type { AuthSession } from "../../../../../../lib/auth/middleware";
import { queryForSession, withDbSession } from "../../../../../../lib/db";
import { logger } from "../../../../../../lib/logger";
import {
  triggerAutomation,
  validateAutomationId,
  buildSuccessResponse,
  buildErrorResponse,
  type AutomationRecord,
} from "../../../../../../lib/automations/service";

export const dynamic = "force-dynamic";

async function getAutomation(
  session: AuthSession,
  automationId: string,
): Promise<AutomationRecord | null> {
  const rows = await queryForSession<AutomationRecord>(
    session,
    `SELECT id, type, account_id, enabled FROM automations WHERE id = $1 AND account_id = $2`,
    [automationId, session.accountId]
  );
  return rows[0] ?? null;
}

export const POST = withRole(
  ["owner", "admin"],
  async (request: NextRequest, session: AuthSession) => {
    const automationId = validateAutomationId(
      request.nextUrl.pathname.split("/")[4]
    );

    if (!automationId) {
      return NextResponse.json(
        {
          error: {
            ...buildErrorResponse("VALIDATION_ERROR", "Automation ID required"),
            traceId: session.traceId,
          },
        },
        { status: 422 }
      );
    }

    const automation = await getAutomation(session, automationId);

    if (!automation) {
      return NextResponse.json(
        {
          error: {
            ...buildErrorResponse("NOT_FOUND", "Automation not found"),
            traceId: session.traceId,
          },
        },
        { status: 404 }
      );
    }

    if (!automation.enabled) {
      return NextResponse.json(
        {
          error: {
            ...buildErrorResponse("VALIDATION_ERROR", "Automation is disabled"),
            traceId: session.traceId,
          },
        },
        { status: 422 }
      );
    }

    try {
      await withDbSession(session, (client) =>
        triggerAutomation(client, automationId, automation, {
          accountId: session.accountId,
          userId: session.userId,
          traceId: session.traceId,
        })
      );

      const result = buildSuccessResponse(automationId, automation.type);
      return NextResponse.json({ data: result });
    } catch (err) {
      logger.error("[automations run POST]", err, { traceId: session.traceId });
      return NextResponse.json(
        {
          error: {
            ...buildErrorResponse("INTERNAL_ERROR", "Failed to trigger automation"),
            traceId: session.traceId,
          },
        },
        { status: 500 }
      );
    }
  }
);
