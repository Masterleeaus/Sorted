import { normalizeStorageContext, type StorageContextInput } from "../storage/contracts.js";

export const OFFLINE_RESILIENCE_PROTOCOL = "titan.offline.native.v1";

export type OfflineCapabilityState =
  | "native"
  | "portable_donor"
  | "browser_adapter_required"
  | "gap";

export type OfflineCapability = Readonly<{
  id: string;
  state: OfflineCapabilityState;
  source: string | null;
  target_pass: number;
  authority_effect: false;
}>;

const CAPABILITIES: readonly OfflineCapability[] = Object.freeze([
  Object.freeze({
    id: "company_checkpoint_storage",
    state: "native",
    source: "packages/titan-platform/src/storage/reconciliation.ts#createCompanyCheckpointFacade",
    target_pass: 1,
    authority_effect: false,
  }),
  Object.freeze({
    id: "restart_checkpoint_contract",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/restart-checkpoint.ts",
    target_pass: 5,
    authority_effect: false,
  }),
  Object.freeze({
    id: "checkpoint_integrity",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/checkpoint-integrity.ts",
    target_pass: 5,
    authority_effect: false,
  }),
  Object.freeze({
    id: "replay_safe_recovery_state_machine",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/recovery-state-machine.ts",
    target_pass: 5,
    authority_effect: false,
  }),
  Object.freeze({
    id: "continuation_guard",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/continuation-guard.ts",
    target_pass: 5,
    authority_effect: false,
  }),
  Object.freeze({
    id: "authority_continuity",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/authority-continuity.ts",
    target_pass: 6,
    authority_effect: false,
  }),
  Object.freeze({
    id: "service_worker_lifecycle",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/service-worker-lifecycle.ts",
    target_pass: 5,
    authority_effect: false,
  }),
  Object.freeze({
    id: "extension_background_bootstrap",
    state: "browser_adapter_required",
    source: "packages/titan-platform/src/ported/background-bootstrap.ts",
    target_pass: 5,
    authority_effect: false,
  }),
  Object.freeze({
    id: "conflict_retry_policy",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/conflict-retry-policy.ts",
    target_pass: 3,
    authority_effect: false,
  }),
  Object.freeze({
    id: "bounded_work_queue",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-reliability/bounded-work-queue.ts",
    target_pass: 3,
    authority_effect: false,
  }),
  Object.freeze({
    id: "retry_budget",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-reliability/retry-budget.ts",
    target_pass: 3,
    authority_effect: false,
  }),
  Object.freeze({
    id: "execution_receipts",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/execution-receipts.ts",
    target_pass: 2,
    authority_effect: false,
  }),
  Object.freeze({
    id: "tab_lease_registry",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/tab-lease-registry.ts",
    target_pass: 8,
    authority_effect: false,
  }),
  Object.freeze({
    id: "restart_evidence_ledger",
    state: "portable_donor",
    source: "packages/titan-platform/src/ported/titan-offline/restart-evidence-ledger.ts",
    target_pass: 5,
    authority_effect: false,
  }),
  Object.freeze({
    id: "durable_mutation_queue",
    state: "gap",
    source: null,
    target_pass: 3,
    authority_effect: false,
  }),
  Object.freeze({
    id: "snapshot_pull_apply_revision_sync",
    state: "gap",
    source: null,
    target_pass: 4,
    authority_effect: false,
  }),
  Object.freeze({
    id: "stale_policy_offline_contraction",
    state: "gap",
    source: null,
    target_pass: 6,
    authority_effect: false,
  }),
  Object.freeze({
    id: "field_media_resumable_sync",
    state: "gap",
    source: null,
    target_pass: 7,
    authority_effect: false,
  }),
  Object.freeze({
    id: "network_transition_duplicate_clock_skew_hardening",
    state: "gap",
    source: null,
    target_pass: 8,
    authority_effect: false,
  }),
]);

export function createOfflineResilienceInventory(contextInput: StorageContextInput) {
  const context = normalizeStorageContext(contextInput);
  const capabilities = CAPABILITIES.map((item) => Object.freeze({ ...item }));
  const counts = Object.freeze({
    native: capabilities.filter((item) => item.state === "native").length,
    portable_donor: capabilities.filter((item) => item.state === "portable_donor").length,
    browser_adapter_required: capabilities.filter((item) => item.state === "browser_adapter_required").length,
    gap: capabilities.filter((item) => item.state === "gap").length,
  });

  return Object.freeze({
    schema: "titan.offline.resilience-inventory.v1",
    protocol: OFFLINE_RESILIENCE_PROTOCOL,
    company_id: context.company_id,
    company_boundary: "company_id" as const,
    device_first: true,
    local_primary: true,
    server_grants_authority: false,
    identity_grants_authority: false,
    execution_authority: false,
    automatic_effect_replay: false,
    extension_background_is_native_authority: false,
    capabilities: Object.freeze(capabilities),
    counts,
  });
}

export function offlineCapabilitiesForPass(pass: number): readonly OfflineCapability[] {
  if (!Number.isInteger(pass) || pass < 1 || pass > 10) {
    throw new Error("Offline resilience pass must be an integer from 1 to 10");
  }
  return Object.freeze(
    CAPABILITIES
      .filter((item) => item.target_pass === pass)
      .map((item) => Object.freeze({ ...item })),
  );
}
