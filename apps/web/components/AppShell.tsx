"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "next";
import type { Role } from "@ai-fsm/domain";
import { ToastProvider } from "./ui/Toast";
import { CommandPalette } from "./CommandPalette";
import { LiveRefresh } from "./LiveRefresh";
import { TitanZeroChat } from "./TitanZeroChat";
import { NewActionMenu } from "./NewActionMenu";
import { CURRENT_TITAN_GO_MODE_META } from "@/lib/titan-go/modes";
import {
  IconDashboard,
  IconSettings,
  IconMyDay,
  IconProperties,
  IconJobs,
  IconReports,
  IconSchedule,
  IconDayReview,
  IconField,
  IconInvoices,
} from "./NavIcons";
import {
  AttentionBell,
  NavCountBadge,
  useAttentionSummary,
} from "./attention/AttentionBell";

type IconComponent = (props: { size?: number }) => React.ReactElement;

function IconChevronLeft({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>;
}

function IconChevronRight({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>;
}

function IconMenu({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

function IconClose({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;
}

function IconWorkOrder({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4h6l1 2h3v15H5V6h3l1-2Z" /><path d="M9 11h6M9 15h6" /></svg>;
}

function IconStandards({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 12 2 2 4-5" /><path d="M12 3 4.5 6v5.5c0 4.7 3.1 8.1 7.5 9.5 4.4-1.4 7.5-4.8 7.5-9.5V6L12 3Z" /></svg>;
}

function IconAssets({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16v11H4z" /><path d="M8 7V5h8v2M9 12h6" /></svg>;
}

interface NavItem {
  href: string;
  label: string;
  Icon: IconComponent;
  adminOnly?: boolean;
  activePrefixes?: string[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_COMMAND: NavItem = { href: "/app/activity", label: "Activity", Icon: IconDashboard };
const NAV_MAP: NavItem = { href: "/app/map", label: "Map", Icon: IconField };
const NAV_CONSOLE: NavItem = { href: "/app/console", label: "Console", Icon: IconSettings };
const NAV_TODAY: NavItem = { href: "/app/my-work", label: "Today", Icon: IconMyDay };
const NAV_DAY_REVIEW: NavItem = { href: "/app/day-review", label: "Day Review", Icon: IconDayReview };
const NAV_JOBS: NavItem = { href: "/app/jobs", label: "Jobs", Icon: IconJobs, adminOnly: true };
const NAV_WORK_ORDERS: NavItem = { href: "/app/work-orders", label: "Work Orders", Icon: IconWorkOrder, adminOnly: true };
const NAV_VISITS: NavItem = { href: "/app/visits", label: "Visits", Icon: IconMyDay, adminOnly: true };
const NAV_SCHEDULE: NavItem = { href: "/app/schedule", label: "Schedule", Icon: IconSchedule, adminOnly: true };
const NAV_TRACKING: NavItem = { href: "/app/timeline", label: "Tracking", Icon: IconField, adminOnly: true };
const NAV_SITES: NavItem = { href: "/app/properties", label: "Sites", Icon: IconProperties, adminOnly: true };
const NAV_WORKFORCE: NavItem = { href: "/app/workforce", label: "Workforce", Icon: IconField, adminOnly: true };
const NAV_MATERIALS: NavItem = { href: "/app/materials", label: "Materials", Icon: IconInvoices, adminOnly: true };
const NAV_ASSETS: NavItem = { href: "/app/assets", label: "Assets", Icon: IconAssets, adminOnly: true };
const NAV_STANDARDS: NavItem = { href: "/app/standards", label: "Standards", Icon: IconStandards, adminOnly: true };
const NAV_ANALYTICS: NavItem = { href: "/app/operations-analytics", label: "Analytics", Icon: IconReports, adminOnly: true };
const NAV_SETTINGS: NavItem = { href: "/app/settings", label: "Settings", Icon: IconSettings };

function fieldSections(role: Role): NavSection[] {
  if (role === "tech") {
    return [
      { label: "Field", items: [NAV_TODAY, NAV_DAY_REVIEW] },
      { label: "", items: [NAV_SETTINGS] },
    ];
  }

  return [
    { label: "Command", items: [NAV_COMMAND, NAV_MAP, NAV_JOBS, NAV_WORKFORCE, NAV_ANALYTICS, NAV_CONSOLE] },
    { label: "My work", items: [NAV_TODAY, NAV_DAY_REVIEW] },
    { label: "Operations", items: [NAV_WORK_ORDERS, NAV_VISITS, NAV_SCHEDULE, NAV_TRACKING, NAV_SITES] },
    
    { label: "Quality & Standards", items: [NAV_STANDARDS] },
    { label: "Assets & Supply", items: [NAV_MATERIALS, NAV_ASSETS] },
    
    { label: "", items: [NAV_SETTINGS] },
  ];
}

export function getNavSections(role: Role, _view: "office" | "field" = "field"): NavSection[] {
  return fieldSections(role);
}

/** Compatibility seam for older navigation tests. Sorted uses a hamburger on mobile. */
export function getBottomNavItems(role: Role): NavItem[] {
  return role === "tech" ? [NAV_TODAY, NAV_DAY_REVIEW] : [NAV_COMMAND, NAV_JOBS, NAV_SCHEDULE, NAV_WORKFORCE];
}

export function isNavActive(pathname: string, href: string, activePrefixes?: string[]): boolean {
  if (activePrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))) return true;
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(href + "/");
}

interface AppShellProps {
  role: Role;
  userName?: string;
  reviewPending?: boolean;
  children: ReactNode;
}

export function AppShell({ role, userName, reviewPending, children }: AppShellProps) {
  const pathname = usePathname();
  const sections = getNavSections(role);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const isAdminOrOwner = role === "owner" || role === "admin";
  const { summary: attention, refresh: refreshAttention } = useAttentionSummary(isAdminOrOwner);

  useEffect(() => {
    if (localStorage.getItem("p7-sidebar-collapsed") === "true") setCollapsed(true);
    const saved = localStorage.getItem("titan-theme");
    const preferred = saved === "light" || saved === "dark" ? saved : "dark";
    setTheme(preferred);
    document.documentElement.dataset.theme = preferred;
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    if (isAdminOrOwner) void refreshAttention();
  }, [pathname, isAdminOrOwner, refreshAttention]);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("p7-sidebar-collapsed", String(next));
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("titan-theme", next);
    document.documentElement.dataset.theme = next;
  }

  const avatarLetter = userName ? userName[0].toUpperCase() : role[0].toUpperCase();
  const displayName = userName || "Account";
  const homeHref = role === "tech" ? "/app/my-work" : "/app/activity";
  const currentItem = sections.flatMap((section) => section.items).find((item) => isNavActive(pathname, item.href, item.activePrefixes));
  const currentLabel = currentItem?.label ?? "Field";

  const nav = (mobile = false) => (
    <nav className={mobile ? "tg-mobile-nav" : "p7-nav"} aria-label={mobile ? "Sorted Field menu" : "Sorted Field navigation"}>
      {sections.map((section, sectionIdx) => (
        <div key={`${section.label}-${sectionIdx}`} className={mobile ? "tg-mobile-nav__section" : undefined}>
          {section.label ? <div className={mobile ? "tg-mobile-nav__label" : "p7-nav-section"}>{section.label}</div> : null}
          {section.items.map((item) => {
            if (item.adminOnly && !isAdminOrOwner) return null;
            const active = isNavActive(pathname, item.href, item.activePrefixes);
            const count = item.href === "/app/day-review" && reviewPending ? 1 : 0;
            return (
              <Link
                key={item.href}
                href={item.href as Route}
                className={`${mobile ? "tg-mobile-nav__item" : "p7-nav-item"} ${active ? "p7-nav-active" : ""}`}
                aria-current={active ? "page" : undefined}
                title={item.label}
                onClick={() => mobile && setDrawerOpen(false)}
              >
                <span className="p7-nav-icon" aria-hidden="true"><item.Icon size={18} /></span>
                <span className="p7-nav-label">{item.label}</span>
                {count ? <NavCountBadge count={count} /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <ToastProvider>
      <LiveRefresh />
      <div className={`p7-layout tg-field-shell ${collapsed ? "p7-layout-collapsed" : ""}`}>
        <aside className="p7-sidebar tg-field-sidebar" aria-label="Sorted Field navigation">
          <div className="tg-sidebar-brand-wrap">
            <Link href={homeHref as Route} className="p7-sidebar-brand tg-field-brand" aria-label="Sorted Field home">
              <img className="tg-field-brand__mark" src="/icons/icon-192.png" alt="" aria-hidden="true" />
              <span className="tg-field-brand__copy">
                <b>Sorted <em>Field</em></b>
                <small>OPERATIONS COMMAND</small>
              </span>
            </Link>
            <button type="button" onClick={toggleCollapse} className="p7-sidebar-toggle-btn" title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
            </button>
          </div>

          
          {nav(false)}

          <div className="p7-sidebar-footer tg-sidebar-footer">
            <div className="p7-user-chip" title={displayName}>
              <div className="p7-user-avatar" aria-hidden="true">{avatarLetter}</div>
              <div className="p7-user-info"><span className="p7-user-name">{displayName}</span><span className="p7-user-role">{role}</span></div>
            </div>
            <button type="button" onClick={toggleTheme} className="p7-theme-toggle"><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><span className="p7-nav-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span></button>
            <LogoutButton />
          </div>
        </aside>

        <header className="tg-mobile-header">
          <button type="button" className="tg-icon-button" onClick={() => setDrawerOpen(true)} aria-label="Open menu"><IconMenu /></button>
          <Link href={homeHref as Route} className="tg-mobile-brand" aria-label="Sorted Field home">
            <img src="/icons/icon-192.png" alt="" aria-hidden="true" />
            <span><b>SORTED</b><small><i /> {CURRENT_TITAN_GO_MODE_META.shortLabel.toUpperCase()} MODE</small></span>
          </Link>
          <div className="tg-mobile-header__actions">
            {isAdminOrOwner ? <AttentionBell summary={attention} onChanged={() => void refreshAttention()} /> : null}
            {isAdminOrOwner ? <NewActionMenu compact /> : null}
          </div>
        </header>

        {drawerOpen ? (
          <>
            <button className="tg-mobile-drawer-backdrop" type="button" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
            <aside className="tg-mobile-drawer" aria-label="Sorted Field menu">
              <div className="tg-mobile-drawer__head">
                <div className="tg-mobile-drawer__brand"><img src="/icons/icon-192.png" alt="" /><span><b>SORTED</b><small>{CURRENT_TITAN_GO_MODE_META.shortLabel.toUpperCase()} MODE · {CURRENT_TITAN_GO_MODE_META.outcome.toUpperCase()}.</small></span></div>
                <button type="button" className="tg-icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close menu"><IconClose /></button>
              </div>
              <div className="tg-mode-banner"><span>Active mode</span><strong><i /> {CURRENT_TITAN_GO_MODE_META.shortLabel}</strong><small>Sorted shows only the field tools available to this account.</small></div>
              {nav(true)}
              <div className="tg-mobile-drawer__footer">
                <div className="p7-user-chip"><div className="p7-user-avatar">{avatarLetter}</div><div className="p7-user-info"><span className="p7-user-name">{displayName}</span><span className="p7-user-role">{role}</span></div></div>
                <button type="button" onClick={toggleTheme} className="p7-theme-toggle"><span>{theme === "dark" ? "☀" : "☾"}</span><span>{theme === "dark" ? "Light mode" : "Dark mode"}</span></button>
                <LogoutButton />
              </div>
            </aside>
          </>
        ) : null}

        <main className={`p7-main ${pathname === "/app" ? "tg-command-main" : ""}`} id="main-content">
          <header className="tg-desktop-topbar">
            <div className="tg-desktop-topbar__context">
              <span className="tg-mode-dot" aria-hidden="true" />
              <strong>Sorted <span className="tg-mode-dot" aria-hidden="true" /> Field</strong>
              <span className="tg-topbar-separator">/</span>
              <span>{currentLabel}</span>
            </div>
            <div className="tg-desktop-topbar__actions">
              <FindButton />
              {isAdminOrOwner ? <AttentionBell summary={attention} onChanged={() => void refreshAttention()} /> : null}
              {isAdminOrOwner ? <NewActionMenu /> : null}
            </div>
          </header>
          {children}
          <div className="tf-shell-assistant"><TitanZeroChat compact /></div>
        </main>
      </div>
      <CommandPalette role={role} />
    </ToastProvider>
  );
}

function FindButton() {
  return (
    <button
      type="button"
      className="tg-find-button"
      onClick={() => window.dispatchEvent(new Event("titan:find"))}
      aria-label="Find Field tools and actions"
      title="Find (Ctrl/⌘ K)"
    >
      <span aria-hidden="true">⌕</span>
      <span>Find</span>
      <kbd>⌘K</kbd>
    </button>
  );
}

function LogoutButton() {
  const [pending, setPending] = useState(false);
  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setPending(false);
    }
  }
  return <button type="button" onClick={handleLogout} disabled={pending} className="p7-logout-btn" aria-label="Sign out" title="Sign out">{pending ? "…" : "Sign out"}</button>;
}
