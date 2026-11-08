"use client";

import { useId, useState } from "react";
import { AlertTriangle, Bell, CalendarDays, Camera, Car, Check, ChevronRight, CircleDollarSign, Clock3, Cloud, FileText, KeyRound, LockKeyhole, MapPin, MessageSquare, Phone, ShieldAlert, ShieldCheck, SlidersHorizontal, Smartphone, UserRound, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import type { TitanRole } from "./role-chat";

function SimpleThread({ title, detail, messages, quickReplies = [] }: { title: string; detail: string; messages: string[]; quickReplies?: string[] }) {
  const replyId = useId();
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  function send() { const clean = draft.trim(); if (clean) { setSent((items) => [...items, clean]); setDraft(""); } }
  return <section className="role-thread"><header><span className="thread-avatar"><MessageSquare /></span><div><h2>{title}</h2><p>{detail}</p></div><Button variant="secondary" style={{ width: 44, height: 44, padding: 0 }} aria-label="Call"><Phone /></Button></header><div className="role-message-stream">{messages.map((message) => <div className="role-message inbound" key={message}>{message}</div>)}{sent.map((message) => <div className="role-message outbound" key={message}>{message}<small>Sent in demo mode</small></div>)}</div>{quickReplies.length ? <div className="field-escalations"><span><AlertTriangle/><strong>Escalate with context</strong><small>Dispatch receives the job context automatically.</small></span><div>{quickReplies.map((reply) => <button key={reply} onClick={() => setDraft(reply)}>{reply}</button>)}</div></div> : null}<div className="role-reply"><Textarea id={replyId} aria-label={title === "Titan Support" ? "Message Titan Support" : "Message dispatch"} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={title === "Titan Support" ? "Ask for help…" : "Message dispatch…"}/><Button disabled={!draft.trim()} onClick={send}>Send</Button></div></section>;
}

function GoInbox() { return <div className="secondary-role-layout"><aside className="role-contact-list"><p className="eyeline">Field messages</p><h2>Team and dispatch</h2><div className="dispatch-health"><ShieldCheck/><span><strong>Dispatch connected</strong><small>Job WO-2048 context attached</small></span></div><button className="active"><span className="thread-avatar">DS</span><span><strong>Dispatch</strong><small>Rear access is confirmed.</small></span><b>2</b></button><button><span className="thread-avatar">M</span><span><strong>Mia</strong><small>I’ve loaded the equipment.</small></span></button></aside><SimpleThread title="Dispatch" detail="Titan Demo Co. · Operations · WO-2048" messages={["Rear access for Hartwell Dental is confirmed.", "Your route is clear. Let us know if anything changes on site."]} quickReplies={["Access problem", "Safety hazard", "Running late"]}/></div>; }

function HubInbox() { return <div className="secondary-role-layout"><aside className="role-contact-list"><p className="eyeline">Customer support</p><h2>How can we help?</h2><div className="support-summary"><ShieldCheck/><span><strong>Typical reply</strong><small>Under 5 minutes</small></span></div><button className="active"><span className="thread-avatar">TZ</span><span><strong>Titan Support</strong><small>Your service team is online.</small></span></button><button><span className="thread-avatar"><FileText/></span><span><strong>Quote questions</strong><small>Weekly service proposal</small></span></button></aside><SimpleThread title="Titan Support" detail="Private conversation · Booking BK-1048" messages={["Hi Sam, your clinic clean is confirmed for tomorrow at 9:00 AM.", "How can we help with your upcoming service?"]}/></div>; }

export function RoleInbox({ role, command }: { role: TitanRole; command: React.ReactNode }) { if (role === "go") return <GoInbox/>; if (role === "hub") return <HubInbox/>; return command; }

const goSettings = [
  { icon: Clock3, title: "Shift and availability", detail: "On shift until 4:30 PM · break at 12:35", status: "Active" },
  { icon: Car, title: "Vehicle and equipment", detail: "Van 04 · clinic kit and supplies checked", status: "Ready" },
  { icon: Smartphone, title: "Offline and sync", detail: "Ready for today’s route", status: "Synced" },
  { icon: MapPin, title: "Location sharing", detail: "Only while you are working", status: "On shift" },
  { icon: Camera, title: "Photos and evidence", detail: "Camera access and upload quality", status: "Ready" },
  { icon: ShieldAlert, title: "Safety and incidents", detail: "Report a hazard, injury or site issue", status: "Clear" },
  { icon: Bell, title: "Job notifications", detail: "Changes, dispatch and reminders", status: "Enabled" },
];
const hubSettings = [
  { icon: UserRound, title: "Profile and contacts", detail: "Sam · Hartwell Dental", status: "Verified" },
  { icon: MapPin, title: "Service locations", detail: "1 active property", status: "Current" },
  { icon: CircleDollarSign, title: "Payment methods and receipts", detail: "PayID enabled · receipts by email", status: "Ready" },
  { icon: KeyRound, title: "Access instructions", detail: "Rear entrance · notify before arrival", status: "Saved" },
  { icon: Bell, title: "Communication preferences", detail: "SMS and app arrival updates", status: "Enabled" },
  { icon: SlidersHorizontal, title: "Service preferences", detail: "Clinic products · reception timing saved", status: "Current" },
  { icon: LockKeyhole, title: "Privacy and access", detail: "Manage sign-in and data", status: "Protected" },
];

export function RoleMore({ role, command }: { role: TitanRole; command: React.ReactNode }) {
  if (role === "zero") return command;
  const isGo = role === "go"; const items = isGo ? goSettings : hubSettings;
  return <div className="role-more"><section className="role-profile-card"><span className="profile-mark">{isGo ? "AM" : "HD"}</span><div><p className="eyeline">{isGo ? "Titan Go" : "Titan Hub"}</p><h2>{isGo ? "Alex Morgan" : "Hartwell Dental"}</h2><span>{isGo ? "Field technician · Titan Demo Co." : "Customer account · Sam Hartwell"}</span></div><Button variant="secondary">Edit profile</Button></section>{isGo ? <section className="go-readiness-grid"><article><WifiOff/><span><strong>Offline queue</strong><small>0 actions · Pending sync</small></span><b>Clear</b></article><article><Cloud/><span><strong>Projection revision</strong><small>go-rev-4 · Revalidate on reconnect</small></span><b>Current</b></article><article><Camera/><span><strong>Evidence storage</strong><small>24 photos available offline</small></span><b>Ready</b></article><article><ShieldAlert/><span><strong>Escalation path</strong><small>Dispatch and safety response online</small></span><b>Live</b></article></section> : <section className="role-account-records"><header><p className="eyeline">Your account</p><h2>Bookings and payments</h2></header><button><CalendarDays/><span><strong>Upcoming services</strong><small>2 confirmed bookings</small></span><b>2</b><ChevronRight/></button><button><FileText/><span><strong>Quotes</strong><small>Weekly service proposal ready</small></span><b>1</b><ChevronRight/></button><button><CircleDollarSign/><span><strong>Payments and receipts</strong><small>Paid · no balance due</small></span><b>$0 due</b><ChevronRight/></button></section>}<section className="role-settings-list">{items.map(({ icon: Icon, title, detail, status }) => <button key={title}><span className="setting-mark"><Icon/></span><span><strong>{title}</strong><small>{detail}</small></span><em>{status}</em><ChevronRight/></button>)}</section><section className="role-device-card"><Cloud/><span><strong>{isGo ? "Offline work is ready" : "Your account is up to date"}</strong><small>{isGo ? "Today’s jobs and checklists are available on this device. Revalidate queued work before sync." : "Bookings, messages and documents were synced just now."}</small></span><span className="state-check"><Check/>Ready</span></section></div>;
}
