export type ExperienceThemeMode = "system" | "light" | "dark";
export type ExperienceProfile = "owner" | "manager" | "server_admin" | "reseller" | "developer";
export type ExperienceSurface = "desktop" | "tablet" | "mobile";

export type ExperienceTokens = Readonly<{
  background: string; foreground: string; muted: string; surface: string; elevated_surface: string;
  primary: string; primary_foreground: string; success: string; warning: string; danger: string; focus: string;
  density: "comfortable" | "compact";
}>;

export type ExperienceThemePack = Readonly<{
  schema: "titan.experience.theme-pack.v1"; id: string; version: string; mode: ExperienceThemeMode;
  tokens: ExperienceTokens; generated_by: "titan-experience";
}>;

export type ExperienceContribution = Readonly<{
  id: string; label: string; group: "business" | "create" | "intelligence" | "system" | "platform";
  state: "installed" | "missing" | "incompatible" | "degraded" | "disabled"; href?: string;
}>;

export type ExperienceWorkspacePreset = Readonly<{
  id: string; label: string; profile: ExperienceProfile; widget_refs: readonly string[];
  grid: Readonly<Record<ExperienceSurface, number>>; sdk_version: string;
}>;

export type ExperiencePreferences = Readonly<{
  mode: ExperienceThemeMode; density: "comfortable" | "compact"; reduced_motion: boolean;
  collapsed_navigation: boolean; text_scale: number;
}>;

export type ExperiencePresentation = Readonly<{
  schema: "titan.experience.presentation.v1"; company_id: string; profile: ExperienceProfile;
  theme: ExperienceThemePack; preferences: ExperiencePreferences;
  navigation: readonly Readonly<{ group: ExperienceContribution["group"]; items: readonly ExperienceContribution[] }>[];
  preset: ExperienceWorkspacePreset; authority: "presentation-only"; business_writes: false;
}>;

const DEFAULT_TOKENS: ExperienceTokens = Object.freeze({
  background: "#f8fafc", foreground: "#0f172a", muted: "#475569", surface: "#ffffff", elevated_surface: "#f1f5f9",
  primary: "#2563eb", primary_foreground: "#ffffff", success: "#059669", warning: "#b45309", danger: "#dc2626",
  focus: "#2563eb", density: "comfortable",
});
const GROUP_ORDER: readonly ExperienceContribution["group"][] = ["business", "create", "intelligence", "system", "platform"];
const PROFILE_DEFAULTS: Readonly<Record<ExperienceProfile, readonly string[]>> = Object.freeze({
  owner: ["today", "business"], manager: ["today", "workforce", "attention"],
  server_admin: ["operations", "health", "security"], reseller: ["portfolio", "business"], developer: ["diagnostics", "developer"],
});

function nonEmpty(value: unknown, field: string): string { const result = String(value ?? "").trim(); if (!result) throw new Error(`${field} is required`); return result; }
function hex(value: unknown, fallback: string): string { const result = String(value ?? "").trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(result) ? result : fallback; }
function assertSafeText(value: unknown, field: string): void {
  if (typeof value === "string" && /<\/?script|javascript:|data:text\/html|\beval\s*\(|\bfunction\s*\(/i.test(value)) throw new Error(`executable-content-rejected:${field}`);
}
function assertNoExecutableContent(value: unknown, path = "pack"): void {
  if (typeof value === "string") { assertSafeText(value, path); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoExecutableContent(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(script|html|javascript|executable|handler|on[a-z]+)$/i.test(key)) throw new Error(`executable-content-rejected:${path}.${key}`);
    assertNoExecutableContent(item, `${path}.${key}`);
  }
}

export function createThemePack(input: Partial<ExperienceThemePack> & { id: string; version: string; mode?: ExperienceThemeMode; tokens?: Partial<ExperienceTokens> }): ExperienceThemePack {
  assertNoExecutableContent(input);
  const mode = input.mode === "light" || input.mode === "dark" || input.mode === "system" ? input.mode : "system";
  const tokens = { ...DEFAULT_TOKENS, ...(input.tokens ?? {}) };
  return Object.freeze({ schema: "titan.experience.theme-pack.v1", id: nonEmpty(input.id, "theme id"), version: nonEmpty(input.version, "theme version"), mode, generated_by: "titan-experience", tokens: Object.freeze({
    ...tokens, background: hex(tokens.background, DEFAULT_TOKENS.background), foreground: hex(tokens.foreground, DEFAULT_TOKENS.foreground), muted: hex(tokens.muted, DEFAULT_TOKENS.muted), surface: hex(tokens.surface, DEFAULT_TOKENS.surface), elevated_surface: hex(tokens.elevated_surface, DEFAULT_TOKENS.elevated_surface), primary: hex(tokens.primary, DEFAULT_TOKENS.primary), primary_foreground: hex(tokens.primary_foreground, DEFAULT_TOKENS.primary_foreground), success: hex(tokens.success, DEFAULT_TOKENS.success), warning: hex(tokens.warning, DEFAULT_TOKENS.warning), danger: hex(tokens.danger, DEFAULT_TOKENS.danger), focus: hex(tokens.focus, DEFAULT_TOKENS.focus), density: tokens.density === "compact" ? "compact" : "comfortable",
  }) });
}

export function validateThemePack(input: unknown): true {
  assertNoExecutableContent(input);
  if (!input || typeof input !== "object" || (input as { schema?: unknown }).schema !== "titan.experience.theme-pack.v1") throw new Error("invalid-theme-pack-schema");
  const pack = input as Partial<ExperienceThemePack>; nonEmpty(pack.id, "theme id"); nonEmpty(pack.version, "theme version");
  if (!pack.tokens || typeof pack.tokens !== "object") throw new Error("theme tokens are required"); return true;
}

export function defaultWorkspacePreset(profile: ExperienceProfile, sdk_version = "1.0.0"): ExperienceWorkspacePreset {
  return Object.freeze({ id: `titan-experience-${profile}`, label: `${profile.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase())} workspace`, profile, widget_refs: Object.freeze([...PROFILE_DEFAULTS[profile]]), grid: Object.freeze({ desktop: 12, tablet: 8, mobile: 4 }), sdk_version: nonEmpty(sdk_version, "sdk version") });
}

export function composeExperiencePresentation(input: { company_id: string; profile: ExperienceProfile; theme?: ExperienceThemePack; preferences?: Partial<ExperiencePreferences>; contributions?: readonly ExperienceContribution[]; preset?: ExperienceWorkspacePreset }): ExperiencePresentation {
  const company_id = nonEmpty(input.company_id, "company_id"); if (!PROFILE_DEFAULTS[input.profile]) throw new Error("invalid-experience-profile");
  const theme = input.theme ?? createThemePack({ id: "titan-zero-cockpit", version: "1.0.0", mode: "system" }); validateThemePack(theme);
  const preferences = Object.freeze({ mode: input.preferences?.mode === "light" || input.preferences?.mode === "dark" ? input.preferences.mode : "system", density: input.preferences?.density === "compact" ? "compact" : theme.tokens.density, reduced_motion: input.preferences?.reduced_motion === true, collapsed_navigation: input.preferences?.collapsed_navigation === true, text_scale: Math.min(2, Math.max(0.8, Number(input.preferences?.text_scale ?? 1))) });
  const navigation = GROUP_ORDER.map((group) => Object.freeze({ group, items: Object.freeze((input.contributions ?? []).filter((item) => item.group === group).sort((a, b) => a.label.localeCompare(b.label))) })).filter((section) => section.items.length > 0);
  return Object.freeze({ schema: "titan.experience.presentation.v1", company_id, profile: input.profile, theme, preferences, navigation: Object.freeze(navigation), preset: input.preset ?? defaultWorkspacePreset(input.profile), authority: "presentation-only", business_writes: false });
}

export class ExperiencePresentationStore {
  #current: ExperiencePresentation; #history: ExperiencePresentation[] = [];
  constructor(initial: ExperiencePresentation) { this.#current = initial; }
  get current(): ExperiencePresentation { return this.#current; }
  get historyLength(): number { return this.#history.length; }
  preview(next: ExperiencePresentation): ExperiencePresentation { if (next.company_id !== this.#current.company_id) throw new Error("experience-company-context-mismatch"); return next; }
  apply(next: ExperiencePresentation): ExperiencePresentation { this.preview(next); this.#history.push(this.#current); this.#current = next; return this.#current; }
  rollback(): ExperiencePresentation { const previous = this.#history.pop(); if (!previous) throw new Error("experience-no-known-good-version"); this.#current = previous; return this.#current; }
}

