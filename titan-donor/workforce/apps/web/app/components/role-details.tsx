"use client";

import { useState } from "react";
import Image from "next/image";
import { AlertTriangle, CalendarDays, Camera, Check, ChevronRight, Clock3, MapPin, MessageSquare, Navigation, PackageCheck, Route, ShieldCheck, Sparkles, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { TitanRole } from "./role-chat";
import {
  applyGoReceipt,
  createGoFieldSession,
  prepareGoIssue,
  prepareGoTransition,
  revalidateGoQueue,
} from "../runtime/go-field-runtime.mjs";
import type { GoFieldSession, GoQueueItem, GoTransition } from "../runtime/go-field-runtime.mjs";
import { analyseGoSchedule, prepareScheduleRecovery } from "../runtime/go-schedule-intelligence.mjs";

const fieldJobs = [
  { job_id: "job_2048", time: "9:00", customer: "Hartwell Dental", service: "Morning clinic clean", address: "18 Hartwell Rd", status: "Next", duration: "1h 30m", team: "Alex + Mia", tasks: "3 tasks", riskTitle: "All checks ready", riskDetail: "Access, equipment and route verified.", recoveryAction: "navigate" as const },
  { job_id: "job_2091", time: "11:15", customer: "North Street Realty", service: "End-of-lease inspection", address: "44 North St", status: "Prep", duration: "1h 20m", team: "Alex", tasks: "8 areas", riskTitle: "Spot cleaner missing", riskDetail: "Collect from Van 02 before leaving Westbridge.", recoveryAction: "stage_supply" as const },
  { job_id: "job_2117", time: "2:00", customer: "Juniper Offices", service: "Weekly office clean", address: "7 Juniper Lane", status: "At risk", duration: "2h 30m", team: "Alex + Mia", tasks: "6 tasks", riskTitle: "Access not confirmed", riskDetail: "Key pickup is unacknowledged · limited parking may add 8 min.", recoveryAction: "verify_access" as const },
];

const goScheduleAnalysis = analyseGoSchedule({
  company_id: "demo_001",
  actor_id: "worker_alex",
  device_id: "go_device_01",
  projection_revision: "go-schedule-rev-5",
  now_minutes: 8 * 60 + 12,
  jobs: [
    { job_id: "job_2048", start_minutes: 9 * 60, duration_minutes: 90, travel_minutes: 12, access: "confirmed", supplies: "ready", parking: "known" },
    { job_id: "job_2091", start_minutes: 11 * 60 + 15, duration_minutes: 80, travel_minutes: 14, access: "confirmed", supplies: "missing_item", parking: "known" },
    { job_id: "job_2117", start_minutes: 14 * 60, duration_minutes: 150, travel_minutes: 24, access: "unconfirmed", supplies: "ready", parking: "limited" },
  ],
});

function GoDetails() {
  const [notice, setNotice] = useState("Zero found two risks early enough to fix.");
  const [preparedJob, setPreparedJob] = useState<string | null>(null);

  function prepareRecovery(job_id: string, action: "notify_dispatch" | "prepare_customer_eta" | "verify_access" | "stage_supply", note: string) {
    const result = prepareScheduleRecovery(goScheduleAnalysis, { job_id, action, note });
    setPreparedJob(job_id);
    setNotice(result.status === "awaiting_receipt" ? "Recovery prepared. Dispatch receipt is still required." : "Recovery queued offline for revalidation.");
  }

  return <div className="role-detail-layout">
    <section className="role-list-panel">
      <header><div><p className="eyeline">Titan Go</p><h2>Today</h2><span>3 jobs · 5h 20m scheduled · 42 km route</span></div><Button><Navigation />Navigate</Button></header>
      <section className="schedule-intelligence" aria-live="polite"><Sparkles/><span><strong>Day risk forecast</strong><small>{notice}</small></span><b>{goScheduleAnalysis.summary.jobs_needing_preparation} need prep</b></section>
      <div className="field-route">{fieldJobs.length ? fieldJobs.map((job, index) => {
        const forecast = goScheduleAnalysis.jobs.find(({ job_id }) => job_id === job.job_id);
        return <article className={`field-stop field-card tone-${index % 3} risk-${forecast?.risk_level ?? "clear"}`} key={job.customer}>
          <time>{job.time}</time><i/>
          <span className="field-job-copy"><strong>{job.customer}</strong><small>{job.service}</small><small className="job-address"><MapPin />{job.address}</small><span className="field-job-meta"><b>{job.duration}</b><b>{job.team}</b><b>{job.tasks}</b></span><span className="job-risk-detail"><AlertTriangle/><span><strong>{job.riskTitle}</strong><small>{job.riskDetail}</small></span></span></span>
          <em>{preparedJob === job.job_id ? "Prepared" : job.status}</em><ChevronRight />
          <div className="schedule-recovery-actions">
            {job.recoveryAction === "navigate" ? <Button aria-label="Travel to next job"><Navigation/>Navigate</Button> : null}
            {job.recoveryAction === "stage_supply" ? <Button onClick={() => prepareRecovery(job.job_id, "stage_supply", "Stage spot cleaner before departure.")}><PackageCheck/>Stage supply</Button> : null}
            {job.recoveryAction === "verify_access" ? <Button onClick={() => prepareRecovery(job.job_id, "verify_access", "Verify key pickup and parking before departure.")}><ShieldCheck/>Verify access</Button> : null}
            {job.recoveryAction !== "navigate" ? <Button variant="secondary" onClick={() => prepareRecovery(job.job_id, "prepare_customer_eta", "Prepare an accurate arrival update from the latest route projection.")}><Clock3/>Prepare customer ETA</Button> : null}
            {job.recoveryAction === "verify_access" ? <Button variant="secondary" onClick={() => prepareRecovery(job.job_id, "notify_dispatch", "Key pickup is not confirmed; verify before departure.")}><MessageSquare/>Notify dispatch</Button> : null}
          </div>
        </article>;
      }) : <div className="field-empty-state"><CalendarDays/><strong>No jobs scheduled for today</strong><span>Message dispatch if you expect work.</span><Button>Message dispatch</Button></div>}</div>
    </section>
    <aside className="today-summary"><p className="eyeline">Day summary</p><h3>Recoverable</h3><span><strong>First arrival</strong> 9:00 AM · on time</span><span><strong>Preparation needed</strong> 2 jobs · {goScheduleAnalysis.summary.recoverable_minutes} min protected</span><span><strong>Total travel</strong> 42 km · 48 min</span><span><strong>Lunch gap</strong> 12:35–2:00 PM</span><span><strong>Expected finish</strong> Near 4:30 PM</span><div className="schedule-authority-note"><ShieldCheck/><span><strong>No schedule change without a receipt</strong><small>Zero prepares recovery. Dispatch or the server accepts the final change.</small></span></div></aside>
  </div>;
}

export function GoNext() {
  const [session, setSession] = useState<GoFieldSession>(() => createGoFieldSession({
    company_id: "demo_001",
    actor_id: "worker_alex",
    device_id: "go_device_01",
    job_id: "job_2048",
    projection_revision: "go-rev-4",
    route_ready: true,
    equipment_ready: true,
    access_status: "confirmed",
    checklist: [true, false, false],
    evidence_count: 0,
    required_evidence_count: 2,
  }));
  const [online, setOnline] = useState(true);
  const [view, setView] = useState<"details" | "route">("details");
  const [queue, setQueue] = useState<GoQueueItem[]>([]);
  const [notice, setNotice] = useState("Access, route and equipment are ready.");
  const [blockers, setBlockers] = useState<{ code: string; message: string; recovery: string }[]>([]);

  const stages = ["travel", "arrived", "work", "complete"] as const;
  const stageLabels = ["Travel", "Arrive", "Work", "Complete"];
  const currentIndex = Math.max(0, stages.indexOf(session.stage as (typeof stages)[number]));
  const nextAction: Record<string, { action: GoTransition; label: string }> = {
    ready: { action: "travel", label: "Travel" },
    travel: { action: "arrive", label: "Arrive" },
    arrived: { action: "start", label: "Start work" },
    work: { action: "complete", label: "Complete job" },
    complete: { action: "complete", label: "Job complete" },
  };

  function requestTransition(action: GoTransition) {
    if (session.stage === "complete") return;
    const result = prepareGoTransition(session, action, { online });
    setBlockers([...result.blockers]);
    if (result.status === "blocked") {
      setNotice(result.blockers[0]?.message ?? "This action is blocked.");
      return;
    }
    if (result.status === "queued_offline") {
      const queueItem = result.queue_item;
      if (queueItem) setQueue((items) => [...items, queueItem]);
      setNotice("Queued offline. Job state has not changed.");
      return;
    }
    if (!result.intent) return;
    const receipt = {
      receipt_id: `receipt-${result.intent.command_id}`,
      command_id: result.intent.command_id,
      correlation_id: result.intent.correlation_id,
      company_id: session.company_id,
      status: "accepted",
    };
    setSession(applyGoReceipt(session, result.intent, receipt));
    setNotice(`${nextAction[session.stage].label} accepted · receipt saved.`);
  }

  function toggleChecklist(index: number) {
    const checklist = session.checklist.map((value, itemIndex) => itemIndex === index ? !value : value);
    setSession(createGoFieldSession({ ...session, checklist }));
    setNotice("Checklist updated on this device.");
  }

  function addEvidence() {
    setSession(createGoFieldSession({ ...session, evidence_count: session.evidence_count + 1 }));
    setNotice("Photo evidence saved to the job.");
  }

  function reportIssue() {
    const result = prepareGoIssue(session, { type: "access_problem", note: "Rear entrance is not accessible.", online });
    const queueItem = result.queue_item;
    if (queueItem) setQueue((items) => [...items, queueItem]);
    setNotice(result.status === "queued_offline" ? "Critical issue queued offline for dispatch." : "Access issue sent to dispatch with job context.");
  }

  function revalidateQueue() {
    const result = revalidateGoQueue(queue, session);
    setNotice(result.conflicts.length ? "Sync paused: the job changed. Review with dispatch." : `${result.ready.length} queued action${result.ready.length === 1 ? "" : "s"} revalidated. Server receipt still required.`);
  }

  const primary = nextAction[session.stage];
  return <div className="go-next">
    <header className="next-job-hero">
      <div><p className="eyeline">Current job · {session.stage === "complete" ? "complete" : "ready"}</p><h2>Hartwell Dental</h2><p>Morning clinic clean · Today, 9:00–10:30 AM</p><span className="hero-address"><MapPin/>18 Hartwell Road, Westbridge</span></div>
      <div className="go-job-status"><button onClick={() => setOnline((value) => !value)} className={online ? "online" : "offline"}>{online ? <Wifi/> : <WifiOff/>}{online ? "Online" : "Offline"}</button><span className="ready-pill">18 min away</span></div>
    </header>
    <div className="visit-stage-strip" aria-label="Job progress">{stageLabels.map((label, index) => <span key={label} className={index <= currentIndex ? "active" : ""}><i/>{label}</span>)}</div>
    <nav className="go-active-tabs" aria-label="Active job view"><button className={view === "details" ? "active" : ""} onClick={() => setView("details")}>Job details</button><button className={view === "route" ? "active" : ""} onClick={() => setView("route")}>Live route</button></nav>
    {view === "route" ? <section className="go-route-view"><div className="go-route-map"><Image src="/main-graphics/maps/map.svg" alt="Route to Hartwell Dental" fill sizes="(max-width: 900px) 100vw, 980px"/><span className="route-worker">Alex</span><span className="route-destination">Hartwell Dental</span></div><div className="go-route-stats"><span><strong>12 min</strong>Estimated travel</span><span><strong>6.4 km</strong>Distance</span><span><strong>Light</strong>Traffic</span><span><strong>Rear car park</strong>Best arrival point</span></div><div className="go-route-note"><Route/><span><strong>Route stored for offline use</strong>Navigation remains available if coverage drops.</span></div></section> : <div className="next-job-grid">
      <section className="next-job-main">
        <div className="site-brief"><strong>Site brief</strong><span>Medical environment · gloves required · use colour-coded cloths · avoid reception between 9:20 and 9:35.</span></div>
        <div className="access-readiness"><ShieldCheck/><span><strong>Access confirmed</strong><small>Access Failure Prevention Specialist verified the rear entrance, contact and alarm instructions at 8:02 AM.</small></span><b>Protected</b></div>
        <div className="next-facts"><span><strong>Site access</strong>Rear staff entrance · notify Sarah on arrival</span><span><strong>Access code</strong><b className="access-code">1847</b> · alarm disarms automatically</span><span><strong>Required equipment</strong>1 clinic kit · 1 HEPA vacuum · 3 disinfectant packs</span><span><strong>Customer contact</strong>Sarah · Practice manager · sarah@hartwell.example</span><span><strong>Team</strong>Alex Morgan + Mia Chen</span><span><strong>Job reference</strong>WO-2048 · Recurring weekly service</span></div>
        <div className="checklist"><strong>Equipment and job checklist</strong>{["Equipment loaded · 5 items", "Reception and waiting room", "Treatment rooms"].map((item, index) => <button key={item} onClick={() => toggleChecklist(index)} className={session.checklist[index] ? "done" : ""}><i>{session.checklist[index] ? <Check /> : null}</i>{item}</button>)}</div>
      </section>
      <aside className="next-actions">
        <Button onClick={() => setView("route")}><Navigation />Navigate</Button>
        <Button className="start-job" disabled={session.stage === "complete"} onClick={() => requestTransition(primary.action)}>{primary.label}</Button>
        <Button variant="secondary"><MessageSquare />Message customer</Button>
        <Button variant="secondary" onClick={addEvidence}><Camera />Evidence {session.evidence_count} of {session.required_evidence_count}</Button>
        <Button variant="secondary" onClick={reportIssue}><AlertTriangle/>Report issue</Button>
        <div className="go-action-notice" aria-live="polite"><strong>{notice}</strong><small>State changes require a matching Titan receipt.</small></div>
        {blockers.length ? <div className="go-blockers">{blockers.map((item) => <span key={item.code}><strong>{item.message}</strong><small>{item.recovery}</small></span>)}</div> : null}
        <small><strong>{online ? "Online and governed" : "Working offline"}</strong> · {online ? "Every action is receipt-controlled." : "Syncs when you reconnect."}</small>
      </aside>
    </div>}
    {queue.length ? <section className="go-offline-queue"><WifiOff/><span><strong>{queue.length} action{queue.length === 1 ? "" : "s"} · Queued offline</strong><small>Nothing is replayed automatically. Revalidate before sync against projection {session.projection_revision}.</small></span><Button onClick={revalidateQueue}>Revalidate before sync</Button></section> : null}
  </div>;
}

function HubDetails() {
  return <div className="hub-detail"><section className="hub-next-card"><header><div className="gen-icon"><CalendarDays /></div><div><p className="eyeline">Next service</p><h2>Clinic clean</h2><span>Tomorrow · 9:00–10:30 AM</span></div><b>Confirmed</b></header><div className="hub-service-journey"><strong>Service journey</strong><div className="visit-progress"><span className="done"><i/>Booked</span><span className="done"><i/>Confirmed</span><span><i/>On the way</span><span><i/>Complete</span></div><small>Arrival updates enabled · we’ll notify you when Alex and Mia depart.</small></div><div className="hub-info-grid"><span><strong>Service address</strong>18 Hartwell Road, Westbridge</span><span><strong>Team</strong>Alex Morgan and Mia Chen</span><span><strong>Access</strong>Rear entrance · notify Sarah first</span><span><strong>Reference</strong>BK-1048 · Weekly</span></div><div className="service-expect"><div><p className="eyeline">What to expect</p><strong>A 90-minute clinic clean</strong><span>Reception, waiting room and treatment rooms using your saved clinic-safe products.</span></div><div><p className="eyeline">Order summary</p><strong>Service total</strong><span className="service-price">$145</span><small>Pay today to save $10.</small></div></div><div className="hub-detail-offers"><div><p className="eyeline">Popular add-ons</p><strong>Front windows</strong><span>Add inside and outside cleaning for $35.</span></div><Button variant="secondary">Add service</Button></div><div className="detail-actions"><Button variant="secondary">Reschedule</Button><Button><MessageSquare />Message team</Button><Button className="hub-pay-button"><span><strong>Pay now</strong><small>$135 today · save $10</small></span></Button></div></section><section className="hub-records hub-history"><header><div><p className="eyeline">Recent services</p><h2>Completed visits</h2></div></header><button><Check/><span><strong>Clinic clean · 23 August</strong><small>Completed by Alex and Mia · 12 photos</small></span><b>Download receipt</b><ChevronRight/></button><button><Check/><span><strong>Clinic clean · 16 August</strong><small>Completed on time · 11 photos</small></span><b>View report</b><ChevronRight/></button></section></div>;
}

export function RoleDetails({ role, command }: { role: TitanRole; command: React.ReactNode }) {
  if (role === "go") return <GoDetails />;
  if (role === "hub") return <HubDetails />;
  return command;
}
