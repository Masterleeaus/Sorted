import type { StorageClient, VerifiedCompanyScope } from "@titan-zero/storage";

export type VerticalPackState = "staged" | "installed" | "disabled" | "retired" | "incompatible";
export type VerticalPack = Readonly<{
  schema: "titan.sprout.vertical-pack.v1";
  pack_id: string;
  version: string;
  label: string;
  state: VerticalPackState;
  company_id: string;
  required_capabilities: readonly string[];
  standards_pack_id: string | null;
  promoted_evidence_refs: readonly string[];
  profile_modules?: readonly Readonly<{ module_id: string; version: string }>[];
}>;

export type CompanyVerticalProfile = Readonly<{
  pack_id: string;
  pack_version: string;
  module_id: string;
  module_version: string;
}>;

function required(value: unknown, field: string): string { const result = String(value ?? "").trim(); if (!result) throw new Error(`${field} is required`); return result; }
function clone<T>(value: T): T { return structuredClone(value); }

export function createVerticalPack(input: Partial<VerticalPack> & { pack_id: string; version: string; label: string; company_id: string }): VerticalPack {
  return Object.freeze({
    schema: "titan.sprout.vertical-pack.v1", pack_id: required(input.pack_id, "pack_id"), version: required(input.version, "version"), label: required(input.label, "label"), company_id: required(input.company_id, "company_id"), state: input.state ?? "staged",
    required_capabilities: Object.freeze([...(input.required_capabilities ?? [])].map((id) => required(id, "required_capability"))),
    standards_pack_id: input.standards_pack_id ? required(input.standards_pack_id, "standards_pack_id") : null,
    promoted_evidence_refs: Object.freeze([...(input.promoted_evidence_refs ?? [])].map((id) => required(id, "evidence_ref"))),
    profile_modules: Object.freeze([...(input.profile_modules ?? [])].map((module) => Object.freeze({
      module_id: required(module.module_id, "profile_module_id"),
      version: required(module.version, "profile_module_version"),
    }))),
  });
}

/** Build the existing Sprout pack descriptor from the authoritative bundle.
 * The bundle remains the only source for module identity, version and
 * capabilities. This helper does not copy the catalogue into company state. */
export function createVerticalPackFromBundle(bundle: unknown, company_id: string, selected_module_id: string): VerticalPack {
  const companyId = required(company_id, "company_id");
  const selectedModuleId = required(selected_module_id, "selected_module_id");
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) throw new Error("vertical-pack-bundle-invalid");
  const source = bundle as any;
  if (source.schema !== "titan-module-bundle/v1" || source.authority?.activation_confers_authority !== false
    || !Array.isArray(source.modules)) throw new Error("vertical-pack-bundle-invalid");
  const selected = source.modules.find((module: any) => module?.id === selectedModuleId);
  if (!selected || selected.authority?.activation_confers_authority !== false) throw new Error("vertical-pack-profile-module-unavailable");
  const profile_modules: Array<{ module_id: string; version: string }> = source.modules.map((module: any) => ({
    module_id: required(module?.id, "module_id"), version: required(module?.version, "module_version"),
  }));
  if (new Set(profile_modules.map(module => module.module_id)).size !== profile_modules.length) throw new Error("vertical-pack-module-duplicate");
  return createVerticalPack({
    pack_id: required(source.id, "bundle.id"), version: required(source.version, "bundle.version"),
    label: required(source.name, "bundle.name"), company_id: companyId, profile_modules,
    required_capabilities: (selected.contributes?.capabilities || []).map((capability: any) => required(capability?.id, "capability_id")),
  });
}

const COMPANY_PROFILE_KEY = "vertical_profile";
const PROFILE_STATE_SCHEMA = "titan.company.vertical-profile.v1";

function parseSettings(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value ?? {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("company-settings-invalid");
  return parsed as Record<string, unknown>;
}

function storedProfile(value: unknown): CompanyVerticalProfile | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("company-vertical-profile-invalid");
  const profile = value as any;
  return Object.freeze({ pack_id: required(profile.pack_id, "profile.pack_id"), pack_version: required(profile.pack_version, "profile.pack_version"), module_id: required(profile.module_id, "profile.module_id"), module_version: required(profile.module_version, "profile.module_version") });
}

/** Durable adapter for the canonical Sprout VerticalPackStore owner. It stores
 * only the selected profile descriptor by merging one key into the existing
 * native `companies.settings` row inside the verified company-store consumer.
 * Pack definitions and lifecycle state remain owned by the bundle/module pack
 * source and are never copied into a parallel company registry. */
export function createCompanyVerticalPackProfileAuthority(input: {
  readonly scope: VerifiedCompanyScope;
  /** Pass only the client yielded inside the canonical native company-store consumer. */
  readonly storage: StorageClient;
  /** When available, revalidate the scope/placement before and after the operation. */
  readonly assertCurrent?: () => Promise<void>;
  /** Host-provided role/permission gate for explicit profile changes. */
  readonly authorizeMutation?: (scope: VerifiedCompanyScope) => Promise<void>;
  /** Existing canonical pack owner resolves whether an explicit profile is installed and available. */
  readonly resolveAvailableProfile?: (profile: CompanyVerticalProfile) => Promise<boolean>;
}) {
  if (input?.scope?.kind !== "authenticated") throw new Error("vertical-pack-authenticated-session-required");
  const companyId = required(input.scope.current.company_id, "company_id");
  const storage = input?.storage;
  const assertCurrent = input?.assertCurrent;
  const authorizeMutation = input.authorizeMutation;
  const resolveAvailableProfile = input.resolveAvailableProfile;
  if (!storage || storage.dialect !== "sqlite") throw new Error("vertical-pack-company-storage-provider-unsupported");

  async function transact<T>(operation: (tx: StorageClient, settings: Record<string, unknown>, profile: CompanyVerticalProfile | null, revision: number) => Promise<T>): Promise<T> {
    await assertCurrent?.();
    const result = await storage.transaction(async tx => {
      const row = (await tx.query<{ id: string; settings: unknown }>("SELECT id,settings FROM companies WHERE id=$1", [companyId])).rows[0];
      if (!row || row.id !== companyId) throw new Error("vertical-pack-company-profile-not-found");
      const settings = parseSettings(row.settings);
      const state = settings[COMPANY_PROFILE_KEY] as any;
      if (state != null && (state.schema !== PROFILE_STATE_SCHEMA || state.company_id !== companyId || !Number.isSafeInteger(state.revision) || state.revision < 0)) throw new Error("company-vertical-profile-state-invalid");
      const profile = storedProfile(state?.profile);
      return operation(tx, settings, profile, Number(state?.revision || 0));
    });
    await assertCurrent?.();
    return result;
  }

  async function read() {
    await assertCurrent?.();
    const row = (await storage.query<{ id: string; settings: unknown }>("SELECT id,settings FROM companies WHERE id=$1", [companyId])).rows[0];
    if (!row || row.id !== companyId) throw new Error("vertical-pack-company-profile-not-found");
    const settings = parseSettings(row.settings);
    const state = settings[COMPANY_PROFILE_KEY] as any;
    if (state != null && (state.schema !== PROFILE_STATE_SCHEMA || state.company_id !== companyId || !Number.isSafeInteger(state.revision) || state.revision < 0)) throw new Error("company-vertical-profile-state-invalid");
    const result = Object.freeze({ company_id: companyId, revision: Number(state?.revision || 0), profile: storedProfile(state?.profile) });
    await assertCurrent?.();
    return result;
  }

  async function ensureDefault(pack: VerticalPack | null) {
    if (pack && pack.company_id !== companyId) throw new Error("vertical-pack-company-context-mismatch");
    return transact(async (tx, settings, current, revision) => {
      if (current) {
        if (!pack && current.module_id === "titan.workforce.cleaning") return Object.freeze({ status: "unavailable" as const, profile: current, revision });
        if (current.pack_id === pack?.pack_id) {
          const expectedModule = pack.profile_modules?.find(item => item.module_id === current.module_id);
          const valid = pack.version === current.pack_version && expectedModule?.version === current.module_version;
          return Object.freeze({ status: valid ? "retained" as const : "stale" as const, profile: current, revision });
        }
        return Object.freeze({ status: "retained" as const, profile: current, revision });
      }
      if (!pack) return Object.freeze({ status: "unavailable" as const, profile: null, revision });
      const module = pack.profile_modules?.find(item => item.module_id === "titan.workforce.cleaning");
      if (!module) throw new Error("cleaning-profile-module-required");
      const profile = Object.freeze({ pack_id: pack.pack_id, pack_version: pack.version, module_id: module.module_id, module_version: module.version });
      const nextRevision = revision + 1;
      const next = Object.freeze({ schema: PROFILE_STATE_SCHEMA, company_id: companyId, revision: nextRevision, profile });
      const result = await tx.query("UPDATE companies SET settings=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [JSON.stringify({ ...settings, [COMPANY_PROFILE_KEY]: next }), companyId]);
      if (result.rowCount !== 1) throw new Error("vertical-pack-company-profile-write-failed");
      return Object.freeze({ status: "selected" as const, profile, revision: nextRevision });
    });
  }

  async function select(profileInput: CompanyVerticalProfile, expected_revision: number) {
    if (typeof authorizeMutation !== "function") throw new Error("vertical-pack-profile-mutation-authorization-required");
    if (typeof resolveAvailableProfile !== "function") throw new Error("vertical-pack-profile-availability-resolver-required");
    await authorizeMutation(input.scope);
    const profile = storedProfile(profileInput);
    if (!profile || !await resolveAvailableProfile(profile)) throw new Error("vertical-pack-profile-not-available");
    if (!Number.isSafeInteger(expected_revision) || expected_revision < 0) throw new Error("vertical-pack-profile-revision-invalid");
    return transact(async (tx, settings, _current, revision) => {
      if (expected_revision !== revision) throw new Error("vertical-pack-profile-revision-mismatch");
      const nextRevision = revision + 1;
      const next = Object.freeze({ schema: PROFILE_STATE_SCHEMA, company_id: companyId, revision: nextRevision, profile });
      const result = await tx.query("UPDATE companies SET settings=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [JSON.stringify({ ...settings, [COMPANY_PROFILE_KEY]: next }), companyId]);
      if (result.rowCount !== 1) throw new Error("vertical-pack-company-profile-write-failed");
      return Object.freeze({ profile, revision: nextRevision });
    });
  }

  return Object.freeze({ schema: "titan.sprout.company-vertical-pack-profile-authority.v1", company_id: companyId, read, ensureDefault, select, authority_granted: false, execution_permitted: false });
}

export class VerticalPackStore {
  #company_id: string;
  #packs = new Map<string, VerticalPack>();
  #permanentEvidence = new Set<string>();
  constructor(company_id: string, permanentEvidenceRefs: readonly string[] = []) { this.#company_id = required(company_id, "company_id"); permanentEvidenceRefs.forEach((ref) => this.#permanentEvidence.add(required(ref, "evidence_ref"))); }
  get packs(): readonly VerticalPack[] { return Object.freeze([...this.#packs.values()].map(clone)); }
  preview(pack: VerticalPack): VerticalPack { this.assertCompany(pack); if (this.#packs.has(pack.pack_id) && this.#packs.get(pack.pack_id)?.version === pack.version) throw new Error("vertical-pack-version-already-installed"); return Object.freeze({ ...pack, state: "staged" }); }
  install(pack: VerticalPack): VerticalPack { const staged = this.preview(pack); const installed = Object.freeze({ ...staged, state: "installed" as const }); this.#packs.set(installed.pack_id, installed); return installed; }
  upgrade(pack: VerticalPack): VerticalPack { this.assertCompany(pack); const previous = this.#packs.get(pack.pack_id); if (!previous || previous.state === "retired") throw new Error("vertical-pack-upgrade-target-missing"); if (previous.version === pack.version) throw new Error("vertical-pack-version-already-installed"); const upgraded = Object.freeze({ ...pack, state: "installed" as const }); this.#packs.set(upgraded.pack_id, upgraded); return upgraded; }
  disable(pack_id: string): VerticalPack { const pack = this.get(pack_id); const next = Object.freeze({ ...pack, state: "disabled" as const }); this.#packs.set(pack_id, next); return next; }
  retire(pack_id: string): VerticalPack { const pack = this.get(pack_id); const next = Object.freeze({ ...pack, state: "retired" as const, promoted_evidence_refs: Object.freeze([...pack.promoted_evidence_refs]) }); this.#packs.set(pack_id, next); return next; }
  hasPermanentEvidence(ref: string): boolean { return this.#permanentEvidence.has(ref); }
  private get(pack_id: string): VerticalPack { const pack = this.#packs.get(required(pack_id, "pack_id")); if (!pack) throw new Error("vertical-pack-not-installed"); return pack; }
  private assertCompany(pack: VerticalPack): void { if (pack.company_id !== this.#company_id) throw new Error("vertical-pack-company-context-mismatch"); }
}

