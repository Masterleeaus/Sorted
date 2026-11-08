"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Camera, Check, ChevronRight, CircleDollarSign, MapPin, Mic, Paperclip, Plus, Send, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { ZeroMark } from "./titan-brand";
import { getDemoSurfaceProjection } from "../runtime/surface-contract.mjs";
import { TitanInteractionClient, requestedWorkerFromText } from "../runtime/interaction-client";
import { TitanConversationStore, type ConversationRecord } from "../runtime/conversation-store";
import { GeneratedUiEnvelope } from "./generated-ui/generated-ui-envelope";
import { demoPresentationIntent } from "../runtime/demo-presentation-intent";
import { createMultimodalInput, multimodalAnnouncement, type MultimodalInputKind } from "../runtime/multimodal-input";

export type TitanRole = "zero" | "go" | "hub";

type ChatMessage = { from: "user" | "zero"; text: string };

const demoConversations: Record<TitanRole, ChatMessage[]> = {
  go: [
    { from: "user", text: "Is there anything I should know before I arrive?" },
    { from: "zero", text: "Yes. Use the rear staff entrance; the access code is confirmed. Mia has the floor-plan checklist." },
    { from: "user", text: "Good. What comes after Hartwell?" },
    { from: "zero", text: "Juniper Offices at 11:15 AM. It’s 12 minutes away and the consumables are already loaded." },
  ],
  hub: [
    { from: "user", text: "Can the team also clean the front windows?" },
    { from: "zero", text: "Yes. I can add the window service for $35 without changing your arrival time." },
    { from: "user", text: "Will I be notified when they’re on the way?" },
    { from: "zero", text: "Absolutely. I’ll send an update when the team departs and another when the service is complete." },
  ],
  zero: [
    { from: "user", text: "Which decision is most urgent?" },
    { from: "zero", text: "Hartwell Dental access comes first. It needs confirmation before the 8:30 AM arrival window." },
    { from: "user", text: "And is the rest of today on track?" },
    { from: "zero", text: "Yes. Six jobs are on track, one is starting, and the supply request is the only operational alert." },
  ],
};

function answerFor(role: TitanRole, intent: string) {
  const kind = intentKindFor(role, intent);
  if (kind === "reschedule") return "I found two available times. Choose one and I’ll prepare the change for confirmation.";
  if (kind === "customer-invoice") return "Your account is clear. The next service can be paid now with a $10 saving.";
  if (kind === "service-tracking") return "Your team is scheduled and your arrival updates are on. Live travel tracking will appear when they depart.";
  if (kind === "service-addons") return "These add-ons fit your current booking without changing the arrival window.";
  if (kind === "start") return "The arrival checks are ready. Starting will record your time and job status.";
  if (kind === "note") return "I’ve opened a structured site note so the details stay attached to this job.";
  if (kind === "issue") return "Tell me what happened. I’ll record the issue against this job and alert dispatch without marking the work complete.";
  if (kind === "operations") return "Here’s today’s operational picture across jobs and field teams.";
  if (kind === "workforce") return "Your AI workforce is handling routine operations. Here’s what is autonomous and what still requires you.";
  if (role === "go") return "Here’s your next stop. Access is confirmed and everything you need is ready.";
  if (role === "hub") return "Here’s your next service. You can message the team or open the full booking.";
  if (/invoice|money|overdue/i.test(intent)) return "I found three outstanding invoices. One is overdue and ready for a reminder.";
  return "Here’s the live picture. Two decisions need you; the rest is handled.";
}

function intentKindFor(role: TitanRole, intent: string) {
  if (role === "hub" && /reschedule/i.test(intent)) return "reschedule";
  if (role === "hub" && /invoice|pay|unpaid/i.test(intent)) return "customer-invoice";
  if (role === "hub" && /track|team|arrival|where/i.test(intent)) return "service-tracking";
  if (role === "hub" && /add-on|add on|extra|window/i.test(intent)) return "service-addons";
  if (role === "go" && /start/i.test(intent)) return "start";
  if (role === "go" && /note/i.test(intent)) return "note";
  if (role === "go" && /issue|hazard|problem|incident/i.test(intent)) return "issue";
  if (role === "zero" && /operations|today/i.test(intent)) return "operations";
  if (role === "zero" && /workforce|agents|handle/i.test(intent)) return "workforce";
  return "default";
}

function ResultCard({ role, intent }: { role: TitanRole; intent: string }) {
  const kind = intentKindFor(role, intent);
  if (kind === "reschedule") return <article className="gen-card reschedule-card"><header><span className="gen-icon"><CalendarDays /></span><div><small>Available times</small><h3>Reschedule clinic clean</h3><p>Tomorrow’s booking · no change made yet</p></div></header><div className="choice-grid"><button>Wednesday<br/><small>10:30 AM</small></button><button>Thursday<br/><small>9:00 AM</small></button></div><div className="gen-actions"><button>Keep current time</button><button className="primary">Review change<ArrowRight /></button></div></article>;
  if (kind === "customer-invoice") return <article className="gen-card customer-invoice-card"><header><span className="gen-icon"><CircleDollarSign /></span><div><small>Customer account</small><h3>$145 service payment</h3><p>No overdue balance · payment is optional today</p></div><span className="ready-pill">Save $10</span></header><div className="gen-actions"><button>View invoice</button><button className="primary payment-action"><span><strong>Pay now</strong><small>Save $10 today</small></span><ArrowRight /></button></div></article>;
  if (kind === "service-tracking") return <article className="gen-card service-tracking-card"><header><span className="gen-icon"><MapPin /></span><div><small>Tomorrow · 9:00–10:30 AM</small><h3>Alex and Mia are scheduled</h3><p>Live tracking starts when the team leaves for your property.</p></div><span className="ready-pill">Confirmed</span></header><div className="visit-progress"><span className="done"><i />Booked</span><span className="done"><i />Confirmed</span><span><i />On the way</span><span><i />Complete</span></div><div className="gen-facts"><span><strong>8:40–9:00 AM</strong>Expected arrival window</span><span><strong>Rear entrance</strong>Access instruction saved</span><span><strong>SMS + app</strong>Arrival updates enabled</span></div><div className="gen-actions"><button>Update access</button><button className="primary">Message support<ArrowRight /></button></div></article>;
  if (kind === "service-addons") return <article className="gen-card service-addons-card"><header><span className="gen-icon"><Plus /></span><div><small>Popular add-ons</small><h3>Add to tomorrow’s service</h3><p>No add-on is charged until you confirm.</p></div></header><div className="addon-grid"><button><strong>Front windows</strong><small>Inside and outside</small><b>+$35</b></button><button><strong>Fridge clean</strong><small>Interior detail</small><b>+$28</b></button><button><strong>High-touch sanitise</strong><small>Reception and handles</small><b>+$18</b></button></div><div className="gen-actions"><button>View all extras</button><button className="primary">Review selected<ArrowRight /></button></div></article>;
  if (kind === "start") return <article className="gen-card start-card"><header><span className="gen-icon"><MapPin /></span><div><small>Arrival workflow</small><h3>Hartwell Dental is ready</h3><p>Access verified · equipment confirmed · 3 tasks</p></div><span className="ready-pill">Ready</span></header><div className="gen-actions"><button>Open checklist</button><button className="primary">Confirm start<ArrowRight /></button></div></article>;
  if (kind === "note") return <article className="gen-card site-note-card"><header><span className="gen-icon"><Plus /></span><div><small>Job record · WO-2048</small><h3>Add a site note</h3><p>Visible to your field team and manager</p></div></header><div className="note-preview">Rear entrance access, condition, supplies or customer request…</div><div className="gen-actions"><button>Add photo</button><button className="primary">Save note<ArrowRight /></button></div></article>;
  if (kind === "issue") return <article className="gen-card site-issue-card"><header><span className="gen-icon"><ShieldAlert /></span><div><small>Site issue · WO-2048</small><h3>What needs attention?</h3><p>Dispatch will receive the details and your current location.</p></div><span className="attention-pill">Not sent</span></header><div className="choice-grid"><button>Access problem</button><button>Safety hazard</button><button>Missing supplies</button><button>Customer request</button></div><div className="gen-actions"><button>Add photo</button><button className="primary">Review report<ArrowRight /></button></div></article>;
  if (kind === "operations") return <article className="gen-card operations-card"><header><span className="gen-icon"><Sparkles /></span><div><small>Live operations</small><h3>8 jobs · 3 teams active</h3><p>6 on track · 1 starting · 1 needs review</p></div></header><div className="gen-facts"><span><strong>92%</strong>On-time rate</span><span><strong>42 km</strong>Routes remaining</span><span><strong>1 alert</strong>Supply approval</span></div><div className="gen-actions"><button className="primary">Open operations<ArrowRight /></button></div></article>;
  if (kind === "workforce") return <article className="gen-card workforce-brief-card"><header><span className="gen-icon"><Sparkles /></span><div><small>Governed AI workforce</small><h3>19 agents across 6 teams</h3><p>14 working · 5 monitoring · no failures</p></div><span className="ready-pill">Healthy</span></header><div className="gen-facts"><span><strong>12 tasks</strong>Handled automatically</span><span><strong>3 drafts</strong>Ready for review</span><span><strong>2 decisions</strong>Human approval stays required</span></div><div className="gen-actions"><button>Pause automation</button><button className="primary">Open workforce<ArrowRight /></button></div></article>;
  if (role === "go") return <article className="gen-card job-card">
    <header><span className="gen-icon"><MapPin /></span><div><small>Next job · 18 min away</small><h3>Hartwell Dental</h3><p>Morning clinic clean · 9:00–10:30 AM</p></div><span className="ready-pill">Ready</span></header>
    <div className="gen-facts"><span><strong>Rear entry</strong>Access confirmed</span><span><strong>3 tasks</strong>Equipment loaded</span><span><strong>Alex + Mia</strong>Team assigned</span></div>
    <div className="gen-actions"><button>Navigate</button><button className="primary">Start job<ArrowRight /></button></div>
  </article>;

  if (role === "hub") return <article className="gen-card booking-card">
    <header><span className="gen-icon"><CalendarDays /></span><div><small>Upcoming service</small><h3>Clinic clean</h3><p>Tomorrow · 9:00–10:30 AM</p></div><span className="ready-pill">Confirmed</span></header>
    <div className="visit-progress"><span className="done"><i />Booked</span><span className="done"><i />Confirmed</span><span><i />On the way</span><span><i />Complete</span></div>
    <div className="hub-offers"><button><Plus /><span><strong>Add service</strong><small>Add windows for $35</small></span><ChevronRight /></button><button className="pay-save"><CircleDollarSign /><span><strong>Pay now</strong><small>Save $10 today</small></span><ArrowRight /></button></div>
    <div className="gen-actions"><button>Service details</button><button className="primary">Message team<ArrowRight /></button></div>
  </article>;

  if (/invoice|money|overdue/i.test(intent)) return <article className="gen-card money-card">
    <header><span className="gen-icon"><CircleDollarSign /></span><div><small>Accounts receivable</small><h3>$4,860 outstanding</h3><p>3 invoices · $1,240 overdue</p></div><span className="attention-pill">1 needs action</span></header>
    <div className="invoice-row"><span>INV-1048 · Juniper Offices</span><strong>$1,240</strong><small>8 days overdue</small></div>
    <div className="gen-actions"><button>View all invoices</button><button className="primary">Prepare reminder<ArrowRight /></button></div>
  </article>;

  return <article className="gen-card zero-card">
    <header><span className="gen-icon"><Sparkles /></span><div><small>Owner brief</small><h3>Two decisions need you</h3><p>Everything else is progressing normally.</p></div></header>
    <button className="decision-row"><span className="priority-dot amber"/><span><strong>Confirm customer access</strong><small>Hartwell Dental · before 8:30 AM</small></span><ChevronRight /></button>
    <button className="decision-row"><span className="priority-dot red"/><span><strong>Approve replacement supply</strong><small>Field team · before 3:45 PM</small></span><ChevronRight /></button>
    <div className="gen-actions"><button>Open operations</button><button className="primary">Review decisions<ArrowRight /></button></div>
  </article>;
}

export function RoleChat({ role, onOpenDetails }: { role: TitanRole; onOpenDetails: () => void }) {
  const projection = getDemoSurfaceProjection(role);
  const profile = projection.data.presentation;
  const [query, setQuery] = useState("");
  const [intent, setIntent] = useState(role === "zero" ? "needs me" : "next booking");
  const [history, setHistory] = useState<ConversationRecord[]>([]);
  const [activeWorker, setActiveWorker] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "streaming" | "interrupted">("idle");
  const resumeNeeded = useRef(false);
  const [inputAnnouncement, setInputAnnouncement] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationId = `pwa-${role}-primary`;
  const interaction = useMemo(() => new TitanInteractionClient({ company_id: projection.company_id, conversation_id: conversationId, surface: role }), [projection.company_id, conversationId, role]);
  const conversation = useMemo(() => new TitanConversationStore({ company_id: projection.company_id, conversation_id: conversationId, surface: role }), [projection.company_id, conversationId, role]);
  useEffect(() => { let live = true; conversation.hydrate().then((messages) => { if (live) setHistory(messages); }).catch(() => undefined); return () => { live = false; interaction.cancelActiveStream(); }; }, [conversation, interaction]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && streamState === "streaming") { interaction.cancelActiveStream(); resumeNeeded.current = true; setStreamState("interrupted"); }
      if (document.visibilityState === "visible" && resumeNeeded.current && navigator.onLine) {
        resumeNeeded.current = false; setStreamState("streaming"); interaction.resume().then((session) => setStreamState(session.interrupted ? "interrupted" : "idle")).catch(() => setStreamState("interrupted"));
      }
    };
    const onOnline = () => { if (resumeNeeded.current) onVisibility(); };
    document.addEventListener("visibilitychange", onVisibility); window.addEventListener("online", onOnline);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("online", onOnline); };
  }, [interaction, streamState]);
  const response = useMemo(() => answerFor(role, intent), [intent, role]);
  const presentationIntent = useMemo(() => demoPresentationIntent({ company_id: projection.company_id, conversation_id: conversationId, surface: role, text: intent }), [projection.company_id, conversationId, role, intent]);

  function prepareMultimodal(kind: MultimodalInputKind, file?: File) {
    const envelope = createMultimodalInput({ company_id: projection.company_id, conversation_id: conversationId, surface: role, kind, input_id: `input-${Date.now().toString(36)}`, file_name: file?.name, media_type: file?.type });
    setInputAnnouncement(multimodalAnnouncement(envelope));
  }

  async function send(text = query) {
    const clean = text.trim();
    if (!clean) return;
    setIntent(clean);
    const requestedWorker = requestedWorkerFromText(clean);
    if (requestedWorker) setActiveWorker(requestedWorker);
    const clientMessageId = `pwa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = conversation.optimistic(clean, clientMessageId);
    setHistory((items) => [...items.filter((item) => item.id !== optimistic.id), optimistic]);
    try {
      setStreamState("streaming");
      const session = await interaction.stream(clean, requestedWorker, clientMessageId);
      const events = session.events;
      setStreamState(session.interrupted ? "interrupted" : "idle");
      if (session.interrupted) resumeNeeded.current = true;
      conversation.reconcile(clientMessageId, true);
      const workerText = requestedWorker ? `${requestedWorker} joined this conversation. I’ll keep the context here while they help.` : answerFor(role, clean);
      const projected = events.flatMap((event) => event.message ? [{ ...event.message, delivery_state: "accepted" as const }] : []);
      const reply: ConversationRecord = { id: `reply-${clientMessageId}`, conversation_id: conversationId, company_id: projection.company_id, surface: role, from: "zero", text: workerText, created_at: new Date().toISOString(), delivery_state: "accepted" };
      setHistory(conversation.append([...projected, reply]));
    } catch {
      setStreamState("interrupted"); resumeNeeded.current = true;
      setHistory(conversation.reconcile(clientMessageId, false));
    }
    setQuery("");
  }

  return <div className={`role-chat role-${role}`} style={{ "--role-accent": profile.accent } as React.CSSProperties}>
    <section className="chat-stage">
      <header className="chat-heading"><div><p className="eyeline">{profile.name} · {profile.audience}</p><h1>{profile.heading}</h1></div><div className="trust-state"><ShieldCheck /><span><strong>Private workspace</strong><small>Actions are receipt-controlled</small></span></div></header>
      <div className="chat-thread" aria-live="polite" aria-relevant="additions text">
        <span className="sr-only" role="status" aria-live="assertive">{inputAnnouncement ?? ""}</span>
        {streamState === "streaming" && <div className="worker-handoff" role="status"><Sparkles /><span><strong>Working…</strong> response can be interrupted safely</span></div>}
        {streamState === "interrupted" && <div className="worker-handoff" role="status"><ShieldAlert /><span><strong>Connection interrupted</strong> · conversation can continue from the last server token</span></div>}
        {activeWorker && <div className="worker-handoff" role="status"><Sparkles /><span><strong>{activeWorker}</strong> joined · same conversation, shared context</span></div>}
        <div className="zero-notification"><div className="zero-message"><div className="bubble zero"><div className="zero-bubble-intro"><ZeroMark state="speaking" size="hero"/><div><p>{profile.greeting}</p><p>{response}</p></div></div><GeneratedUiEnvelope intent={presentationIntent} expected={{ company_id: projection.company_id, conversation_id: conversationId, surface: role }}/><div className="gen-meta"><span>CRM · Updated just now</span><span>Surface API · {projection.revision}</span><span>Prototype · No external change without a receipt</span></div><button className="detail-link" onClick={onOpenDetails}>View details <ArrowRight /></button></div></div></div>
        {demoConversations[role].map((message, index) => <div key={`${role}-demo-${message.from}-${index}`} className={message.from === "user" ? "bubble user" : "bubble zero compact"}>{message.text}</div>)}
        {history.map((message) => <div key={message.id} data-delivery-state={message.delivery_state} className={message.from === "user" ? "bubble user" : "bubble zero compact"}>{message.text}{message.delivery_state === "sending" && <small> · Sending…</small>}{message.delivery_state === "failed" && <small> · Not sent</small>}</div>)}
      </div>
      <footer className="chat-footer"><span><Check />Live demo data</span><span>Designed for offline-ready PWA delivery</span></footer>
      <div className="chat-input-dock"><div className="chat-suggestions">{profile.suggestions.map((suggestion) => <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div><div className="chat-composer"><Textarea id={`titan-${role}-message`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={profile.prompt} aria-label={`Message ${profile.name}`} /><div className="composer-tools"><input ref={fileInputRef} className="sr-only" type="file" tabIndex={-1} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) prepareMultimodal("file", file); event.currentTarget.value = ""; }} /><button type="button" aria-label="Attach file as evidence" onClick={() => fileInputRef.current?.click()}><Paperclip /></button><button type="button" aria-label="Use camera for evidence" onClick={() => prepareMultimodal("camera")}><Camera /></button><button type="button" aria-label="Use voice input" onClick={() => prepareMultimodal("voice")}><Mic /></button><Button onClick={() => send()} disabled={!query.trim()} aria-label="Send"><Send /></Button></div></div></div>
    </section>
  </div>;
}
