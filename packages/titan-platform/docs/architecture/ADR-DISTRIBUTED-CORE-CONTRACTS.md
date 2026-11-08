# ADR — Titan Distributed Core Contracts

Status: Accepted for Goal 48 / SG-02 builder delivery

## Decision

Titan Edge Fabric, Storage Fabric, and Device/Distributed Intelligence share one TypeScript distributed contract layer. The layer extends existing Titan Core authority semantics rather than creating a second governance or mutation plane.

## Invariants

1. `company_id` is the only canonical tenant boundary. Legacy tenant identifiers are compatibility inputs only and are rejected inside canonical distributed contracts.
2. Canonical product surfaces are `zero`, `go`, and `hub`; aliases normalize before policy or execution.
3. Node identity, storage placement, model/provider identity, capability and health never grant authority.
4. Offline, degraded and failover execution may preserve or reduce authority but never increase it.
5. Canonical mutations require fresh authority revalidation and Command Bus acceptance. Offline work queues intent only; it does not mutate canonical state.
6. Accepted canonical mutations emit Signal and may then produce Assurance evidence. Distributed receipts are provenance evidence and are authority-neutral.
7. Sovereignty profiles constrain placement. Failover cannot escape the allowed locality set.
8. Every data class has exactly one canonical storage owner; replicas, projections, caches, evidence, backups and archives are explicit non-canonical roles.
9. Titan-funded intelligence is never silently selected without entitlement/cost permission.
10. Revocation is company-bound and propagates to affected execution leases/fabrics without cross-company discovery.

## Reuse / convergence

These contracts are adapters and shared types around Titan Core authority, Governance, Risk, Autonomy, Command Bus, Signal and Assurance. They do not replace those systems. Goal 49 implements Edge Fabric runtime behavior; Goal 50 implements Storage Fabric runtime behavior; Goal 51 implements the distributed Intelligence Router/runtime.

## Failure semantics

Failures are explicit and fail closed: deny, queue-for-recheck, or sovereign fallback. Resource pressure contracts execution. Cross-company, revoked, expired, unhealthy, untrusted, non-entitled or sovereignty-invalid execution is rejected.
