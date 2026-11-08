# Call Recovery Workflow Pass

This additive pass turns voice outcomes into governed business recovery proposals without granting execution authority.

- Missed/failed/after-hours calls can propose callback scheduling through Reception -> Customer Service Manager -> Customer Service Coordinator -> Booking Coordinator.
- Voicemail is handed to Customer Care with transcript/voicemail references only.
- Transcript, recording, summary and provider receipt artifacts are attached by opaque references; provider credentials/secrets are forbidden.
- Agent-unresolved and explicit human requests create human escalation proposals that require human acceptance.
- Recovery actions are idempotent and company-scoped. Duplicate recovery keys are suppressed.
- No CRM, scheduler, messaging or provider side effect is performed by this runtime.
