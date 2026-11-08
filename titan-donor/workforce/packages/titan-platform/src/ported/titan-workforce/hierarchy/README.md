# Titan Workforce hierarchy convergence

This folder records the recovered Five-Tier AI lineage without treating historical code as current authority.

Target workforce model:

1. Starter / Process Orchestrator
2. Manager
3. Supervisor
4. Specialist
5. Atomic Worker
6. Tool / Capability (execution layer, not an agent tier)

The recovered historical Tier-3 actions are candidate atomic Workers. Historical Tier-2 assistants are candidate Specialists. Current 119 Workforce roles must be classified into Manager/Supervisor/Specialist before any legacy role is added, to prevent duplicates.

Historical source archives were not available as materializable ZIP bytes in this pass; therefore this is a catalogue/architecture recovery, not a claim that all historical PHP source has been restored.

## Delegation routing

The hierarchy runtime now resolves governed five-tier delegation as:

`Orchestrator -> Manager -> Supervisor -> Specialist -> Atomic Worker -> Tool/Capability`

Five supplemental coordination-only Supervisors bridge divisions where the flattened 119-role catalogue had no Supervisor between Manager and Specialist. They do not own business records, grant authority, or replace the 119 role catalogue. Delegation produces a proposal/handoff only; existing authority, policy, capability and provider layers remain the execution gate.

## Call/voicemail lead qualification pass
`call-lead-qualification-runtime.mjs` converts call/voicemail evidence into a bounded qualification proposal. Service need, location, urgency, timing and requested action retain provenance; transcript-derived values are explicitly inference, never CRM truth. Incomplete qualification routes to clarification. Explicit quote intent may recommend the Quote Orchestrator and explicit booking intent may recommend the Booking Orchestrator, but every handoff is proposal-only and remains behind authority/approval gates.
