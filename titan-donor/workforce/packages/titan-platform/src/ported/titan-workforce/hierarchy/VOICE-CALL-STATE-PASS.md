# Voice Call State + Reconciliation Pass

Adds a fail-closed call-state runtime for Titan Connect voice execution. Provider receipts drive state transitions; provider-event IDs suppress duplicates; uncertain outcomes require reconciliation before any retry/redial; retries are bounded and require the existing idempotency key. No state transition or receipt grants authority or directly executes a call.
