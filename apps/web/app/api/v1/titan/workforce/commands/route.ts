import { NextResponse } from "next/server";
import { TITAN_BUSINESS_OPS_AGENT_COMMANDS } from "@titan-zero/titan-platform/business-ops";
import { getSession } from "@/lib/auth/session";
import {
  buildWorkforceCommandPlan,
  executeWorkforceCommand,
  type WorkforceCommandRequest,
} from "@/lib/titan/workforce-command-gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  const commands = TITAN_BUSINESS_OPS_AGENT_COMMANDS
    .filter((command) => command.allowedRoles.includes(session.role))
    .map((command) => ({
      ...command,
      companyBoundary: session.accountId,
      browserExtensionRequired: false,
    }));
  return NextResponse.json({
    data: commands,
    count: commands.length,
    executionEndpoint: "/api/v1/titan/workforce/commands",
    authority: "native-business-ops-routes",
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });

  let input: WorkforceCommandRequest;
  try {
    input = (await request.json()) as WorkforceCommandRequest;
    if (!input || typeof input.commandId !== "string") throw new Error("commandId is required");
    // Build the plan before execution to fail closed on command/role/id validation.
    buildWorkforceCommandPlan(session, input);
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "ROLE_NOT_AUTHORIZED";
    return NextResponse.json(
      { error: { code: forbidden ? "FORBIDDEN" : "INVALID_COMMAND", message: error instanceof Error ? error.message : "Invalid command" } },
      { status: forbidden ? 403 : 400 },
    );
  }

  try {
    const result = await executeWorkforceCommand(request, session, input);
    if (!result.dryRun && result.upstream && !result.upstream.ok) {
      return NextResponse.json(result, { status: result.upstream.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: { code: "COMMAND_EXECUTION_FAILED", message: error instanceof Error ? error.message : "Command execution failed" } },
      { status: 500 },
    );
  }
}
