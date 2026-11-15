import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Standards",
  description: "Review operational standards in Sorted Field.",
};

import { redirect } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import { Card, PageContainer, PageHeader } from "@/components/ui";
import {
  CLOSING_CHECKLIST_TEMPLATES,
  DEFAULT_CHECKLIST_TEMPLATE,
} from "@/lib/visits/checklist";

export const dynamic = "force-dynamic";

const CONTROL_AREAS = [
  {
    key: "sop",
    title: "SOPs & Service Standards",
    owner: "Standards Specialist",
    copy: "Work instructions, service standards and completion requirements travel with the work.",
    state: "Included",
  },
  {
    key: "safety",
    title: "Safety & Incidents",
    owner: "Safety Specialist",
    copy: "WHS/OHS controls, field hazards, incident evidence and safe-work expectations.",
    state: "Governed",
  },
  {
    key: "compliance",
    title: "Compliance & Expiry",
    owner: "Compliance Specialist",
    copy: "Licences, insurance, certifications and expiry-sensitive operating requirements.",
    state: "Tracked",
  },
  {
    key: "training",
    title: "Training & Competency",
    owner: "Training Specialist",
    copy: "Competency expectations, refresher requirements and readiness for assigned work.",
    state: "Field-linked",
  },
  {
    key: "audit",
    title: "Audit & Improvement",
    owner: "Audit + Improvement Specialists",
    copy: "Job, safety and operational audits feed corrective action and continuous improvement.",
    state: "Evidence-led",
  },
] as const;

export default async function StandardsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "tech") redirect("/app/my-work");

  const sections = [...new Set(DEFAULT_CHECKLIST_TEMPLATE.map((item) => item.section))];
  const tradeTemplates = Object.entries(CLOSING_CHECKLIST_TEMPLATES)
    .filter(([key]) => key !== "_default")
    .map(([key, items]) => ({ key, count: items.length }));

  return (
    <PageContainer>
      <PageHeader
        title="Titan Standards"
        subtitle="Included with Field — the operating system for safe, repeatable and evidence-backed service delivery"
        actions={<Link href={"/app/workforce" as Route} className="tz-secondary-link">Open Standards workforce →</Link>}
      />

      <section className="tg-standards-hero">
        <div>
          <span className="tg-kicker">PERMANENTLY INCLUDED WITH FIELD</span>
          <h2>Standards are part of execution, not a separate add-on.</h2>
          <p>
            Titan carries the applicable SOP, evidence, quality and safety expectations into the job path so completion can be proved rather than merely marked done.
          </p>
        </div>
        <div className="tg-standards-hero__signal">
          <strong>FIELD</strong>
          <span>Plan → execute → prove → quality → complete</span>
        </div>
      </section>

      <div className="tz-standard-stats tg-standard-stat-grid">
        <Card padding="default"><span>Baseline checks</span><strong>{DEFAULT_CHECKLIST_TEMPLATE.length}</strong><small>{sections.length} execution sections</small></Card>
        <Card padding="default"><span>Trade templates</span><strong>{tradeTemplates.length}</strong><small>Closeout standards configured</small></Card>
        <Card padding="default"><span>Control areas</span><strong>{CONTROL_AREAS.length}</strong><small>One Standards system</small></Card>
        <Card padding="default"><span>Completion model</span><strong>Gated</strong><small>Evidence before completion</small></Card>
      </div>

      <section className="tg-standards-control-grid" aria-label="Titan Standards control areas">
        {CONTROL_AREAS.map((area, index) => (
          <article key={area.key} className="tg-standard-control-card">
            <div className="tg-standard-control-card__top">
              <span className="tg-standard-control-card__number">0{index + 1}</span>
              <span className="tg-status-pill">{area.state}</span>
            </div>
            <h3>{area.title}</h3>
            <p>{area.copy}</p>
            <small>{area.owner}</small>
          </article>
        ))}
      </section>

      <section className="tz-standards-grid tg-standards-execution-grid">
        <Card padding="default">
          <span className="tz-eyebrow">BASELINE EXECUTION STANDARD</span>
          <h2>Field inspection checklist</h2>
          <p className="tz-muted-copy">The baseline checklist follows every applicable Field execution path.</p>
          <div className="tz-standard-sections">
            {sections.map((section) => {
              const count = DEFAULT_CHECKLIST_TEMPLATE.filter((item) => item.section === section).length;
              return <div key={section}><strong>{section}</strong><span>{count} checks</span></div>;
            })}
          </div>
        </Card>

        <Card padding="default">
          <span className="tz-eyebrow">SERVICE-SPECIFIC CLOSEOUT</span>
          <h2>Trade completion controls</h2>
          <p className="tz-muted-copy">Service templates extend the baseline without weakening its evidence gates.</p>
          <div className="tz-standard-sections">
            {tradeTemplates.map(({ key, count }) => (
              <div key={key}>
                <strong>{key.replaceAll("_", " ")}</strong>
                <span>{count} requirements</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <div className="tg-governance-strip">
        <strong>Standards guide work; authority still stays governed.</strong>
        <span>Requirements, predictions and audit findings can trigger review or authorised action, but they never grant execution authority on their own.</span>
      </div>
    </PageContainer>
  );
}
