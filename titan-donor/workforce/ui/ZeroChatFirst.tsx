"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Pulse = { attention: number; jobs: number; onTrack: number; exceptions: number; activeWorkers: number; waitingWorkers: number; approvals: number };

export function ZeroChatFirst({ pulse, conversationId, continuationToken }: { pulse?: Pulse; conversationId?: string; continuationToken?: string }) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const conversation = useRef<string | undefined>(conversationId);
  const pending = useRef<{ text: string; id: string } | null>(null);
  const router = useRouter();
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    conversation.current ??= crypto.randomUUID();
    if (pending.current?.text !== text) pending.current = { text, id: crypto.randomUUID() };
    setBusy(true); setStatus("Submitting…");
    try {
      const response = await fetch("/api/v1/zero/interactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface: "zero", conversation_id: conversation.current, text, client_message_id: pending.current.id, continuation_token: continuationToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Interaction rejected");
      setStatus("Request recorded. The persisted status appears below.");
      pending.current = null; setMessage(""); router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return (
    <section aria-labelledby="zero-heading" style={{ display: "grid", gap: "var(--space-4)", marginBottom: "var(--space-5)" }}>
      <div>
        <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--text-sm)", letterSpacing: ".08em" }}>ZERO</p>
        <h1 id="zero-heading" style={{ margin: "var(--space-1) 0 0" }}>What needs attention?</h1>
      </div>
      <form onSubmit={send} role="search" aria-label="Chat with Zero" style={{ display: "flex", gap: "var(--space-2)" }}>
        <label htmlFor="zero-chat" className="sr-only">Chat with Zero</label>
        <input id="zero-chat" name="q" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Chat with Zero…" autoComplete="off" style={{ flex: 1, minHeight: 48, padding: "0 var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-card)", color: "inherit", fontSize: "1rem" }} />
        <button type="submit" disabled={busy || !message.trim()} aria-label="Send to Zero" style={{ minWidth: 48, minHeight: 48 }}>Send</button>
      </form>
      <p role="status">{status}</p>
      {pulse && <div aria-label="Business pulse" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "var(--space-2)" }}>
        <Pulse label="Needs your attention" value={`${pulse.attention} decisions`} />
        <Pulse label="Today's business" value={`${pulse.jobs} jobs · ${pulse.onTrack} on track · ${pulse.exceptions} exceptions`} />
        <Pulse label="Workforce" value={`${pulse.activeWorkers} active · ${pulse.waitingWorkers} waiting · ${pulse.approvals} need approval`} />
      </div>}
    </section>
  );
}

function Pulse({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-card)" }}><strong style={{ display: "block", fontSize: "var(--text-sm)" }}>{label}</strong><span style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>{value}</span></div>;
}
