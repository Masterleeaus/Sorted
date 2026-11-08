# SMS + Push Channel Policy Pass

This pass recovers the missing SMS and push execution contracts without claiming that the current extension contains live provider implementations.

- `titan.connect.sms` / `channel.sms` is a conditional Titan Connect contract, intended for a verified host binding such as Twilio.
- `titan.connect.push` / `notification.push` is a conditional notification contract for a verified host binding.
- Conditional channels fail closed when the host does not advertise a verified non-authority-conferring capability.
- Channel preference/fallback is deterministic, explicit (`allow_fallback`), consent-aware and provider-health-aware.
- Email and WhatsApp remain native registered fallbacks where allowed.
- Phone remains a Titan Connect capability descriptor and now records the canonical voice operation vocabulary and Twilio/ElevenLabs/OpenAI Realtime engines.
- No binding grants authority; protected external communication still requires approval, idempotency, evidence/receipt and the downstream authority gateway.
