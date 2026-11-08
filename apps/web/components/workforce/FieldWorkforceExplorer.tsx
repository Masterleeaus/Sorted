"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FIELD_SPECIALISTS,
  FIELD_WORKFORCE_GROUPS,
  type FieldSpecialistDefinition,
  type FieldWorkforceGroup,
  type FieldWorkforceGroupId,
} from "@/lib/titan-go/field-workforce";

export type FieldRuntimeStatus = Readonly<{
  agentKey: string;
  specialistId: string;
  specialistName: string;
  lifecycleState: string;
  healthState: string;
  assignmentReady: boolean;
  statusReasons: readonly string[];
}>;

export type HumanFieldWorker = Readonly<{
  id: string;
  name: string;
  email: string;
  phone: string | null;
}>;

type View = "structure" | "people" | "runtime";
type GroupFilter = "all" | FieldWorkforceGroupId;

export function FieldWorkforceExplorer({
  runtime,
  humans,
}: {
  runtime: readonly FieldRuntimeStatus[];
  humans: readonly HumanFieldWorker[];
}) {
  const [view, setView] = useState<View>("structure");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("dispatch");
  const [openPortfolios, setOpenPortfolios] = useState<Set<FieldWorkforceGroupId>>(
    () => new Set<FieldWorkforceGroupId>(["operations"]),
  );

  const runtimeBySpecialist = useMemo(
    () => new Map(runtime.map((item) => [item.specialistId, item] as const)),
    [runtime],
  );

  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    return FIELD_WORKFORCE_GROUPS
      .filter((entry) => group === "all" || entry.id === group)
      .map((entry) => ({
        ...entry,
        specialists: entry.specialists.filter((specialist) => {
          if (!normalizedQuery) return true;
          return [
            specialist.name,
            specialist.purpose,
            ...specialist.workers.flatMap((worker) => [worker.name, worker.purpose]),
          ].some((value) => value.toLowerCase().includes(normalizedQuery));
        }),
      }))
      .filter((entry) => entry.specialists.length > 0);
  }, [group, normalizedQuery]);

  const selectedSpecialist = useMemo(
    () => FIELD_SPECIALISTS.find((entry) => entry.id === selectedId) ?? FIELD_SPECIALISTS[0],
    [selectedId],
  );

  const selectedPortfolio = useMemo(
    () => FIELD_WORKFORCE_GROUPS.find((entry) => entry.id === selectedSpecialist?.group) ?? null,
    [selectedSpecialist],
  );

  useEffect(() => {
    if (!normalizedQuery) return;
    setOpenPortfolios(new Set(filteredGroups.map((entry) => entry.id)));
    if (!filteredGroups.some((entry) => entry.specialists.some((specialist) => specialist.id === selectedId))) {
      const first = filteredGroups[0]?.specialists[0];
      if (first) setSelectedId(first.id);
    }
  }, [filteredGroups, normalizedQuery, selectedId]);

  function togglePortfolio(id: FieldWorkforceGroupId) {
    setOpenPortfolios((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="tg-workforce-explorer">
      <div className="tg-workforce-tabs" role="tablist" aria-label="Workforce views">
        <Tab active={view === "structure"} onClick={() => setView("structure")} label="Structure" meta="Manager → Specialist → Worker" />
        <Tab active={view === "people"} onClick={() => setView("people")} label="Field team" meta={`${humans.length} people`} />
        <Tab active={view === "runtime"} onClick={() => setView("runtime")} label="Live runtime" meta={`${runtime.length} connected Specialists`} />
      </div>

      {view === "structure" ? (
        <>
          <div className="tg-workforce-tools">
            <div className="tg-workforce-group-filter" role="group" aria-label="Filter workforce portfolios">
              <FilterButton active={group === "all"} onClick={() => setGroup("all")}>All portfolios</FilterButton>
              {FIELD_WORKFORCE_GROUPS.map((entry) => (
                <FilterButton key={entry.id} active={group === entry.id} onClick={() => setGroup(entry.id)}>
                  {shortGroupName(entry.name)}
                </FilterButton>
              ))}
            </div>
            <label className="tg-workforce-search">
              <span className="sr-only">Search Field workforce</span>
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a Specialist or Worker…"
              />
            </label>
          </div>

          {filteredGroups.length === 0 ? (
            <div className="tg-empty-state"><strong>No Field workforce match.</strong><span>Try another search or portfolio filter.</span></div>
          ) : (
            <div className="tg-workforce-structure">
              <div className="tg-workforce-portfolio-list">
                {filteredGroups.map((entry) => {
                  const isOpen = normalizedQuery ? true : openPortfolios.has(entry.id);
                  const lead = entry.specialists.find((specialist) => specialist.id === entry.leadSpecialistId);
                  const workerCount = entry.specialists.reduce((total, specialist) => total + specialist.workers.length, 0);
                  return (
                    <section key={entry.id} className={`tg-workforce-portfolio ${isOpen ? "is-open" : ""}`}>
                      <button
                        type="button"
                        className="tg-workforce-portfolio__head"
                        aria-expanded={isOpen}
                        onClick={() => togglePortfolio(entry.id)}
                      >
                        <div className="tg-workforce-portfolio__identity">
                          <span className="tg-portfolio-mark" aria-hidden="true">{portfolioMark(entry.id)}</span>
                          <span>
                            <span className="tg-kicker">OPERATIONAL PORTFOLIO</span>
                            <strong>{entry.name}</strong>
                            <small>{entry.outcome}</small>
                          </span>
                        </div>
                        <div className="tg-workforce-portfolio__meta">
                          {lead ? <span className="tg-lead-chip">Lead: {lead.name.replace(/ Specialist$/, "")}</span> : null}
                          <span>{entry.specialists.length} Specialists · {workerCount} Workers</span>
                          <b aria-hidden="true">⌄</b>
                        </div>
                      </button>

                      {isOpen ? (
                        <div className="tg-specialist-list">
                          {entry.specialists.map((specialist) => (
                            <SpecialistRow
                              key={specialist.id}
                              specialist={specialist}
                              runtime={runtimeBySpecialist.get(specialist.id)}
                              selected={selectedSpecialist?.id === specialist.id}
                              lead={entry.leadSpecialistId === specialist.id}
                              onSelect={() => setSelectedId(specialist.id)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>

              {selectedSpecialist && selectedPortfolio ? (
                <SpecialistDetail
                  specialist={selectedSpecialist}
                  portfolio={selectedPortfolio}
                  runtime={runtimeBySpecialist.get(selectedSpecialist.id)}
                  isLead={selectedPortfolio.leadSpecialistId === selectedSpecialist.id}
                />
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {view === "people" ? (
        <section className="tg-people-panel">
          <div className="tg-section-heading">
            <div><span className="tg-kicker">HUMAN FIELD TEAM</span><h2>People delivering the work</h2><p>Human workers sit alongside the digital workforce but keep their own identity, permissions and employment role.</p></div>
            <span className="tg-workforce-group__count">{humans.length} team members</span>
          </div>
          {humans.length ? (
            <div className="tg-people-grid">
              {humans.map((person) => (
                <article key={person.id} className="tg-person-card">
                  <div className="tg-person-avatar">{initials(person.name)}</div>
                  <div><strong>{person.name}</strong><span>{person.email}</span>{person.phone ? <small>{person.phone}</small> : null}</div>
                  <span className="tg-status-pill tg-status-pill--human">Field worker</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="tg-empty-state"><strong>No field workers yet.</strong><span>Add technician/team accounts in Settings → Team.</span></div>
          )}
        </section>
      ) : null}

      {view === "runtime" ? (
        <section className="tg-runtime-panel">
          <div className="tg-runtime-callout">
            <span className="tg-kicker">FIELD RUNTIME ONLY</span>
            <h2>Only Field-owned Specialist runtimes appear here.</h2>
            <p>
              Build, Desk and Pay runtimes are deliberately excluded. Runtime identity shows health and lifecycle only; it never grants execution authority.
            </p>
          </div>
          <div className="tg-runtime-grid">
            {runtime.map((item) => (
              <article key={item.agentKey} className="tg-runtime-card">
                <div className="tg-runtime-card__top">
                  <div><span className="tg-kicker">RUNTIME · {item.agentKey}</span><h3>{item.specialistName}</h3></div>
                  <span className={`tg-status-pill ${item.assignmentReady ? "tg-status-pill--ready" : ""}`}>
                    {item.assignmentReady ? "Assignment-ready" : item.lifecycleState}
                  </span>
                </div>
                <div className="tg-runtime-meta">
                  <span><b>Lifecycle</b>{item.lifecycleState}</span>
                  <span><b>Health</b>{item.healthState}</span>
                </div>
                {item.statusReasons.length ? <p>{item.statusReasons.join(" · ")}</p> : <p>Healthy runtime projection. Execution still requires capability-specific authority.</p>}
              </article>
            ))}
            {runtime.length === 0 ? <div className="tg-empty-state"><strong>No Field Specialist runtimes connected.</strong><span>The product structure remains available while runtime connections are configured.</span></div> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Tab({ active, onClick, label, meta }: { active: boolean; onClick: () => void; label: string; meta: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? "is-active" : ""} onClick={onClick}>
      <strong>{label}</strong><span>{meta}</span>
    </button>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={active ? "is-active" : ""} onClick={onClick}>{children}</button>;
}

function SpecialistRow({
  specialist,
  runtime,
  selected,
  lead,
  onSelect,
}: {
  specialist: FieldSpecialistDefinition;
  runtime?: FieldRuntimeStatus;
  selected: boolean;
  lead: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`tg-specialist-row ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <span className="tg-specialist-mark">{specialistInitial(specialist.name)}</span>
      <span className="tg-specialist-row__copy">
        <span className="tg-specialist-row__title">
          <strong>{specialist.name}</strong>
          {lead ? <em>Lead Specialist</em> : null}
        </span>
        <small>{specialist.purpose}</small>
      </span>
      <span className="tg-specialist-row__meta">
        {runtime ? <span className={`tg-status-pill ${runtime.assignmentReady ? "tg-status-pill--ready" : ""}`}>{runtime.assignmentReady ? "Live" : runtime.lifecycleState}</span> : null}
        <b>{specialist.workers.length}</b><small>Workers</small>
      </span>
    </button>
  );
}

function SpecialistDetail({
  specialist,
  portfolio,
  runtime,
  isLead,
}: {
  specialist: FieldSpecialistDefinition;
  portfolio: FieldWorkforceGroup;
  runtime?: FieldRuntimeStatus;
  isLead: boolean;
}) {
  return (
    <aside className="tg-specialist-detail" aria-label={`${specialist.name} details`}>
      <div className="tg-specialist-detail__head">
        <span className="tg-specialist-detail__mark">{specialistInitial(specialist.name)}</span>
        <div>
          <span className="tg-kicker">{portfolio.name}</span>
          <h2>{specialist.name}</h2>
          <p>{specialist.purpose}</p>
        </div>
      </div>

      <div className="tg-specialist-detail__badges">
        {isLead ? <span className="tg-lead-chip">Lead Specialist</span> : <span className="tg-status-pill">Specialist</span>}
        {runtime ? <span className={`tg-status-pill ${runtime.assignmentReady ? "tg-status-pill--ready" : ""}`}>{runtime.assignmentReady ? "Runtime live" : runtime.lifecycleState}</span> : <span className="tg-status-pill">Catalogue</span>}
      </div>

      <div className="tg-specialist-detail__section">
        <div className="tg-specialist-detail__label">Workers</div>
        <div className="tg-detail-worker-list">
          {specialist.workers.map((worker) => (
            <div key={worker.name} className="tg-detail-worker">
              <span className="tg-worker-dot" aria-hidden="true" />
              <div><strong>{worker.name}</strong><small>{worker.purpose}</small></div>
              <span>Worker</span>
            </div>
          ))}
        </div>
      </div>

      <div className="tg-specialist-detail__section tg-specialist-detail__authority">
        <div className="tg-specialist-detail__label">Authority</div>
        <strong>Governed, not inherited.</strong>
        <p>Manager, Lead Specialist, Specialist and Worker identity never grants execution rights. Actions still pass capability-specific authority checks.</p>
      </div>
    </aside>
  );
}

function shortGroupName(name: string) {
  if (name.startsWith("Operations")) return "Operations";
  if (name.startsWith("Quality")) return "Quality";
  if (name.startsWith("Assets")) return "Assets";
  if (name.startsWith("Standards")) return "Standards";
  return "Intelligence";
}

function portfolioMark(id: FieldWorkforceGroupId) {
  return ({ operations: "OP", quality: "QE", assets: "AS", standards: "ST", insight: "IN" } as const)[id];
}

function specialistInitial(name: string) {
  return name.replace(/ Specialist$/, "").slice(0, 1).toUpperCase();
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}
