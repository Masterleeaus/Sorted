// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/failure-storm.mjs
import { createCircuitBreakerState, recordCircuitResult, canAttemptCircuit } from './circuit-breaker.js';
import { buildStartupRecoveryPlan } from './startup-recovery.js';

export async function runFailureStorm({ company_id, cycles = 10000 } = {}) {
  const companyId = String(company_id ?? '').trim();
  if (!companyId) throw new Error('company_id-required');
  const total = Math.max(1, Math.floor(Number(cycles) || 1));
  let circuit = createCircuitBreakerState({ company_id: companyId, dependency_id: 'network', failure_threshold: 3, reset_timeout_ms: 4, now: 0 });
  let circuitOpenEvents = 0;
  let maxFailures = 0;
  let crossCompanyViolations = 0;
  for (let i = 1; i <= total; i += 1) {
    const gate = canAttemptCircuit(circuit, { company_id: companyId, now: i });
    circuit = gate.next_state;
    if (!gate.allowed) continue;
    const ok = i % 7 === 0;
    circuit = recordCircuitResult(circuit, { ok, company_id: companyId, now: i });
    if (circuit.state === 'open') circuitOpenEvents += 1;
    maxFailures = Math.max(maxFailures, circuit.consecutive_failures);
    const plan = buildStartupRecoveryPlan({
      company_id: companyId,
      dependencies: [{ dependency_id:'network', dependency_kind:'network', company_id:companyId, status: ok ? 'healthy' : 'unhealthy' }],
      circuits: [circuit],
      pending_operations: [{ operation_id:`op-${i}`, company_id:companyId, operation_class:'durable_write', idempotent:true }],
      now:i,
    });
    if (plan.company_id !== companyId) crossCompanyViolations += 1;
  }
  return Object.freeze({
    schema: 'titan.reliability.failure-storm-result.v1',
    company_id: companyId,
    company_boundary: 'company_id',
    cycles: total,
    bounded: maxFailures <= circuit.failure_threshold + 1,
    max_consecutive_failures: maxFailures,
    circuit_open_events: circuitOpenEvents,
    cross_company_violations: crossCompanyViolations,
    auto_replay: false,
    grants_authority: false,
    authority_effect: false,
  });
}
