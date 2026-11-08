"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ChatMessage = {
  id: string;
  from: "user" | "zero";
  text: string;
};

export type TitanZeroPulse = {
  attention: number;
  todayJobs: number;
  activeWorkers: number;
};

const PROMPTS = [
  "What needs my attention?",
  "Fill tomorrow's gaps",
  "Who has capacity?",
  "Find missing evidence",
  "Check equipment readiness",
];

export function TitanZeroChat({
  compact = false,
  pulse,
}: {
  compact?: boolean;
  pulse?: TitanZeroPulse;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState(true);
  const conversationId = useRef<string | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  async function send(textOverride?: string) {
    const text = (textOverride ?? message).trim();
    if (!text || busy) return;

    conversationId.current ??= crypto.randomUUID();
    const clientMessageId = crypto.randomUUID();

    if (!compact) {
      setHistory((items) => [
        ...items,
        { id: clientMessageId, from: "user", text },
      ]);
    }

    setMessage("");
    setBusy(true);
    setStatus("Zero is checking Field…");

    try {
      const response = await fetch("/api/v1/zero/interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          surface: "zero",
          conversation_id: conversationId.current,
          text,
          client_message_id: clientMessageId,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const code = String(result?.code ?? "");
        if (code === "ZERO_RUNTIME_UNAVAILABLE") {
          const unavailable =
            "Live Zero execution is being connected to this Field environment. You can keep using the Field controls while the governed execution bridge is completed.";
          setStatus(unavailable);
          if (!compact) {
            setHistory((items) => [
              ...items,
              { id: crypto.randomUUID(), from: "zero", text: unavailable },
            ]);
          }
          return;
        }
        throw new Error(result?.error ?? "Zero could not accept that request.");
      }

      const eventText = Array.isArray(result?.events)
        ? result.events
            .map((event: Record<string, unknown>) => {
              const messageEvent = event.message as { text?: string } | undefined;
              return messageEvent?.text ?? "";
            })
            .filter(Boolean)
            .join("\n")
        : "";

      const accepted =
        eventText || "Request accepted by the governed Field workforce.";
      setStatus(accepted);
      if (!compact) {
        setHistory((items) => [
          ...items,
          { id: crypto.randomUUID(), from: "zero", text: accepted },
        ]);
      }
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Zero request failed.";
      setStatus(text);
      if (!compact) {
        setHistory((items) => [
          ...items,
          { id: crypto.randomUUID(), from: "zero", text },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <div className="tz-sidebar-zero">
        <div className="tz-sidebar-zero__head">
          <span className="tz-zero-spark">✦</span>
          <span>Ask Titan Zero</span>
          <small className={online ? "is-online" : ""}>{online ? "Field" : "Offline"}</small>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="tz-sidebar-zero__form"
        >
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Fix tomorrow's schedule…"
            aria-label="Ask Titan Zero"
          />
          <button type="submit" disabled={busy || !message.trim()} aria-label="Send to Titan Zero">
            →
          </button>
        </form>
        {status ? <p className="tz-sidebar-zero__status">{status}</p> : null}
      </div>
    );
  }

  return (
    <section className="tz-zero-console" aria-labelledby="titan-zero-heading">
      <div className="tz-zero-console__top">
        <div className="tz-zero-console__identity">
          <span className="tz-zero-orb" aria-hidden="true">✦</span>
          <div>
            <p className="tz-eyebrow">TITAN ZERO · FIELD COMMAND</p>
            <h1 id="titan-zero-heading">What should Field handle?</h1>
            <div className="tz-zero-scope"><span className={online ? "is-online" : ""} />{online ? "Connected" : "Offline"} · Field context</div>
          </div>
        </div>
        {pulse ? (
          <div className="tz-zero-console__pulse" aria-label="Field status">
            <span><b>{pulse.attention}</b> need attention</span>
            <span><b>{pulse.todayJobs}</b> jobs today</span>
            <span><b>{pulse.activeWorkers}</b> field workers</span>
          </div>
        ) : null}
      </div>

      <div className="tz-zero-thread" aria-live="polite">
        <div className="tz-zero-message tz-zero-message--zero">
          <span className="tz-zero-message__mark">Z</span>
          <div>
            <strong>Zero</strong>
            <p>I’m ready. Ask about jobs, scheduling, workforce, evidence, quality, standards, assets or today’s operations.</p>
          </div>
        </div>
        {history.map((item) => (
          <div
            key={item.id}
            className={`tz-zero-message ${item.from === "user" ? "tz-zero-message--user" : "tz-zero-message--zero"}`}
          >
            {item.from === "zero" ? <span className="tz-zero-message__mark">Z</span> : null}
            <div>
              <strong>{item.from === "user" ? "You" : "Zero"}</strong>
              <p>{item.text}</p>
            </div>
          </div>
        ))}
      </div>

      {history.length ? (
        <div className="tz-zero-thread-tools">
          <button type="button" onClick={() => { setHistory([]); setStatus(""); conversationId.current = undefined; }}>Clear conversation</button>
        </div>
      ) : null}

      <div className="tz-zero-suggestions" aria-label="Suggested Zero prompts">
        {PROMPTS.map((prompt) => (
          <button key={prompt} type="button" onClick={() => void send(prompt)} disabled={busy}>
            {prompt}
          </button>
        ))}
      </div>

      <form
        className="tz-zero-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <span className="tz-zero-spark" aria-hidden="true">✦</span>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask Titan Zero about Field…"
          aria-label="Ask Titan Zero about Field"
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !message.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </form>
      {status ? <p className="tz-zero-status" role="status">{status}</p> : null}
    </section>
  );
}
