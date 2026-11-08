import type { Role } from "@ai-fsm/domain";

export type CommandItem = {
  id: string;
  label: string;
  href: string;
  keywords: string;
  roles: Role[];
};

const OWNER_ADMIN: Role[] = ["owner", "admin"];
const FIELD_ROLES: Role[] = ["owner", "admin", "tech"];

/**
 * Titan Go's Field-mode command index. Build, Desk and Pay destinations are
 * intentionally excluded from this product surface even when legacy routes
 * remain in the monorepo for compatibility and handoff flows.
 */
export const COMMAND_INDEX: CommandItem[] = [
  { id: "command", label: "Command", href: "/app", keywords: "zero command field home operations", roles: OWNER_ADMIN },
  { id: "today", label: "Today", href: "/app/my-work", keywords: "today field work active jobs my day", roles: FIELD_ROLES },
  { id: "day-review", label: "Day Review", href: "/app/day-review", keywords: "day review close end shift", roles: FIELD_ROLES },
  { id: "tracking", label: "Tracking", href: "/app/timeline", keywords: "tracking timeline gps vehicle mileage travel", roles: OWNER_ADMIN },
  { id: "capture", label: "Capture", href: "/app/capture", keywords: "capture field note evidence promise photo voice", roles: OWNER_ADMIN },
  { id: "jobs", label: "Jobs", href: "/app/jobs", keywords: "jobs projects field delivery", roles: OWNER_ADMIN },
  { id: "work-orders", label: "Work Orders", href: "/app/work-orders", keywords: "work orders tasks scope", roles: OWNER_ADMIN },
  { id: "visits", label: "Visits", href: "/app/visits", keywords: "visits appointments stops field", roles: OWNER_ADMIN },
  { id: "schedule", label: "Schedule", href: "/app/schedule", keywords: "schedule calendar dispatch assignment", roles: OWNER_ADMIN },
  { id: "sites", label: "Sites", href: "/app/properties", keywords: "sites properties locations access service locations", roles: OWNER_ADMIN },
  { id: "workforce", label: "Workforce", href: "/app/workforce", keywords: "workforce manager specialist worker people runtime agents", roles: OWNER_ADMIN },
  { id: "materials", label: "Materials", href: "/app/materials", keywords: "materials consumables supplies stock", roles: OWNER_ADMIN },
  { id: "quick-materials", label: "Quick materials", href: "/app/materials/quick", keywords: "materials shopping purchase list", roles: OWNER_ADMIN },
  { id: "assets", label: "Assets", href: "/app/assets", keywords: "assets equipment tools custody readiness", roles: OWNER_ADMIN },
  { id: "standards", label: "Standards", href: "/app/standards", keywords: "standards sop quality safety compliance training audit", roles: OWNER_ADMIN },
  { id: "analytics", label: "Operations Analytics", href: "/app/operations-analytics", keywords: "analytics capacity utilisation completion performance predictive", roles: OWNER_ADMIN },
  { id: "mileage", label: "Mileage", href: "/app/mileage", keywords: "mileage travel vehicle km miles", roles: OWNER_ADMIN },
  { id: "vehicles", label: "Vehicles", href: "/app/mileage/vehicles", keywords: "vehicles fleet maintenance fuel", roles: OWNER_ADMIN },
  { id: "settings", label: "Settings", href: "/app/settings", keywords: "settings titan go team company field setup", roles: FIELD_ROLES },
  { id: "system-health", label: "System Health", href: "/app/settings/system-health", keywords: "health diagnostics system integrations", roles: OWNER_ADMIN },
];

export function filterCommands(query: string, role: Role, index: CommandItem[] = COMMAND_INDEX): CommandItem[] {
  const forRole = index.filter((item) => item.roles.includes(role));
  const q = query.trim().toLowerCase();
  if (!q) return forRole;
  return forRole.filter((item) => {
    const hay = `${item.label} ${item.keywords} ${item.href}`.toLowerCase();
    return hay.includes(q);
  });
}
