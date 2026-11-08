export type DeveloperDiagnostic = {
  diagnostic_id: string;
  company_id: string;
  scope: "read" | "diagnostic";
  subject_ref: string;
  status: "observed" | "failed" | "unknown";
  summary: string;
  redacted_details: readonly string[];
  created_at: string;
};

export type DeveloperAccess = {
  schema: "titan.developer-access.v1";
  company_id: string;
  actor_id: string;
  scopes: readonly DeveloperDiagnostic["scope"][];
  expires_at: string;
  authority_granted: false;
};

const req = (value: unknown, name: string) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name}-required`);
  return text;
};

export function createDeveloperAccess(input: {
  company_id: string;
  actor_id: string;
  scopes: DeveloperDiagnostic["scope"][];
  expires_at: string;
}): DeveloperAccess {
  const expires_at = req(input.expires_at, "expires_at");
  const expiresMs = Date.parse(expires_at);
  if (!Number.isFinite(expiresMs)) throw new Error("expires_at-invalid");
  if (expiresMs <= Date.now()) throw new Error("expires_at-expired");

  const scopes = [...new Set(input.scopes)];
  if (!scopes.length) throw new Error("scopes-required");

  return Object.freeze({
    schema: "titan.developer-access.v1",
    company_id: req(input.company_id, "company_id"),
    actor_id: req(input.actor_id, "actor_id"),
    scopes: Object.freeze(scopes),
    expires_at,
    authority_granted: false,
  });
}

export function assertDeveloperAccessCurrent(
  access: DeveloperAccess,
  now: string | number | Date = Date.now(),
) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("access-now-invalid");
  if (Date.parse(access.expires_at) <= nowMs) throw new Error("developer-access-expired");
  return true;
}

export function recordDeveloperDiagnostic(
  input: Omit<DeveloperDiagnostic, "created_at"> & { created_at?: string },
  access: DeveloperAccess,
): DeveloperDiagnostic {
  assertDeveloperAccessCurrent(access);
  if (input.company_id !== access.company_id) throw new Error("diagnostic-company-mismatch");
  if (!access.scopes.includes(input.scope)) throw new Error("diagnostic-scope-denied");

  const created_at = input.created_at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(created_at))) throw new Error("created_at-invalid");

  return Object.freeze({
    diagnostic_id: req(input.diagnostic_id, "diagnostic_id"),
    company_id: req(input.company_id, "company_id"),
    scope: input.scope,
    subject_ref: req(input.subject_ref, "subject_ref"),
    status: input.status,
    summary: req(input.summary, "summary"),
    redacted_details: Object.freeze(input.redacted_details.map((value) => req(value, "redacted_detail"))),
    created_at,
  });
}

export function assertDiagnosticCompany(diagnostic: DeveloperDiagnostic, company_id: string) {
  if (diagnostic.company_id !== req(company_id, "company_id")) {
    throw new Error("diagnostic-company-mismatch");
  }
  return true;
}

export type DeveloperConnectionState =
  | "CONNECTED"
  | "DEGRADED"
  | "MISSING"
  | "AUTH_FAILED"
  | "DISABLED"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

export type DeveloperMcpToolInspection = Readonly<{
  name: string;
  description: string;
  classification: "READ" | "VERIFY" | "WRITE" | "EXECUTE" | "DESTRUCTIVE" | "UNKNOWN";
  execution_available: boolean;
  blocked_reason: string | null;
  sanitized_input_schema: unknown;
}>;

export type DeveloperMcpServerInspection = Readonly<{
  server_id: string;
  state: DeveloperConnectionState;
  protocol_version: string | null;
  version: string | null;
  tools: readonly DeveloperMcpToolInspection[];
  authority_granted: false;
}>;

export type DeveloperCapabilityInspection = Readonly<{
  capability_id: string;
  owner: string;
  provider: string | null;
  state: DeveloperConnectionState;
  operation_class: "READ" | "VERIFY" | "WRITE" | "EXECUTE" | "DESTRUCTIVE" | "UNKNOWN";
  reason: string | null;
  authority_granted: false;
}>;

export type DeveloperDeploymentInspection = Readonly<{
  deployment_id: string;
  source_sha: string;
  environment: string;
  state: "UNKNOWN" | "BUILDING" | "READY" | "DEPLOYED" | "DEGRADED" | "FAILED" | "ROLLED_BACK";
  verified: boolean;
  verification_ref: string | null;
  rollback_ref: string | null;
  authority_granted: false;
}>;

const SECRET_SCHEMA_KEYS = new Set([
  "default",
  "example",
  "examples",
  "const",
  "value",
  "secret",
  "token",
  "password",
  "authorization",
  "credential",
  "cookie",
  "session",
]);

const cleanText = (value: unknown, max = 1000) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);

export function sanitizeDeveloperSchema(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[bounded]";
  if (Array.isArray(value)) {
    return Object.freeze(value.slice(0, 80).map((item) => sanitizeDeveloperSchema(item, depth + 1)));
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanText(value, 500);
  if (!value || typeof value !== "object") return null;

  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, 160)) {
    const key = cleanText(rawKey, 120);
    if (!key || SECRET_SCHEMA_KEYS.has(key.toLowerCase())) continue;
    out[key] = sanitizeDeveloperSchema(rawValue, depth + 1);
  }
  return Object.freeze(out);
}

const MCP_CLASSES = new Set(["READ", "VERIFY", "WRITE", "EXECUTE", "DESTRUCTIVE"]);

export function inspectDeveloperMcpServer(input: {
  server_id: string;
  state: DeveloperConnectionState;
  protocol_version?: string | null;
  version?: string | null;
  tools?: readonly {
    name?: unknown;
    description?: unknown;
    classification?: unknown;
    input_schema?: unknown;
  }[];
}): DeveloperMcpServerInspection {
  const tools = (input.tools ?? []).slice(0, 300).map((tool): DeveloperMcpToolInspection => {
    const rawClass = cleanText(tool.classification, 40).toUpperCase();
    const classification = (MCP_CLASSES.has(rawClass) ? rawClass : "UNKNOWN") as DeveloperMcpToolInspection["classification"];
    const mutating = ["WRITE", "EXECUTE", "DESTRUCTIVE"].includes(classification);
    const execution_available = classification === "READ" || classification === "VERIFY";
    return Object.freeze({
      name: req(tool.name, "mcp_tool_name"),
      description: cleanText(tool.description, 1200),
      classification,
      execution_available,
      blocked_reason:
        classification === "UNKNOWN"
          ? "classification-unknown"
          : mutating
            ? "governed-execution-required"
            : null,
      sanitized_input_schema: sanitizeDeveloperSchema(tool.input_schema ?? {}),
    });
  });

  return Object.freeze({
    server_id: req(input.server_id, "server_id"),
    state: input.state,
    protocol_version: input.protocol_version ? cleanText(input.protocol_version, 80) : null,
    version: input.version ? cleanText(input.version, 80) : null,
    tools: Object.freeze(tools),
    authority_granted: false,
  });
}

export function inspectDeveloperCapability(input: {
  capability_id: string;
  owner: string;
  provider?: string | null;
  state: DeveloperConnectionState;
  operation_class?: unknown;
  reason?: unknown;
}): DeveloperCapabilityInspection {
  const rawClass = cleanText(input.operation_class, 40).toUpperCase();
  const operation_class = (MCP_CLASSES.has(rawClass) ? rawClass : "UNKNOWN") as DeveloperCapabilityInspection["operation_class"];
  return Object.freeze({
    capability_id: req(input.capability_id, "capability_id"),
    owner: req(input.owner, "owner"),
    provider: input.provider ? cleanText(input.provider, 160) : null,
    state: input.state,
    operation_class,
    reason: input.reason ? cleanText(input.reason, 500) : null,
    authority_granted: false,
  });
}

export function inspectDeveloperDeployment(input: {
  deployment_id: string;
  source_sha: string;
  environment: string;
  state?: DeveloperDeploymentInspection["state"];
  verified?: boolean;
  verification_ref?: string | null;
  rollback_ref?: string | null;
}): DeveloperDeploymentInspection {
  const source_sha = req(input.source_sha, "source_sha");
  if (!/^[a-f0-9]{7,64}$/i.test(source_sha)) throw new Error("source_sha-invalid");
  return Object.freeze({
    deployment_id: req(input.deployment_id, "deployment_id"),
    source_sha,
    environment: req(input.environment, "environment"),
    state: input.state ?? "UNKNOWN",
    verified: input.verified === true,
    verification_ref: input.verification_ref ? cleanText(input.verification_ref, 240) : null,
    rollback_ref: input.rollback_ref ? cleanText(input.rollback_ref, 240) : null,
    authority_granted: false,
  });
}
