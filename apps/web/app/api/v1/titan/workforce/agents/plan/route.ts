import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  TITAN_BUSINESS_OPS_AGENT_COMMANDS,
  routeTitanBusinessOpsAgent,
  type TitanBusinessOpsAgentCommandId,
} from "@titan-zero/titan-platform/business-ops";

export const dynamic = "force-dynamic";

type SupportedAgentKey = "dispatch" | "invoicing" | "rebooking" | "quote" | "crm";
const SUPPORTED = new Set<SupportedAgentKey>(["dispatch", "invoicing", "rebooking", "quote", "crm"]);

const AGENT_DOMAINS: Record<SupportedAgentKey, readonly string[]> = {
  dispatch: ["dispatch", "field", "projects"],
  invoicing: ["invoicing"],
  rebooking: ["dispatch", "projects", "intake"],
  quote: ["estimating", "crm"],
  crm: ["crm", "intake"],
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });

  try {
    const raw = (await request.json()) as { agentKey?: string; payload?: Record<string, unknown> };
    const agentKey = String(raw?.agentKey ?? "").trim().toLowerCase() as SupportedAgentKey;
    if (!SUPPORTED.has(agentKey)) {
      return NextResponse.json({ error: { code: "UNSUPPORTED_NATIVE_AGENT" } }, { status: 400 });
    }

    const domains = AGENT_DOMAINS[agentKey];
    const commands = TITAN_BUSINESS_OPS_AGENT_COMMANDS
      .filter((command) => domains.includes(command.domain) && command.allowedRoles.includes(session.role))
      .map((command) => ({
        ...command,
        workforce: routeTitanBusinessOpsAgent(command.id as TitanBusinessOpsAgentCommandId),
      }));

    return NextResponse.json({
      data: {
        agentKey,
        payload: raw.payload ?? {},
        commands,
      },
      agent: {
        key: agentKey,
        domains,
        commandCount: commands.length,
      },
      companyBoundary: session.accountId,
      commandExecutionEndpoint: "/api/v1/titan/workforce/commands",
      authority: "native-business-ops-routes",
      browserExtensionRequired: false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "AGENT_PLAN_FAILED", message: error instanceof Error ? error.message : "Agent planning failed" } },
      { status: 400 },
    );
  }
}
