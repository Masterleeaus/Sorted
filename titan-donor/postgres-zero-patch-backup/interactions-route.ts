import { NextRequest, NextResponse } from "next/server";
import { createZeroInteraction } from "@titan-zero/titan-platform/runtime";
import { getSession } from "@/lib/auth/session";
import { dispatchZeroRuntime } from "@/lib/zero/runtime-dispatch";

export const dynamic = "force-dynamic";

type Body = {
  company_id?: string;
  conversation_id?: string;
  surface?: string;
  text?: string;
  client_message_id?: string;
  requested_agent_id?: string;
  continuation_token?: string;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Tenant scope is server-owned. `company_id` in the request body is accepted
  // only as a legacy compatibility assertion and is never used as authority.
  const company_id = session.accountId;
  const requested_company_id = String(body.company_id ?? "").trim();
  const conversation_id = String(body.conversation_id ?? "").trim();
  const text = String(body.text ?? "").trim();
  const client_message_id = String(body.client_message_id ?? "").trim();
  const requested_agent_id = String(body.requested_agent_id ?? "").trim() || undefined;
  const continuation_token = String(body.continuation_token ?? "").trim() || undefined;

  if (!conversation_id || !text || !client_message_id) {
    return NextResponse.json({ error: "Missing required interaction fields" }, { status: 400 });
  }
  if (body.surface !== "zero") {
    return NextResponse.json({ error: "Zero surface required" }, { status: 400 });
  }
  if (requested_company_id && requested_company_id !== company_id) {
    return NextResponse.json({ error: "Cross-company interaction rejected" }, { status: 403 });
  }

  try {
    createZeroInteraction({
      company_id,
      surface: "zero",
      interaction_id: client_message_id,
      conversation_id,
      modality: "text",
      text,
      context_refs: [],
      referent_refs: [],
    });

    const result = await dispatchZeroRuntime({
      company_id,
      actor_id: session.userId,
      conversation_id,
      interaction_id: client_message_id,
      client_message_id,
      text,
      correlation_id: client_message_id,
      requested_agent_id,
      continuation_token,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (error instanceof Error && ["zero-workforce-manager-unavailable", "zero-requested-agent-unavailable"].includes(error.message)) {
      return NextResponse.json({ error: "No eligible Workforce agent is available", code: "ZERO_WORKER_UNAVAILABLE" }, { status: 503 });
    }
    if (code === "ZERO_RUNTIME_UNAVAILABLE") {
      return NextResponse.json({ error: "Zero runtime is not available", code }, { status: 503 });
    }
    return NextResponse.json({ error: "Zero interaction rejected" }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const work_id = req.nextUrl.searchParams.get("work_id");
  if (!work_id) return NextResponse.json({ error: "work_id required" }, { status: 400 });
  try {
    const { getProductionZeroRuntime } = await import("@/lib/zero/production-runtime");
    const view = await (await getProductionZeroRuntime()).project({ company_id: session.accountId, actor_id: session.userId, work_id });
    return view ? NextResponse.json(view, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Zero runtime is not available", code: "ZERO_RUNTIME_UNAVAILABLE" }, { status: 503 });
  }
}
