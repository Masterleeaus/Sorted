"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Card } from "@/components/ui";
import { CURRENT_TITAN_GO_MODE_META } from "@/lib/titan-go/modes";
import { TeamPanel, type TeamMember } from "./TeamPanel";
import { ProfileForm } from "./ProfileForm";
import { EnableNotifications } from "@/components/push/EnableNotifications";
import { LocationDaySettings, type LocationDayValues } from "./LocationDaySettings";
import { TravelSettingsForm } from "./TravelSettingsForm";

interface Props {
  role: "owner" | "admin" | "tech";
  userId: string;
  me: { id: string; full_name: string; email: string; phone: string | null };
  hasAccount: boolean;
  users: TeamMember[];
  locationDay?: LocationDayValues;
}

export function SettingsTabsClient({ role, userId, me, hasAccount, users, locationDay }: Props) {
  const isAdmin = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  // Determine available tabs
  const tabs = [
    { id: "profile", label: "Your Profile", icon: <ProfileIcon /> },
    ...(isOwner ? [{ id: "workspace", label: "Titan Go", icon: <WorkspaceIcon /> }] : []),
    ...(isAdmin && hasAccount ? [{ id: "travel", label: "Travel & Mileage", icon: <TravelIcon /> }] : []),
    ...(isAdmin ? [{ id: "team", label: "Team", icon: <TeamIcon /> }] : []),
    ...(isOwner && locationDay ? [{ id: "location-day", label: "Location & Day", icon: <LocationDayIcon /> }] : []),
    ...(isAdmin ? [{ id: "system-health", label: "System Health", icon: <HealthIcon /> }] : []),
    ...(isAdmin ? [{ id: "tools", label: "Field Setup", icon: <ToolsIcon /> }] : []),
  ];

  const [activeTab, setActiveTab] = useState(tabs[0].id);

  return (
    <div className="p7-settings-layout">
      {/* Sidebar navigation */}
      <div className="p7-settings-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`p7-settings-tab-btn ${activeTab === tab.id ? "active" : ""}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p7-settings-content">
        {activeTab === "profile" && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>Your Profile</h2>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 24 }}>
              Update your personal info, contact details, and account password.
            </p>
            <Card padding="default">
              <ProfileForm
                userId={me.id}
                initialName={me.full_name}
                initialEmail={me.email}
                initialPhone={me.phone}
                role={role}
              />
            </Card>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "24px 0 8px 0" }}>Notifications</h3>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 16 }}>
              Get a push notification when Field needs you — arrivals, operational exceptions, approvals and other time-sensitive work, even when Titan Go is closed.
            </p>
            <Card padding="default">
              <EnableNotifications />
            </Card>
          </section>
        )}

        {activeTab === "workspace" && isOwner && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>Titan Go</h2>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 24 }}>
              One installable app for every Titan Zero system your account can use.
            </p>
            <Card padding="default">
              <div className="tg-settings-go">
                <div className="tg-settings-go__brand"><img src="/icons/icon-192.png" alt="" /><span><strong>Titan Go</strong><small>Single PWA · role and subscription aware</small></span></div>
                <div className="tg-settings-go__mode"><span>Current mode</span><strong><i /> {CURRENT_TITAN_GO_MODE_META.shortLabel}</strong></div>
                <p>
                  Build, Desk, Field and Pay do not require separate mobile installs. When more Titan Zero products are subscribed, Titan Go can expose those authorised modes to the same signed-in user.
                </p>
              </div>
            </Card>
          </section>
        )}

        {activeTab === "travel" && isAdmin && hasAccount && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>Travel & Mileage</h2>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 24 }}>
              Business origin, included service radius, mileage rates, and travel-time policy.
              Rates are snapshotted on each estimate — changing them never rewrites history.
            </p>
            <Card padding="default">
              <TravelSettingsForm />
            </Card>
          </section>
        )}



        {activeTab === "team" && isAdmin && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>Team Directory</h2>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 24 }}>
              Manage team accounts, assign roles, and configure system permissions.
            </p>
            <TeamPanel
              initialMembers={users}
              currentUserId={userId}
              currentRole={role}
            />
          </section>
        )}



        {activeTab === "location-day" && isOwner && locationDay && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>Location & Day Review</h2>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 24 }}>
              Configure when end-of-day review prompts appear and how location stops are classified.
            </p>
            <Card padding="default">
              <LocationDaySettings {...locationDay} />
            </Card>
          </section>
        )}

        {activeTab === "system-health" && isAdmin && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>System Health</h2>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 24 }}>
              Monitor system state, service configurations, and encryption integrity.
            </p>
            <Card padding="default">
              <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
                Check Field services, push delivery, intelligence integrations, encryption and database configuration health.
              </p>
              <Link
                href={"/app/settings/system-health" as unknown as Route}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "var(--text-sm)",
                  color: "var(--accent)",
                  fontWeight: "var(--font-medium)",
                  textDecoration: "none"
                }}
              >
                Open System Health Diagnostics &rarr;
              </Link>
            </Card>
          </section>
        )}

        {activeTab === "tools" && isAdmin && (
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>Field Setup</h2>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 24 }}>
              Operational configuration and Field workspaces. Desk and Pay settings are intentionally kept out of this product surface.
            </p>
            <Card padding="default">
              <p style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
                Field tools in one place. Titan Go uses the same Field destinations in its mobile hamburger menu.
              </p>
              <div className="tg-settings-link-grid">
                {[
                  { href: "/app/schedule", label: "Schedule", kicker: "OPERATIONS", desc: "Plan visits, availability and tomorrow's work" },
                  { href: "/app/workforce", label: "Workforce", kicker: "WORKFORCE", desc: "Operations Manager, Specialists, Workers and field team" },
                  { href: "/app/standards", label: "Titan Standards", kicker: "QUALITY & STANDARDS", desc: "Included SOPs, safety, training, compliance and audits" },
                  { href: "/app/materials", label: "Materials", kicker: "ASSETS & SUPPLY", desc: "Field materials, consumables and job usage" },
                  { href: "/app/assets", label: "Assets", kicker: "ASSETS & SUPPLY", desc: "Equipment, custody, condition and readiness" },
                  { href: "/app/timeline", label: "Tracking", kicker: "FIELD CONTEXT", desc: "Field movement, stops and travel context" },
                  { href: "/app/mileage", label: "Mileage & Vehicles", kicker: "FIELD CONTEXT", desc: "Odometer sessions, fleet, fuel and service" },
                  { href: "/app/operations-analytics", label: "Operations Analytics", kicker: "INSIGHT", desc: "Field workload, completion and delivery performance" },
                ].map(({ href, label, kicker, desc }) => (
                  <Link key={href} href={href as unknown as Route} className="tg-settings-link-card">
                    <span className="tg-kicker">{kicker}</span>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                    <b aria-hidden="true">→</b>
                  </Link>
                ))}
              </div>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}

// Inline SVGs for Tab Icons
function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}


function TravelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}


function TeamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}


function HealthIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function ToolsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 1.4l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  );
}

function LocationDayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="10" r="3" />
      <path d="M12 2a8 8 0 0 1 8 8c0 5-8 13-8 13S4 15 4 10a8 8 0 0 1 8-8z" />
    </svg>
  );
}
