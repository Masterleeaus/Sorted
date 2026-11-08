# Five-Tier Workforce — Communication Provider Pass

This pass connects communication-oriented atomic Workers to existing governed Titan channel capabilities without creating duplicate providers.

## Reused capabilities
- `channel.gmail` → `titan.connect.gmail` for email
- `channel.whatsapp` → `titan.connect.whatsapp` for WhatsApp
- `voice.phone_agent` → `titan.connect.phone` for phone integration descriptors

## Bound atomic Workers
- Send Customer Message Agent
- Customer Notification Agent
- Send Invoice Agent
- Send Payment Reminder Agent
- Send Quote Agent

## Safety
- `company_id` remains the sole company boundary.
- Provider binding does not grant execution authority.
- Protected sends require approval, idempotency and execution receipts.
- This layer prepares proposals for the existing authority gateway; it never sends directly.
- SMS and push notification remain fail-closed because the current native contribution registry does not expose dedicated governed execution providers for them.
