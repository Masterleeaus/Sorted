/**
 * PROTOTYPE — sample data only.
 *
 * RoleInbox and RoleMore are not linked from live Titan navigation and are not
 * connected to dispatch, sync, payment or evidence APIs. Every name, status,
 * message and count in this file is sample text. Do not read any status here as
 * real system state. Before a surface is promoted to production it needs real
 * data sources and loading, empty and error states (see issue #2).
 */
"use client";

import { useId, useState } from "react";
import { AlertTriangle, Bell, CalendarDays, Camera, Car, Check, ChevronRight, CircleDollarSign, Clock3, Cloud, FileText, KeyRound, LockKeyhole, MapPin, MessageSquare, Phone, ShieldAlert, ShieldCheck, SlidersHorizontal, Smartphone, UserRound, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import type { TitanRole } from "./role-chat";

const PROTOTYPE_LABEL = "Prototype — sample data";

function PrototypeFrame({ children }: { children: React.ReactNode }) {
  return <div className="prototype-frame"><p role="note" style={{ margin: "0 0 8px", fontWeight: 600 }}>{PROTOTYPE_LABEL}</p>{children}</div>;
}

function SimpleThread({ title, detail, messages, quickReplies = [] }: { title: string; detail: string; messages: string[]; quickReplies?: string[] }) {
  const replyId = useId();
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  function send() { const clean = draft.trim(); if (clean) { setSent((items) => [...items, clean]); setDraft(""); } }
  return <section className="role-thread"><header><span className="thread-avatar"><MessageSquare /></span><div><h2>{title}</h2><p>{detail}</p></div><Button variant="secondary" style={{ width: 44, height: 44, padding: 0 }} aria-label="Call"><Phone /></Button></header><div className="role-message-stream">{messages.map((message) => <div className="role-message inbound" key={message}>{message}</div>)}{sent.map((message) => <div className="role-message outbound" key={message}>{message}<small>Not sent: prototype only</small></div>)}</div>{quickReplies.length ? <div className="field-escalations"><span><AlertTriangle/><strong>Escalation options</strong><small>Prototype only: nothing is sent to dispatch.</small></span><div>{quickReplies.map((reply) => <button key={reply} onClick={() => setDraft(reply)}>{reply}</button>)}</div></div> : null}<div className="role-reply"><Textarea id={replyId} aria-label={title === "Titan Support" ? "Message Titan Support" : "Message dispatch"} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={title === "Titan Support" ? "Ask for help…" : "Message dispatch…"}/><Button disabled={!draft.trim()} onClick={send}>Send</Button></div></section>;
}

function GoInbox() { return <PrototypeFrame><div className="secondary-role-layout"><aside className="role-contact-list"><p className="eyeline">Field messages</p><h2>Team and dispatch</h2><div className="dispatch-health"><ShieldCheck/><span><strong>Sample dispatch thread</strong><small>Sample job WO-2048</small></span></div><button className="active"><span className="thread-avatar">DS</span><span><strong>Dispatch</strong><small>Sample message: rear access</small></span><b>2</b></button><button><span className="thread-avatar">M</span><span><strong>Mia</strong><small>Sample message: equipment</small></span></button></aside><SimpleThread title="Dispatch" detail="Sample company · Operations · WO-2048" messages={["Sample: rear access for Hartwell Dental is confirmed.", "Sample: your route is clear. Let us know if anything changes on site."]} quickReplies={["Access problem", "Safety hazard", "Running late"]}/></div></PrototypeFrame>; }

function HubInbox() { return <PrototypeFrame><div className="secondary-role-layout"><aside className="role-contact-list"><p className="eyeline">Customer support</p><h2>How can we help?</h2><div className="support-summary"><ShieldCheck/><span><strong>Reply time</strong><small>Not measured in this prototype</small></span></div><button className="active"><span className="thread-avatar">TZ</span><span><strong>Titan Support</strong><small>Sample conversation</small></span></button><button><span className="thread-avatar"><FileText/></span><span><strong>Quote questions</strong><small>Sample quote thread</small></span></button></aside><SimpleThread title="Titan Support" detail="Sample private conversation · Booking BK-1048" messages={["Sample: Hi Sam, your clinic clean is confirmed for tomorrow at 9:00 AM.", "Sample: How can we help with your upcoming service?"]}/></div></PrototypeFrame>; }

export function RoleInbox({ role, command }: { role: TitanRole; command: React.ReactNode }) { if (role === "go") return <GoInbox/>; if (role === "hub") return <HubInbox/>; return command; }

const goSettings = [
  { icon: Clock3, title: "Shift and availability", detail: "Sample: shift until 4:30 PM · break at 12:35", status: "Sample" },
  { icon: Car, title: "Vehicle and equipment", detail: "Sample: Van 04 · clinic kit list", status: "Sample" },
  { icon: Smartphone, title: "Offline and sync", detail: "Sample: no device sync runs in this prototype", status: "Sample" },
  { icon: MapPin, title: "Location sharing", detail: "Sample: only while working", status: "Sample" },
  { icon: Camera, title: "Photos and evidence", detail: "Sample: camera access and upload quality", status: "Sample" },
  { icon: ShieldAlert, title: "Safety and incidents", detail: "Sample: report a hazard, injury or site issue", status: "Sample" },
  { icon: Bell, title: "Job notifications", detail: "Sample: changes, dispatch and reminders", status: "Sample" },
];
const hubSettings = [
  { icon: UserRound, title: "Profile and contacts", detail: "Sample: Sam · Hartwell Dental", status: "Sample" },
  { icon: MapPin, title: "Service locations", detail: "Sample: 1 property", status: "Sample" },
  { icon: CircleDollarSign, title: "Payment methods and receipts", detail: "Sample: payment options", status: "Sample" },
  { icon: KeyRound, title: "Access instructions", detail: "Sample: rear entrance · notify before arrival", status: "Sample" },
  { icon: Bell, title: "Communication preferences", detail: "Sample: SMS and app arrival updates", status: "Sample" },
  { icon: SlidersHorizontal, title: "Service preferences", detail: "Sample: clinic products · reception timing", status: "Sample" },
  { icon: LockKeyhole, title: "Privacy and access", detail: "Sample: manage sign-in and data", status: "Sample" },
];

export function RoleMore({ role, command }: { role: TitanRole; command: React.ReactNode }) {
  if (role === "zero") return command;
  const isGo = role === "go"; const items = isGo ? goSettings : hubSettings;
  return <PrototypeFrame><div className="role-more"><section className="role-profile-card"><span className="profile-mark">{isGo ? "AM" : "HD"}</span><div><p className="eyeline">{isGo ? "Titan Go" : "Titan Hub"}</p><h2>{isGo ? "Alex Morgan" : "Hartwell Dental"}</h2><span>{isGo ? "Sample field technician · Sample company" : "Sample customer account · Sam Hartwell"}</span></div><Button variant="secondary">Edit profile</Button></section>{isGo ? <section className="go-readiness-grid"><article><WifiOff/><span><strong>Offline queue</strong><small>Sample: no queue data</small></span><b>Sample</b></article><article><Cloud/><span><strong>Projection revision</strong><small>Sample revision label</small></span><b>Sample</b></article><article><Camera/><span><strong>Evidence storage</strong><small>Sample count, nothing stored</small></span><b>Sample</b></article><article><ShieldAlert/><span><strong>Escalation path</strong><small>Sample escalation path</small></span><b>Sample</b></article></section> : <section className="role-account-records"><header><p className="eyeline">Your account</p><h2>Bookings and payments</h2></header><button><CalendarDays/><span><strong>Upcoming services</strong><small>Sample: 2 bookings</small></span><b>2</b><ChevronRight/></button><button><FileText/><span><strong>Quotes</strong><small>Sample quote</small></span><b>1</b><ChevronRight/></button><button><CircleDollarSign/><span><strong>Payments and receipts</strong><small>Sample: paid, no balance due</small></span><b>$0 due</b><ChevronRight/></button></section>}<section className="role-settings-list">{items.map(({ icon: Icon, title, detail, status }) => <button key={title}><span className="setting-mark"><Icon/></span><span><strong>{title}</strong><small>{detail}</small></span><em>{status}</em><ChevronRight/></button>)}</section><section className="role-device-card"><Cloud/><span><strong>{isGo ? "Sample offline status" : "Sample account status"}</strong><small>{isGo ? "Prototype only. No offline queue or device sync runs here." : "Prototype only. This screen does not sync data."}</small></span><span className="state-check"><Check/>Sample</span></section></div></PrototypeFrame>;
}
