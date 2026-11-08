"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";

const ACTION_GROUPS = [
  {
    label: "Work",
    actions: [
      { label: "Job", detail: "Create field work to deliver", href: "/app/jobs/new", icon: "▣" },
      { label: "Work Order", detail: "Create bounded work inside a job", href: "/app/work-orders/new", icon: "▤" },
      { label: "Visit / Schedule", detail: "Place work onto the Field schedule", href: "/app/schedule", icon: "◷" },
      { label: "Site", detail: "Add a service location", href: "/app/properties/new", icon: "⌂" },
    ],
  },
  {
    label: "Field record",
    actions: [
      { label: "Capture", detail: "Record a note, promise, photo or evidence", href: "/app/capture", icon: "＋" },
      { label: "Quick materials", detail: "Prepare a purchase-ready materials list", href: "/app/materials/quick", icon: "◫" },
      { label: "Mileage session", detail: "Log a vehicle or travel session", href: "/app/mileage/new", icon: "↗" },
    ],
  },
] as const;

export function NewActionMenu({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="tz-new-menu" ref={root}>
      <button
        type="button"
        className={`tz-new-menu__trigger ${compact ? "tz-new-menu__trigger--compact" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">＋</span>
        {compact ? <span className="sr-only">New Field record</span> : <span>New</span>}
        <span className="tz-new-menu__chevron" aria-hidden="true">⌄</span>
      </button>

      {open ? (
        <div className="tz-new-menu__panel" role="menu" aria-label="Create in Titan Field">
          <div className="tz-new-menu__heading">
            <span>NEW IN FIELD</span>
            <small>Create manually when you already know exactly what you need.</small>
          </div>
          {ACTION_GROUPS.map((group) => (
            <div key={group.label} className="tz-new-menu__group">
              <div className="tz-new-menu__group-label">{group.label}</div>
              {group.actions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href as Route}
                  role="menuitem"
                  className="tz-new-menu__item"
                  onClick={() => setOpen(false)}
                >
                  <span className="tz-new-menu__icon" aria-hidden="true">{action.icon}</span>
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.detail}</small>
                  </span>
                  <span className="tz-new-menu__arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          ))}
          <div className="tz-new-menu__zero-note">
            <span aria-hidden="true">✦</span>
            <span><strong>Not sure what to create?</strong><small>Ask Titan Zero instead and describe the outcome.</small></span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
