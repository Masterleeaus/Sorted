export const SURFACE_CONTRACT_VERSION = "1.0";

const presentation = Object.freeze({
  go: Object.freeze({
    name: "Titan Go",
    audience: "Field staff",
    accent: "#31d18b",
    heading: "What do you need next?",
    greeting: "Morning, Alex. Your first job is ready. The Access Failure Prevention Specialist has confirmed entry and the route is clear.",
    prompt: "Ask about today’s work, a customer, or what to do next…",
    suggestions: Object.freeze(["What’s my next job?", "Start Hartwell Dental", "Report issue"]),
  }),
  hub: Object.freeze({
    name: "Titan Hub",
    audience: "Customers",
    accent: "#63a1ff",
    heading: "How can I help with your service?",
    greeting: "Hi Sam. Your service is confirmed for tomorrow at 9:00 AM and arrival updates are on.",
    prompt: "Ask about a booking, quote, invoice, or your service…",
    suggestions: Object.freeze(["Track my service team", "Reschedule tomorrow", "Show service add-ons"]),
  }),
  command: Object.freeze({
    name: "Titan Command",
    audience: "Owners & managers",
    accent: "#94a3b8",
    heading: "What needs your decision?",
    greeting: "Good evening, Jason. Your business is healthy. Two decisions need you.",
    prompt: "Ask anything about your business…",
    suggestions: Object.freeze(["What needs me now?", "Show today’s operations", "What can the AI workforce handle?"]),
  }),
});

const capabilities = Object.freeze({
  go: Object.freeze([
    { capability_id: "jobs.read", operations: ["read"], mutation: false, offline: "read" },
    { capability_id: "jobs.progress", operations: ["travel", "arrive", "start", "complete"], mutation: true, offline: "queue", requires_receipt: true },
    { capability_id: "messages.send", operations: ["send"], mutation: true, offline: "queue", requires_receipt: true },
    { capability_id: "evidence.capture", operations: ["prepare", "upload"], mutation: true, offline: "queue", requires_receipt: true },
    { capability_id: "maps.navigate", operations: ["read", "navigate"], mutation: false, offline: "read" },
  ]),
  hub: Object.freeze([
    { capability_id: "services.read", operations: ["read"], mutation: false, offline: "read" },
    { capability_id: "services.reschedule", operations: ["prepare", "request"], mutation: true, offline: "forbidden", requires_receipt: true },
    { capability_id: "messages.send", operations: ["send"], mutation: true, offline: "queue", requires_receipt: true },
    { capability_id: "payments.intent", operations: ["prepare", "submit"], mutation: true, offline: "forbidden", requires_receipt: true },
    { capability_id: "addons.request", operations: ["prepare", "submit"], mutation: true, offline: "forbidden", requires_receipt: true },
  ]),
  command: Object.freeze([
    { capability_id: "decisions.read", operations: ["read"], mutation: false, offline: "read" },
    { capability_id: "decision.resolve", operations: ["approve", "deny"], mutation: true, offline: "forbidden", requires_receipt: true },
    { capability_id: "operations.read", operations: ["read"], mutation: false, offline: "read" },
    { capability_id: "workforce.read", operations: ["read"], mutation: false, offline: "read" },
    { capability_id: "workforce.control", operations: ["pause", "resume", "adjust"], mutation: true, offline: "forbidden", requires_receipt: true },
    { capability_id: "system.read", operations: ["read"], mutation: false, offline: "read" },
    { capability_id: "rewind.preview", operations: ["read", "preview"], mutation: false, offline: "read" },
  ]),
});

function required(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label}-required`);
  return value.trim();
}

function rejectLegacy(input) {
  if (input && typeof input === "object" && ("tenant_company_id" in input || "tenant_id" in input)) {
    throw new TypeError("tenant_company_id-not-authoritative");
  }
}

export function getDemoSurfaceProjection(surface) {
  const presentationSurface = surface === "zero" ? "command" : surface;
  if (!(presentationSurface in presentation)) throw new TypeError("canonical-surface-required");
  return Object.freeze({
    schema_version: SURFACE_CONTRACT_VERSION,
    company_id: "demo_001",
    surface,
    actor_id: `${surface}-demo-actor`,
    revision: "merge77-demo-rev-1",
    issued_at: "2026-09-16T04:00:00.000Z",
    expires_at: "2099-09-16T04:00:00.000Z",
    capabilities: capabilities[presentationSurface].map((capability) => Object.freeze({
      ...capability,
      operations: Object.freeze([...capability.operations]),
      requires_receipt: capability.requires_receipt ?? capability.mutation,
    })),
    data: Object.freeze({ presentation: presentation[presentationSurface] }),
    authority_neutral: true,
    identity_grants_authority: false,
    cached_state_grants_authority: false,
  });
}

export function createSurfaceCommandIntent(input) {
  rejectLegacy(input);
  const capability = input.projection.capabilities.find((entry) =>
    entry.capability_id === input.capability_id && entry.operations.includes(input.operation),
  );
  if (!capability) throw new TypeError("surface-capability-not-authorised");
  if (Date.parse(input.projection.expires_at) <= Date.now()) throw new TypeError("surface-projection-expired");
  return Object.freeze({
    schema_version: SURFACE_CONTRACT_VERSION,
    command_id: input.command_id ?? `demo-command-${Date.now()}`,
    company_id: input.projection.company_id,
    surface: input.projection.surface,
    actor_id: input.projection.actor_id,
    projection_revision: input.projection.revision,
    capability_id: required(input.capability_id, "surface-capability-id"),
    operation: required(input.operation, "surface-operation"),
    idempotency_key: required(input.idempotency_key, "idempotency-key"),
    correlation_id: required(input.correlation_id, "correlation-id"),
    payload: Object.freeze({ ...(input.payload ?? {}) }),
    transport: "titan-command-bus",
    execution_authorised: false,
    requires_server_acceptance: true,
    requires_receipt: capability.requires_receipt,
  });
}
