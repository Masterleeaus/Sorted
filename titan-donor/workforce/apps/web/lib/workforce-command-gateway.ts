import type { SessionPayload } from "@/lib/auth/session";
import {
  assessTitanBusinessOpsAgentCommand,
  getTitanBusinessOpsAgentCommand,
  materializeTitanBusinessOpsPath,
  routeTitanBusinessOpsAgent,
  type TitanBusinessOpsAgentCommandId,
} from "@titan-zero/titan-platform/business-ops";

export type WorkforceCommandRequest = {
  commandId: TitanBusinessOpsAgentCommandId;
  entityId?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  dryRun?: boolean;
};

export function buildWorkforceCommandPlan(session: SessionPayload, input: WorkforceCommandRequest) {
  const command = getTitanBusinessOpsAgentCommand(input.commandId);
  if (!command) throw new Error("Unknown Titan workforce command");
  if (!command.allowedRoles.includes(session.role)) throw new Error("ROLE_NOT_AUTHORIZED");

  const path = materializeTitanBusinessOpsPath(command.path, input.entityId);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== null && value !== undefined) search.set(key, String(value));
  }
  const href = search.size ? `${path}?${search.toString()}` : path;
  const risk = assessTitanBusinessOpsAgentCommand({
    companyId: session.accountId,
    commandId: input.commandId,
    entityId: input.entityId,
  });
  const workforce = routeTitanBusinessOpsAgent(input.commandId);

  return {
    command,
    href,
    risk,
    workforce,
    enforcement: {
      companyBoundary: session.accountId,
      actorId: session.userId,
      actorRole: session.role,
      // Compatibility only: the legacy route is transport, never Titan execution authority.
      businessOpsRouteRemainsAuthoritative: false,
      compatibilityTransport: "legacy_internal_api_route",
      canonicalAuthority: "hosted_workforce_effective_authority_execution_gateway",
      browserExtensionRequired: false,
    },
  } as const;
}

/**
 * Compatibility transport for legacy business routes.
 *
 * This function MUST NOT be treated as the canonical Workforce/execution authority.
 * New consumers should dispatch through the hosted Workforce + effective-authority +
 * ExecutionGateway path. HTTP success from the legacy route is provider/transport
 * acknowledgement only and is not a VERIFIED Titan business outcome.
 */
export async function executeWorkforceCommand(
  request: Request,
  session: SessionPayload,
  input: WorkforceCommandRequest,
) {
  const plan = buildWorkforceCommandPlan(session, input);
  if (input.dryRun) return { dryRun: true, plan };

  const source = new URL(request.url);
  const target = new URL(plan.href, source.origin);
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  headers.set("accept", "application/json");
  headers.set("x-titan-workforce-command", plan.command.id);
  headers.set("x-titan-company-id", session.accountId);
  if (plan.command.method !== "GET") headers.set("content-type", "application/json");

  const response = await fetch(target, {
    method: plan.command.method,
    headers,
    body: plan.command.method === "GET" ? undefined : JSON.stringify(input.body ?? {}),
    cache: "no-store",
    redirect: "manual",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  return {
    dryRun: false,
    plan,
    upstream: {
      status: response.status,
      ok: response.ok,
      result,
    },
  };
}
