import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workforce",
  description: "Review field teams and workforce activity in Sorted Field.",
};

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { queryForSession } from "@/lib/db";
import { PageContainer, PageHeader, Card } from "@/components/ui";
import { FieldWorkforceExplorer, type FieldRuntimeStatus, type HumanFieldWorker } from "@/components/workforce/FieldWorkforceExplorer";
import { FIELD_RUNTIME_AGENT_KEYS, fieldWorkforceCounts } from "@/lib/titan-go/field-workforce";
import { loadWorkforceLifecycleInspection } from "../settings/workforce-lifecycle-data";

export const dynamic = "force-dynamic";

type HumanWorkerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
};

const RUNTIME_SPECIALIST: Readonly<Record<string, { id: string; name: string }>> = Object.freeze({
  scheduling: { id: "scheduling", name: "Scheduling Specialist" },
  dispatch: { id: "dispatch", name: "Dispatch Specialist" },
  jobs: { id: "jobs", name: "Job Specialist" },
});

export default async function WorkforcePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "admin") redirect("/app");

  const [lifecycle, people] = await Promise.all([
    Promise.resolve(loadWorkforceLifecycleInspection(session.accountId)),
    queryForSession<HumanWorkerRow>(
      session,
      `SELECT id, full_name, email, phone
         FROM users
        WHERE account_id = $1 AND role = 'tech'
        ORDER BY full_name`,
      [session.accountId],
    ),
  ]);

  const counts = fieldWorkforceCounts();
  const runtimeKeys = new Set<string>(FIELD_RUNTIME_AGENT_KEYS);
  const runtime: FieldRuntimeStatus[] = lifecycle.filter((item) => runtimeKeys.has(item.agent_key)).map((item) => {
    const product = RUNTIME_SPECIALIST[item.agent_key] ?? { id: item.agent_key, name: item.agent_key };
    return {
      agentKey: item.agent_key,
      specialistId: product.id,
      specialistName: product.name,
      lifecycleState: item.lifecycle_state,
      healthState: item.health_state,
      assignmentReady: item.accepts_new_assignments,
      statusReasons: item.status_reasons,
    };
  });

  const humans: HumanFieldWorker[] = people.map((person) => ({
    id: person.id,
    name: person.full_name,
    email: person.email,
    phone: person.phone,
  }));

  const runtimeReady = runtime.filter((item) => item.assignmentReady).length;

  return (
    <PageContainer>
      <PageHeader
        title="Workforce"
        subtitle="One Operations Manager, five operational portfolios, Field Specialists, bounded Workers and your human team."
      />

      <section className="tg-workforce-hero">
        <div className="tg-workforce-manager-card">
          <div className="tg-workforce-manager-mark" aria-hidden="true">OM</div>
          <div>
            <span className="tg-kicker">FIELD WORKFORCE</span>
            <h1>Operations Manager</h1>
            <p>
              Owns Field outcomes across delivery, quality, assets, standards and operations intelligence. Portfolios organise the work; they do not add another management tier.
            </p>
          </div>
          <div className="tg-workforce-manager-state">
            <span className="tg-status-pill tg-status-pill--ready">Field mode</span>
            <small>1 Manager · {counts.portfolios} portfolios · Manager → Specialist → Worker</small>
          </div>
        </div>

        <div className="tg-workforce-summary-grid">
          <Card padding="default"><span>Specialists</span><strong>{counts.specialists}</strong><small>Across {counts.portfolios} portfolios</small></Card>
          <Card padding="default"><span>Workers</span><strong>{counts.workers}</strong><small>Bounded execution roles</small></Card>
          <Card padding="default"><span>Field team</span><strong>{humans.length}</strong><small>Human technicians</small></Card>
          <Card padding="default"><span>Runtime</span><strong>{runtimeReady}/{runtime.length}</strong><small>Assignment-ready</small></Card>
        </div>
      </section>

      <FieldWorkforceExplorer runtime={runtime} humans={humans} />

      <div className="tg-governance-strip">
        <strong>Governance stays separate from identity.</strong>
        <span>Prediction, hierarchy and runtime status never grant authority. Every executable action still passes capability-specific authority controls.</span>
      </div>
    </PageContainer>
  );
}
