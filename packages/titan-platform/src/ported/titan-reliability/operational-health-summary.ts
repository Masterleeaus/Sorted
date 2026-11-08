// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-reliability/operational-health-summary.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const clean = value => String(value ?? '').trim();
const STATUS_RANK = Object.freeze({ healthy:0, unknown:1, degraded:2, unhealthy:3, unavailable:4, blocked:5 });
const normalizeStatus = value => {
  const status = clean(value).toLowerCase();
  if (status in STATUS_RANK) return status;
  if (['ok','ready','available','online','active'].includes(status)) return 'healthy';
  if (['warn','warning','partial','slow'].includes(status)) return 'degraded';
  if (['error','failed','failure','down'].includes(status)) return 'unhealthy';
  if (['missing','offline','disconnected'].includes(status)) return 'unavailable';
  return 'unknown';
};
const freeze = value => Object.freeze(value);
const arr = value => Array.isArray(value) ? value : [];

function assertCompany(expected, actual, source) {
  const id = clean(actual);
  if (id && expected && id !== expected) throw new Error(`cross-company:${source}`);
  return id || expected || null;
}

function severity(status) { return STATUS_RANK[normalizeStatus(status)] ?? STATUS_RANK.unknown; }
function worse(a,b) { return severity(a) >= severity(b) ? normalizeStatus(a) : normalizeStatus(b); }

function attentionItem({ id, source, status, reason=null, detail=null, retry_after_ms=null }) {
  return freeze({
    id: clean(id) || `${source}:unknown`,
    source: clean(source) || 'unknown',
    status: normalizeStatus(status),
    reason: clean(reason) || null,
    detail: clean(detail) || null,
    retry_after_ms: Number.isFinite(Number(retry_after_ms)) ? Math.max(0, Number(retry_after_ms)) : null,
    executable: false,
    grants_authority: false,
  });
}

export function buildOperationalHealthSummary({
  company_id,
  observability = null,
  dependency_health = null,
  degradation_plans = [],
  backpressure = null,
  lifecycle = null,
  circuits = [],
  startup_recovery = null,
  retry_budget = null,
  recovery_journal = null,
  load_shedding = null,
  deadline_budget = null,
  bulkhead = null,
  duplicate_effect_guard = null,
  stalled_operations = null,
  state_integrity = null,
  concurrency_plan = null,
  clock_skew = null,
  poison_work = null,
  fanout_plan = null,
  lease_guard = null,
  partial_batch = null,
  recovery_attempt_budget = null,
  duplicate_lease_ownership = null,
  recovery_state_drift = null,
  orphan_child_work = null,
  dependency_snapshot_freshness = null,
  completion_order = null,
  diagnostic_cardinality = null,
  terminal_state_regression = null,
  recovery_checkpoint = null,
  dependency_cycle = null,
  causality_gap = null,
  quorum_consistency = null,
  recovery_plan_expiry = null,
  authority_snapshot_freshness = null,
  recovery_plan_replay = null,
  rollback_target_drift = null,
  split_brain_recovery = null,
  superseded_plan = null,
  evidence_window = null,
  recovery_fencing_token = null,
  recovery_decision_epoch = null,
  quorum_member_identity = null,
  recovery_membership_churn = null,
  decision_execution_staleness = null,
  rollback_dependency_invalidation = null,
  recovery_intent_effect_match = null,
  recovery_approval_freshness = null,
  rollback_scope_expansion = null,
  recovery_approval_subject_drift = null,
  rollback_evidence_mutation = null,
  recovery_execution_owner_match = null,
  recovery_approval_parameter_drift = null,
  rollback_target_identity_drift = null,
  execution_environment_drift = null,
  generated_at = Date.now(),
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const attention = [];
  let overall = 'healthy';

  if (observability) {
    assertCompany(companyId, observability.company_id, 'observability');
    overall = worse(overall, observability.status);
    const probes = observability.probes && typeof observability.probes === 'object' ? Object.values(observability.probes) : [];
    for (const probe of probes) {
      const status = normalizeStatus(probe?.status);
      if (status === 'healthy') continue;
      attention.push(attentionItem({
        id: probe?.id || probe?.component,
        source: 'observability',
        status,
        reason: probe?.error || probe?.details?.reason || probe?.criticality,
        detail: probe?.component,
      }));
    }
  }

  if (dependency_health) {
    assertCompany(companyId, dependency_health.company_id, 'dependency-health');
    if (dependency_health.mixed_company_input) throw new Error('cross-company:dependency-health-set');
    overall = worse(overall, dependency_health.status);
    const dependencies = dependency_health.dependencies && typeof dependency_health.dependencies === 'object'
      ? Object.values(dependency_health.dependencies) : [];
    for (const dep of dependencies) {
      assertCompany(companyId, dep?.company_id, `dependency:${dep?.dependency_id || 'unknown'}`);
      const status = normalizeStatus(dep?.status);
      if (status === 'healthy') continue;
      attention.push(attentionItem({
        id: dep?.dependency_id,
        source: 'dependency',
        status,
        reason: dep?.reason_code,
        detail: dep?.retry_hint,
      }));
    }
  }

  const plans = arr(degradation_plans);
  let blockedOperations = 0;
  let offlineQueuedOperations = 0;
  for (const plan of plans) {
    assertCompany(companyId, plan?.company_id, 'degradation-plan');
    if (plan?.fail_closed) {
      blockedOperations += 1;
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: plan?.operation_id || plan?.correlation_id,
        source: 'degradation',
        status: 'blocked',
        reason: plan?.dependency_reason_code || 'fail_closed',
        detail: plan?.dependency_kind,
        retry_after_ms: plan?.retry_after_ms,
      }));
    } else if (plan?.degraded) {
      overall = worse(overall, 'degraded');
    }
    if (plan?.durable_offline_queue_permitted) offlineQueuedOperations += 1;
  }

  let backpressureStatus = 'healthy';
  if (backpressure) {
    const rejected = Math.max(0, Number(backpressure.rejected || 0));
    const saturated = backpressure.saturated === true;
    const depth = Math.max(0, Number(backpressure.depth || 0));
    const highWater = Math.max(0, Number(backpressure.highWater || 0));
    if (rejected > 0 || saturated) backpressureStatus = 'unhealthy';
    else if (depth > 0 || highWater > 0) backpressureStatus = 'degraded';
    overall = worse(overall, backpressureStatus);
    if (backpressureStatus !== 'healthy') attention.push(attentionItem({
      id: 'runtime-backpressure', source: 'backpressure', status: backpressureStatus,
      reason: rejected > 0 ? 'work_rejected' : saturated ? 'queue_saturated' : 'queue_active',
      detail: `depth=${depth};highWater=${highWater};rejected=${rejected}`,
    }));
  }

  let circuitStatus = 'healthy';
  for (const circuit of arr(circuits)) {
    assertCompany(companyId, circuit?.company_id, `circuit:${circuit?.dependency_id || 'unknown'}`);
    const state = clean(circuit?.state).toLowerCase();
    if (state === 'open') {
      circuitStatus = 'unhealthy';
      overall = worse(overall, 'unhealthy');
      attention.push(attentionItem({
        id: circuit?.dependency_id, source: 'circuit-breaker', status: 'unhealthy',
        reason: 'circuit_open', detail: `failures=${Math.max(0, Number(circuit?.consecutive_failures || 0))}`,
      }));
    } else if (state === 'half_open') {
      circuitStatus = worse(circuitStatus, 'degraded');
      overall = worse(overall, 'degraded');
      attention.push(attentionItem({
        id: circuit?.dependency_id, source: 'circuit-breaker', status: 'degraded',
        reason: 'half_open_probe', detail: 'dependency_recovery_probe',
      }));
    }
  }

  let startupRecoveryStatus = 'healthy';
  if (startup_recovery) {
    assertCompany(companyId, startup_recovery.company_id, 'startup-recovery');
    if (startup_recovery.ready === false) {
      startupRecoveryStatus = 'blocked';
      overall = worse(overall, 'blocked');
      for (const operationId of arr(startup_recovery.blocked_operation_ids)) attention.push(attentionItem({
        id: operationId, source: 'startup-recovery', status: 'blocked',
        reason: 'startup_recovery_blocked', detail: arr(startup_recovery.critical_dependency_ids).join(',') || null,
      }));
    }
  }

  let retryBudgetStatus = 'healthy';
  if (retry_budget) {
    assertCompany(companyId, retry_budget.company_id, 'retry-budget');
    const tokens = Math.max(0, Number(retry_budget.tokens || 0));
    const rejected = Math.max(0, Number(retry_budget.rejected || 0));
    if (tokens <= 0 || rejected > 0) {
      retryBudgetStatus = 'unhealthy';
      overall = worse(overall, 'unhealthy');
      attention.push(attentionItem({
        id: 'retry-budget', source: 'retry-budget', status: 'unhealthy',
        reason: tokens <= 0 ? 'retry_budget_exhausted' : 'retry_rejections_observed',
        detail: `tokens=${tokens};rejected=${rejected}`,
      }));
    }
  }

  let recoveryJournalStatus = 'healthy';
  if (recovery_journal) {
    assertCompany(companyId, recovery_journal.company_id, 'recovery-journal');
    const quarantineIds = arr(recovery_journal.quarantine_ids);
    if (quarantineIds.length) {
      recoveryJournalStatus = 'blocked';
      overall = worse(overall, 'blocked');
      for (const operationId of quarantineIds) attention.push(attentionItem({
        id: operationId, source: 'recovery-journal', status: 'blocked',
        reason: 'recovery_entry_quarantined', detail: 'explicit_recovery_required',
      }));
    }
  }

  let loadSheddingStatus = 'healthy';
  if (load_shedding) {
    assertCompany(companyId, load_shedding.company_id, 'load-shedding');
    const shedIds = arr(load_shedding.shed_ids);
    if (shedIds.length) {
      loadSheddingStatus = Number(load_shedding.authority_sensitive_shed_count || 0) > 0 ? 'unhealthy' : 'degraded';
      overall = worse(overall, loadSheddingStatus);
      attention.push(attentionItem({
        id: 'load-shedding', source: 'load-shedding', status: loadSheddingStatus,
        reason: 'requests_shed', detail: `count=${shedIds.length}`,
      }));
    }
  }


  let deadlineStatus = 'healthy';
  if (deadline_budget) {
    assertCompany(companyId, deadline_budget.company_id, 'deadline-budget');
    if (deadline_budget.allowed === false || clean(deadline_budget.reason) === 'deadline_expired') {
      deadlineStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: deadline_budget.operation_id || 'deadline-budget', source: 'deadline-budget', status: 'blocked',
        reason: clean(deadline_budget.reason) || 'deadline_expired', detail: 'operation_deadline_exhausted',
      }));
    }
  }

  let bulkheadStatus = 'healthy';
  if (bulkhead) {
    assertCompany(companyId, bulkhead.company_id, 'bulkhead');
    const rejectedIds = arr(bulkhead.rejected_ids);
    if (rejectedIds.length) {
      bulkheadStatus = 'degraded';
      overall = worse(overall, 'degraded');
      attention.push(attentionItem({
        id: 'bulkhead', source: 'bulkhead', status: 'degraded', reason: 'partition_saturated',
        detail: `rejected=${rejectedIds.length}`,
      }));
    }
  }

  let duplicateEffectStatus = 'healthy';
  if (duplicate_effect_guard) {
    assertCompany(companyId, duplicate_effect_guard.company_id, 'duplicate-effect-guard');
    if (duplicate_effect_guard.safe_to_execute === false) {
      duplicateEffectStatus = 'blocked';
      overall = worse(overall, 'blocked');
      const ids = [
        ...arr(duplicate_effect_guard.duplicate_operation_ids),
        ...arr(duplicate_effect_guard.conflict_operation_ids),
        ...arr(duplicate_effect_guard.missing_key_operation_ids),
      ];
      attention.push(attentionItem({
        id: ids[0] || 'duplicate-effect-guard', source: 'duplicate-effect-guard', status: 'blocked',
        reason: arr(duplicate_effect_guard.conflict_operation_ids).length ? 'idempotency_conflict' : 'duplicate_or_missing_idempotency',
        detail: `affected=${ids.length}`,
      }));
    }
  }

  let stalledOperationStatus = 'healthy';
  if (stalled_operations) {
    assertCompany(companyId, stalled_operations.company_id, 'stalled-operations');
    const stalledIds = arr(stalled_operations.stalled_ids);
    const blockedIds = arr(stalled_operations.blocked_authority_ids);
    if (stalledIds.length) {
      stalledOperationStatus = blockedIds.length ? 'blocked' : 'degraded';
      overall = worse(overall, stalledOperationStatus);
      attention.push(attentionItem({
        id: blockedIds[0] || stalledIds[0] || 'stalled-operation', source: 'stalled-operation', status: stalledOperationStatus,
        reason: blockedIds.length ? 'authority_sensitive_operation_stalled' : 'operation_stalled',
        detail: `stalled=${stalledIds.length};blocked=${blockedIds.length}`,
      }));
    }
  }

  let stateIntegrityStatus = 'healthy';
  if (state_integrity) {
    assertCompany(companyId, state_integrity.company_id, 'state-integrity');
    const corruptIds = arr(state_integrity.corrupt_ids);
    const missingIds = arr(state_integrity.missing_hash_ids);
    if (corruptIds.length || missingIds.length || state_integrity.safe_to_resume === false) {
      stateIntegrityStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: corruptIds[0] || missingIds[0] || 'state-integrity', source: 'state-integrity', status: 'blocked',
        reason: corruptIds.length ? 'state_integrity_mismatch' : 'state_integrity_unverified',
        detail: `corrupt=${corruptIds.length};unverified=${missingIds.length}`,
      }));
    }
  }

  let concurrencyStatus = 'healthy';
  if (concurrency_plan) {
    assertCompany(companyId, concurrency_plan.company_id, 'concurrency-plan');
    if (clean(concurrency_plan.action).toLowerCase() === 'reduce') {
      concurrencyStatus = 'degraded';
      overall = worse(overall, 'degraded');
      attention.push(attentionItem({
        id: 'adaptive-concurrency', source: 'adaptive-concurrency', status: 'degraded',
        reason: clean(concurrency_plan.reason) || 'concurrency_reduced',
        detail: `current=${Number(concurrency_plan.current_limit)||0};next=${Number(concurrency_plan.next_limit)||0}`,
      }));
    }
  }

  let clockSkewStatus = 'healthy';
  if (clock_skew) {
    assertCompany(companyId, clock_skew.company_id, 'clock-skew');
    const skewedIds = arr(clock_skew.skewed_clock_ids);
    if (clock_skew.safe_for_time_authority === false || skewedIds.length) {
      clockSkewStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: skewedIds[0] || 'clock-skew', source: 'clock-skew', status: 'blocked',
        reason: 'clock_skew_exceeds_budget', detail: `max_abs_skew_ms=${Math.max(0,Number(clock_skew.max_abs_skew_ms)||0)}`,
      }));
    }
  }

  let poisonWorkStatus = 'healthy';
  if (poison_work) {
    assertCompany(companyId, poison_work.company_id, 'poison-work');
    const quarantineIds = arr(poison_work.quarantine_ids);
    const blockedIds = arr(poison_work.blocked_authority_ids);
    if (quarantineIds.length) {
      poisonWorkStatus = blockedIds.length ? 'blocked' : 'degraded';
      overall = worse(overall, poisonWorkStatus);
      attention.push(attentionItem({
        id: blockedIds[0] || quarantineIds[0] || 'poison-work', source: 'poison-work', status: poisonWorkStatus,
        reason: blockedIds.length ? 'authority_sensitive_poison_work' : 'poison_work_quarantined', detail: `quarantined=${quarantineIds.length}`,
      }));
    }
  }

  let fanoutStatus = 'healthy';
  if (fanout_plan) {
    assertCompany(companyId, fanout_plan.company_id, 'fanout-plan');
    const rejectedIds = arr(fanout_plan.rejected_ids);
    if (rejectedIds.length) {
      fanoutStatus = 'degraded';
      overall = worse(overall, 'degraded');
      attention.push(attentionItem({
        id: 'bounded-fanout', source: 'bounded-fanout', status: 'degraded',
        reason: 'fanout_children_rejected', detail: `rejected=${rejectedIds.length}`,
      }));
    }
  }

  let leaseStatus = 'healthy';
  if (lease_guard) {
    assertCompany(companyId, lease_guard.company_id, 'lease-guard');
    if (lease_guard.lease_valid === false || lease_guard.safe_to_continue === false) {
      leaseStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: lease_guard.operation_id || 'lease-guard', source: 'lease-guard', status: 'blocked',
        reason: clean(lease_guard.reason) || 'lease_expired', detail: clean(lease_guard.lease_owner_id) || null,
      }));
    }
  }

  let partialBatchStatus = 'healthy';
  if (partial_batch) {
    assertCompany(companyId, partial_batch.company_id, 'partial-batch');
    if (partial_batch.complete === false || partial_batch.safe_to_finalize === false) {
      partialBatchStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: partial_batch.batch_id || 'partial-batch', source: 'partial-batch', status: 'blocked',
        reason: 'partial_batch_requires_reconciliation',
        detail: `committed=${arr(partial_batch.committed_ids).length};failed=${arr(partial_batch.failed_ids).length};unresolved=${arr(partial_batch.unresolved_ids).length}`,
      }));
    }
  }

  let recoveryAttemptStatus = 'healthy';
  if (recovery_attempt_budget) {
    assertCompany(companyId, recovery_attempt_budget.company_id, 'recovery-attempt-budget');
    if (recovery_attempt_budget.allowed === false) {
      recoveryAttemptStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: recovery_attempt_budget.operation_id || 'recovery-attempt-budget', source: 'recovery-attempt-budget', status: 'blocked',
        reason: clean(recovery_attempt_budget.reason) || 'recovery_attempt_budget_exhausted',
        detail: `remaining=${Math.max(0,Number(recovery_attempt_budget.remaining_attempts)||0)}`,
      }));
    }
  }

  let duplicateLeaseStatus = 'healthy';
  if (duplicate_lease_ownership) {
    assertCompany(companyId, duplicate_lease_ownership.company_id, 'duplicate-lease-ownership');
    if (duplicate_lease_ownership.safe_to_continue === false || duplicate_lease_ownership.duplicate_active_ownership === true) {
      duplicateLeaseStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: duplicate_lease_ownership.operation_id || 'duplicate-lease-ownership', source: 'duplicate-lease-ownership', status: 'blocked',
        reason: clean(duplicate_lease_ownership.reason) || 'duplicate_active_lease_owners', detail: `owners=${arr(duplicate_lease_ownership.active_owner_ids).length}`,
      }));
    }
  }

  let recoveryStateDriftStatus = 'healthy';
  if (recovery_state_drift) {
    assertCompany(companyId, recovery_state_drift.company_id, 'recovery-state-drift');
    if (recovery_state_drift.drift_detected === true || recovery_state_drift.safe_to_resume === false) {
      recoveryStateDriftStatus = 'blocked';
      overall = worse(overall, 'blocked');
      attention.push(attentionItem({
        id: recovery_state_drift.operation_id || 'recovery-state-drift', source: 'recovery-state-drift', status: 'blocked',
        reason: clean(recovery_state_drift.reason) || 'recovery_state_drift',
        detail: `expected=${recovery_state_drift.expected_revision ?? 'unknown'};observed=${recovery_state_drift.observed_revision ?? 'unknown'}`,
      }));
    }
  }

  let orphanChildWorkStatus = 'healthy';
  if (orphan_child_work) {
    assertCompany(companyId, orphan_child_work.company_id, 'orphan-child-work');
    const orphanIds = arr(orphan_child_work.orphan_ids);
    const blockedIds = arr(orphan_child_work.blocked_authority_ids);
    if (orphanIds.length || orphan_child_work.safe_to_continue === false) {
      orphanChildWorkStatus = blockedIds.length ? 'blocked' : 'degraded';
      overall = worse(overall, orphanChildWorkStatus);
      attention.push(attentionItem({
        id: blockedIds[0] || orphanIds[0] || 'orphan-child-work', source: 'orphan-child-work', status: orphanChildWorkStatus,
        reason: blockedIds.length ? 'authority_sensitive_orphan_child_work' : 'orphaned_child_work', detail: `orphaned=${orphanIds.length};blocked=${blockedIds.length}`,
      }));
    }
  }

  let dependencySnapshotStatus = 'healthy';
  if (dependency_snapshot_freshness) {
    assertCompany(companyId, dependency_snapshot_freshness.company_id, 'dependency-snapshot-freshness');
    const staleIds = arr(dependency_snapshot_freshness.stale_dependency_ids);
    const invalidIds = arr(dependency_snapshot_freshness.invalid_dependency_ids);
    if (staleIds.length || invalidIds.length || dependency_snapshot_freshness.safe_to_decide === false) {
      dependencySnapshotStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id: staleIds[0] || invalidIds[0] || 'dependency-snapshot', source:'dependency-snapshot', status:'blocked', reason:'dependency_snapshot_stale_or_invalid', detail:`stale=${staleIds.length};invalid=${invalidIds.length}`}));
    }
  }

  let completionOrderStatus = 'healthy';
  if (completion_order) {
    assertCompany(companyId, completion_order.company_id, 'completion-order');
    const ids = arr(completion_order.out_of_order_operation_ids);
    if (ids.length || completion_order.safe_to_apply === false) {
      completionOrderStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:ids[0] || 'completion-order', source:'completion-order', status:'blocked', reason:'completion_order_violation', detail:`affected=${ids.length}`}));
    }
  }

  let diagnosticCardinalityStatus = 'healthy';
  if (diagnostic_cardinality) {
    assertCompany(companyId, diagnostic_cardinality.company_id, 'diagnostic-cardinality');
    const rejected = arr(diagnostic_cardinality.rejected_keys);
    if (rejected.length) {
      diagnosticCardinalityStatus = 'degraded'; overall = worse(overall, 'degraded');
      attention.push(attentionItem({id:'diagnostic-cardinality', source:'diagnostic-cardinality', status:'degraded', reason:'diagnostic_series_bounded', detail:`rejected=${rejected.length}`}));
    }
  }

  let terminalStateRegressionStatus = 'healthy';
  if (terminal_state_regression) {
    assertCompany(companyId, terminal_state_regression.company_id, 'terminal-state-regression');
    if (terminal_state_regression.regression_detected === true || terminal_state_regression.safe_to_apply === false) {
      terminalStateRegressionStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:terminal_state_regression.operation_id || 'terminal-state', source:'terminal-state-regression', status:'blocked', reason:'terminal_state_regression'}));
    }
  }

  let recoveryCheckpointStatus = 'healthy';
  if (recovery_checkpoint) {
    assertCompany(companyId, recovery_checkpoint.company_id, 'recovery-checkpoint');
    if (recovery_checkpoint.regression_detected === true || recovery_checkpoint.safe_to_commit === false) {
      recoveryCheckpointStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_checkpoint.operation_id || 'recovery-checkpoint', source:'recovery-checkpoint', status:'blocked', reason:'checkpoint_regression'}));
    }
  }

  let dependencyCycleStatus = 'healthy';
  if (dependency_cycle) {
    assertCompany(companyId, dependency_cycle.company_id, 'dependency-cycle');
    const ids = arr(dependency_cycle.cyclic_operation_ids);
    if (ids.length || dependency_cycle.safe_to_schedule === false) {
      dependencyCycleStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:ids[0] || 'dependency-cycle', source:'dependency-cycle', status:'blocked', reason:'dependency_cycle_detected', detail:`affected=${ids.length}`}));
    }
  }

  let causalityGapStatus = 'healthy';
  if (causality_gap) {
    assertCompany(companyId, causality_gap.company_id, 'causality-gap');
    if (causality_gap.safe_to_advance === false || arr(causality_gap.missing_sequences).length) {
      causalityGapStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:'causality-gap', source:'causality-gap', status:'blocked', reason:'missing_causal_sequence', detail:`missing=${arr(causality_gap.missing_sequences).join(',')}`}));
    }
  }
  let quorumConsistencyStatus = 'healthy';
  if (quorum_consistency) {
    assertCompany(companyId, quorum_consistency.company_id, 'quorum-consistency');
    if (quorum_consistency.consistent === false) {
      quorumConsistencyStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:'quorum-consistency', source:'quorum-consistency', status:'blocked', reason:'conflicting_recovery_evidence', detail:`hashes=${arr(quorum_consistency.conflicting_hashes).length}`}));
    }
  }
  let recoveryPlanExpiryStatus = 'healthy';
  if (recovery_plan_expiry) {
    assertCompany(companyId, recovery_plan_expiry.company_id, 'recovery-plan-expiry');
    if (recovery_plan_expiry.expired === true || recovery_plan_expiry.allowed === false) {
      recoveryPlanExpiryStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_plan_expiry.plan_id || 'recovery-plan', source:'recovery-plan-expiry', status:'blocked', reason:'recovery_plan_expired', detail:'fresh_plan_required'}));
    }
  }

  let authoritySnapshotFreshnessStatus = 'healthy';
  if (authority_snapshot_freshness) {
    assertCompany(companyId, authority_snapshot_freshness.company_id, 'authority-snapshot-freshness');
    if (authority_snapshot_freshness.fresh === false || authority_snapshot_freshness.safe_to_consider === false) {
      authoritySnapshotFreshnessStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:'authority-snapshot', source:'authority-snapshot-freshness', status:'blocked', reason:'stale_authority_snapshot', detail: authority_snapshot_freshness.version_match === false ? 'version_mismatch' : 'snapshot_expired'}));
    }
  }
  let recoveryPlanReplayStatus = 'healthy';
  if (recovery_plan_replay) {
    assertCompany(companyId, recovery_plan_replay.company_id, 'recovery-plan-replay');
    if (recovery_plan_replay.replay_detected === true || recovery_plan_replay.allowed === false) {
      recoveryPlanReplayStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_plan_replay.plan_id || 'recovery-plan', source:'recovery-plan-replay', status:'blocked', reason:'recovery_plan_replay_detected'}));
    }
  }
  let rollbackTargetDriftStatus = 'healthy';
  if (rollback_target_drift) {
    assertCompany(companyId, rollback_target_drift.company_id, 'rollback-target-drift');
    if (rollback_target_drift.drift_detected === true || rollback_target_drift.safe_to_rollback === false) {
      rollbackTargetDriftStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:rollback_target_drift.operation_id || 'rollback-target', source:'rollback-target-drift', status:'blocked', reason:'rollback_target_drift'}));
    }
  }

  let splitBrainRecoveryStatus = 'healthy';
  if (split_brain_recovery) {
    assertCompany(companyId, split_brain_recovery.company_id, 'split-brain-recovery');
    if (split_brain_recovery.split_brain_detected === true || split_brain_recovery.safe_to_coordinate === false) {
      splitBrainRecoveryStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:'split-brain-recovery', source:'split-brain-recovery', status:'blocked', reason:'conflicting_active_recovery_leaders', detail:`leaders=${arr(split_brain_recovery.conflicting_leader_ids).join(',')}`}));
    }
  }
  let supersededPlanStatus = 'healthy';
  if (superseded_plan) {
    assertCompany(companyId, superseded_plan.company_id, 'superseded-plan');
    if (superseded_plan.superseded === true || superseded_plan.allowed === false) {
      supersededPlanStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:superseded_plan.plan_id || 'recovery-plan', source:'superseded-plan', status:'blocked', reason:'recovery_plan_superseded', detail:'fresh_plan_required'}));
    }
  }
  let evidenceWindowStatus = 'healthy';
  if (evidence_window) {
    assertCompany(companyId, evidence_window.company_id, 'evidence-window');
    if (evidence_window.complete === false || evidence_window.safe_to_recover === false) {
      evidenceWindowStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:'evidence-window', source:'evidence-window', status:'blocked', reason:'incomplete_causal_evidence', detail:`missing=${arr(evidence_window.missing_ids).length};out_of_window=${arr(evidence_window.out_of_window_ids).length}`}));
    }
  }

  let recoveryFencingTokenStatus = 'healthy';
  if (recovery_fencing_token) {
    assertCompany(companyId, recovery_fencing_token.company_id, 'recovery-fencing-token');
    if (recovery_fencing_token.valid === false || recovery_fencing_token.safe_to_recover === false) {
      recoveryFencingTokenStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_fencing_token.recovery_id || 'recovery-fencing-token', source:'recovery-fencing-token', status:'blocked', reason:clean(recovery_fencing_token.reason) || 'recovery_fencing_token_invalid', detail:'fresh_fencing_token_required'}));
    }
  }
  let recoveryDecisionEpochStatus = 'healthy';
  if (recovery_decision_epoch) {
    assertCompany(companyId, recovery_decision_epoch.company_id, 'recovery-decision-epoch');
    if (recovery_decision_epoch.regression_detected === true || recovery_decision_epoch.safe_to_consider === false) {
      recoveryDecisionEpochStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_decision_epoch.decision_id || 'recovery-decision-epoch', source:'recovery-decision-epoch', status:'blocked', reason:clean(recovery_decision_epoch.reason) || 'recovery_decision_epoch_invalid'}));
    }
  }
  let quorumMemberIdentityStatus = 'healthy';
  if (quorum_member_identity) {
    assertCompany(companyId, quorum_member_identity.company_id, 'quorum-member-identity');
    if (quorum_member_identity.identity_collision_detected === true || quorum_member_identity.safe_to_count_quorum === false) {
      quorumMemberIdentityStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:arr(quorum_member_identity.duplicate_member_ids)[0] || 'quorum-member-identity', source:'quorum-member-identity', status:'blocked', reason:'quorum_member_identity_collision', detail:`duplicates=${arr(quorum_member_identity.duplicate_member_ids).length};missing=${Math.max(0, Number(quorum_member_identity.missing_member_count || 0))}`}));
    }
  }

  let recoveryMembershipChurnStatus = 'healthy';
  if (recovery_membership_churn) {
    assertCompany(companyId, recovery_membership_churn.company_id, 'recovery-membership-churn');
    if (recovery_membership_churn.churn_detected === true || recovery_membership_churn.safe_to_execute === false) {
      recoveryMembershipChurnStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_membership_churn.recovery_id || 'recovery-membership', source:'recovery-membership-churn', status:'blocked', reason:clean(recovery_membership_churn.reason) || 'recovery_membership_changed_after_decision', detail:`added=${arr(recovery_membership_churn.added_member_ids).length};removed=${arr(recovery_membership_churn.removed_member_ids).length}`}));
    }
  }
  let decisionExecutionStalenessStatus = 'healthy';
  if (decision_execution_staleness) {
    assertCompany(companyId, decision_execution_staleness.company_id, 'decision-execution-staleness');
    if (decision_execution_staleness.stale === true || decision_execution_staleness.safe_to_execute === false) {
      decisionExecutionStalenessStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:decision_execution_staleness.decision_id || 'decision-execution', source:'decision-execution-staleness', status:'blocked', reason:clean(decision_execution_staleness.reason) || 'decision_execution_window_invalid', detail:Number.isFinite(Number(decision_execution_staleness.age_ms)) ? `age_ms=${Number(decision_execution_staleness.age_ms)}` : null}));
    }
  }
  let rollbackDependencyInvalidationStatus = 'healthy';
  if (rollback_dependency_invalidation) {
    assertCompany(companyId, rollback_dependency_invalidation.company_id, 'rollback-dependency-invalidation');
    if (rollback_dependency_invalidation.invalidated === true || rollback_dependency_invalidation.safe_to_rollback === false) {
      rollbackDependencyInvalidationStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:rollback_dependency_invalidation.rollback_id || 'rollback-dependency', source:'rollback-dependency-invalidation', status:'blocked', reason:clean(rollback_dependency_invalidation.reason) || 'rollback_dependency_invalidated', detail:`advanced=${arr(rollback_dependency_invalidation.advanced_dependency_ids).length};invalid=${arr(rollback_dependency_invalidation.invalid_evidence_dependency_ids).length}`}));
    }
  }

  let recoveryIntentEffectMatchStatus = 'healthy';
  if (recovery_intent_effect_match) {
    assertCompany(companyId, recovery_intent_effect_match.company_id, 'recovery-intent-effect-match');
    if (recovery_intent_effect_match.mismatch_detected === true || recovery_intent_effect_match.safe_to_execute === false) {
      recoveryIntentEffectMatchStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_intent_effect_match.recovery_id || 'recovery-intent-effect', source:'recovery-intent-effect-match', status:'blocked', reason:clean(recovery_intent_effect_match.reason) || 'recovery_effect_outside_approved_intent', detail:`unapproved=${arr(recovery_intent_effect_match.unapproved_effect_ids).length}`}));
    }
  }
  let recoveryApprovalFreshnessStatus = 'healthy';
  if (recovery_approval_freshness) {
    assertCompany(companyId, recovery_approval_freshness.company_id, 'recovery-approval-freshness');
    if (recovery_approval_freshness.stale === true || recovery_approval_freshness.safe_to_execute === false) {
      recoveryApprovalFreshnessStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_approval_freshness.approval_id || 'recovery-approval', source:'recovery-approval-freshness', status:'blocked', reason:clean(recovery_approval_freshness.reason) || 'recovery_approval_expired', detail:Number.isFinite(Number(recovery_approval_freshness.age_ms)) ? `age_ms=${Number(recovery_approval_freshness.age_ms)}` : null}));
    }
  }
  let rollbackScopeExpansionStatus = 'healthy';
  if (rollback_scope_expansion) {
    assertCompany(companyId, rollback_scope_expansion.company_id, 'rollback-scope-expansion');
    if (rollback_scope_expansion.scope_expanded === true || rollback_scope_expansion.safe_to_rollback === false) {
      rollbackScopeExpansionStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:rollback_scope_expansion.rollback_id || 'rollback-scope', source:'rollback-scope-expansion', status:'blocked', reason:clean(rollback_scope_expansion.reason) || 'rollback_scope_expanded_beyond_authority', detail:`unauthorized=${arr(rollback_scope_expansion.unauthorized_target_ids).length}`}));
    }
  }

  let recoveryApprovalSubjectDriftStatus = 'healthy';
  if (recovery_approval_subject_drift) {
    assertCompany(companyId, recovery_approval_subject_drift.company_id, 'recovery-approval-subject-drift');
    if (recovery_approval_subject_drift.subject_drift_detected === true || recovery_approval_subject_drift.safe_to_execute === false) {
      recoveryApprovalSubjectDriftStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_approval_subject_drift.approval_id || 'recovery-approval-subject', source:'recovery-approval-subject-drift', status:'blocked', reason:clean(recovery_approval_subject_drift.reason) || 'recovery_approval_subject_drift', detail:recovery_approval_subject_drift.execution_subject_id || null}));
    }
  }
  let rollbackEvidenceMutationStatus = 'healthy';
  if (rollback_evidence_mutation) {
    assertCompany(companyId, rollback_evidence_mutation.company_id, 'rollback-evidence-mutation');
    if (rollback_evidence_mutation.mutation_detected === true || rollback_evidence_mutation.safe_to_rollback === false) {
      rollbackEvidenceMutationStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:rollback_evidence_mutation.rollback_id || 'rollback-evidence', source:'rollback-evidence-mutation', status:'blocked', reason:clean(rollback_evidence_mutation.reason) || 'rollback_evidence_set_mutated', detail:`changed=${arr(rollback_evidence_mutation.changed_evidence_ids).length};added=${arr(rollback_evidence_mutation.added_evidence_ids).length};removed=${arr(rollback_evidence_mutation.removed_evidence_ids).length}`}));
    }
  }
  let recoveryExecutionOwnerMatchStatus = 'healthy';
  if (recovery_execution_owner_match) {
    assertCompany(companyId, recovery_execution_owner_match.company_id, 'recovery-execution-owner-match');
    if (recovery_execution_owner_match.owner_mismatch_detected === true || recovery_execution_owner_match.safe_to_execute === false) {
      recoveryExecutionOwnerMatchStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_execution_owner_match.recovery_id || 'recovery-owner', source:'recovery-execution-owner-match', status:'blocked', reason:clean(recovery_execution_owner_match.reason) || 'recovery_execution_owner_mismatch', detail:recovery_execution_owner_match.executing_actor_id || null}));
    }
  }

  let recoveryApprovalParameterDriftStatus = 'healthy';
  if (recovery_approval_parameter_drift) {
    assertCompany(companyId, recovery_approval_parameter_drift.company_id, 'recovery-approval-parameter-drift');
    if (recovery_approval_parameter_drift.parameter_drift_detected === true || recovery_approval_parameter_drift.safe_to_execute === false) {
      recoveryApprovalParameterDriftStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:recovery_approval_parameter_drift.approval_id || 'recovery-approval-parameters', source:'recovery-approval-parameter-drift', status:'blocked', reason:'recovery_approval_parameter_drift', detail:`changed=${arr(recovery_approval_parameter_drift.changed_parameter_paths).length}`}));
    }
  }
  let rollbackTargetIdentityDriftStatus = 'healthy';
  if (rollback_target_identity_drift) {
    assertCompany(companyId, rollback_target_identity_drift.company_id, 'rollback-target-identity-drift');
    if (rollback_target_identity_drift.target_identity_drift_detected === true || rollback_target_identity_drift.safe_to_rollback === false) {
      rollbackTargetIdentityDriftStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:rollback_target_identity_drift.rollback_id || 'rollback-target-identity', source:'rollback-target-identity-drift', status:'blocked', reason:'rollback_target_identity_drift'}));
    }
  }
  let executionEnvironmentDriftStatus = 'healthy';
  if (execution_environment_drift) {
    assertCompany(companyId, execution_environment_drift.company_id, 'execution-environment-drift');
    if (execution_environment_drift.environment_drift_detected === true || execution_environment_drift.safe_to_execute === false) {
      executionEnvironmentDriftStatus = 'blocked'; overall = worse(overall, 'blocked');
      attention.push(attentionItem({id:execution_environment_drift.recovery_id || 'execution-environment', source:'execution-environment-drift', status:'blocked', reason:'execution_environment_drift', detail:`changed=${arr(execution_environment_drift.changed_environment_fields).length}`}));
    }
  }

  let lifecycleStatus = 'healthy';
  if (lifecycle) {
    const failures = arr(lifecycle.failures || lifecycle.issues || lifecycle.findings).filter(item => item && item.status !== 'pass' && item.ok !== true);
    const explicit = normalizeStatus(lifecycle.status);
    lifecycleStatus = explicit !== 'unknown' ? explicit : (failures.length ? 'degraded' : 'healthy');
    overall = worse(overall, lifecycleStatus);
    for (const issue of failures) attention.push(attentionItem({
      id: issue.id || issue.rule || issue.type,
      source: 'lifecycle',
      status: issue.status || 'degraded',
      reason: issue.reason || issue.message,
      detail: issue.file || issue.resource,
    }));
  }

  const sorted = attention.sort((a,b) => severity(b.status) - severity(a.status) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  const counts = sorted.reduce((acc,item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});

  return freeze({
    schema: 'titan.reliability.operational-health-summary.v1',
    company_id: companyId,
    company_boundary: 'company_id',
    generated_at: Number(generated_at),
    status: overall,
    ok: overall === 'healthy',
    attention_count: sorted.length,
    attention_counts: freeze({
      blocked: counts.blocked || 0,
      unavailable: counts.unavailable || 0,
      unhealthy: counts.unhealthy || 0,
      degraded: counts.degraded || 0,
      unknown: counts.unknown || 0,
    }),
    blocked_operations: blockedOperations,
    durable_offline_queued_operations: offlineQueuedOperations,
    backpressure_status: backpressureStatus,
    lifecycle_status: lifecycleStatus,
    circuit_status: circuitStatus,
    startup_recovery_status: startupRecoveryStatus,
    retry_budget_status: retryBudgetStatus,
    recovery_journal_status: recoveryJournalStatus,
    load_shedding_status: loadSheddingStatus,
    deadline_status: deadlineStatus,
    bulkhead_status: bulkheadStatus,
    duplicate_effect_status: duplicateEffectStatus,
    stalled_operation_status: stalledOperationStatus,
    state_integrity_status: stateIntegrityStatus,
    concurrency_status: concurrencyStatus,
    clock_skew_status: clockSkewStatus,
    poison_work_status: poisonWorkStatus,
    fanout_status: fanoutStatus,
    lease_status: leaseStatus,
    partial_batch_status: partialBatchStatus,
    recovery_attempt_status: recoveryAttemptStatus,
    duplicate_lease_status: duplicateLeaseStatus,
    recovery_state_drift_status: recoveryStateDriftStatus,
    orphan_child_work_status: orphanChildWorkStatus,
    dependency_snapshot_status: dependencySnapshotStatus,
    completion_order_status: completionOrderStatus,
    diagnostic_cardinality_status: diagnosticCardinalityStatus,
    terminal_state_regression_status: terminalStateRegressionStatus,
    recovery_checkpoint_status: recoveryCheckpointStatus,
    dependency_cycle_status: dependencyCycleStatus,
    causality_gap_status: causalityGapStatus,
    quorum_consistency_status: quorumConsistencyStatus,
    recovery_plan_expiry_status: recoveryPlanExpiryStatus,
    authority_snapshot_freshness_status: authoritySnapshotFreshnessStatus,
    recovery_plan_replay_status: recoveryPlanReplayStatus,
    rollback_target_drift_status: rollbackTargetDriftStatus,
    split_brain_recovery_status: splitBrainRecoveryStatus,
    superseded_plan_status: supersededPlanStatus,
    evidence_window_status: evidenceWindowStatus,
    recovery_fencing_token_status: recoveryFencingTokenStatus,
    recovery_decision_epoch_status: recoveryDecisionEpochStatus,
    quorum_member_identity_status: quorumMemberIdentityStatus,
    recovery_membership_churn_status: recoveryMembershipChurnStatus,
    decision_execution_staleness_status: decisionExecutionStalenessStatus,
    rollback_dependency_invalidation_status: rollbackDependencyInvalidationStatus,
    recovery_intent_effect_match_status: recoveryIntentEffectMatchStatus,
    recovery_approval_freshness_status: recoveryApprovalFreshnessStatus,
    rollback_scope_expansion_status: rollbackScopeExpansionStatus,
    recovery_approval_subject_drift_status: recoveryApprovalSubjectDriftStatus,
    rollback_evidence_mutation_status: rollbackEvidenceMutationStatus,
    recovery_execution_owner_match_status: recoveryExecutionOwnerMatchStatus,
    recovery_approval_parameter_drift_status: recoveryApprovalParameterDriftStatus,
    rollback_target_identity_drift_status: rollbackTargetIdentityDriftStatus,
    execution_environment_drift_status: executionEnvironmentDriftStatus,
    attention: freeze(sorted),
    advisory_only: true,
    executable_actions: freeze([]),
    non_authoritative: true,
    observability_not_authority: true,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
    authority_effect: false,
  });
}
