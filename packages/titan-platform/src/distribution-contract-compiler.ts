export type ContractSourceKind = "OPENAPI" | "JSON_SCHEMA" | "WEBHOOK" | "MCP";

export type ContractSource = Readonly<{
  kind: ContractSourceKind;
  document: unknown;
  source_ref: string;
  source_revision: string;
}>;

export type CompiledContractItem = Readonly<{
  source_kind: ContractSourceKind;
  source_ref: string;
  source_revision: string;
  local_id: string;
  operation: string;
  schema_ref: string | null;
  canonical_capability_id: null;
  status: "MAPPING_REQUIRED";
}>;

export type CompiledContractInventory = Readonly<{
  schema: "titan.distribution-contract-inventory/v1";
  inventory_hash: string;
  items: readonly CompiledContractItem[];
}>;

const sourceKinds: ReadonlySet<string> = new Set(["OPENAPI", "JSON_SCHEMA", "WEBHOOK", "MCP"]);

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field}-required`);
  return value.trim();
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("contract-document-object-required");
  }
  return value as Record<string, unknown>;
}

function validateSource(source: unknown): ContractSource {
  const candidate = object(source);
  if (typeof candidate.kind !== "string" || !sourceKinds.has(candidate.kind)) {
    throw new Error("contract-source-kind-invalid");
  }
  const source_ref = nonEmpty(candidate.source_ref, "source_ref");
  const source_revision = nonEmpty(candidate.source_revision, "source_revision");
  object(candidate.document);
  return {
    kind: candidate.kind as ContractSourceKind,
    document: candidate.document,
    source_ref,
    source_revision,
  };
}

function sortedUnique(values: string[]): string[] {
  const normalized = values.map((value) => nonEmpty(value, "contract-item-id"));
  if (new Set(normalized).size !== normalized.length) throw new Error("contract-item-id-duplicate");
  return normalized.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function identityKey(item: Pick<CompiledContractItem, "source_kind" | "source_ref" | "local_id">): string {
  return JSON.stringify([item.source_kind, item.source_ref, item.local_id]);
}

function compareIdentity(left: CompiledContractItem, right: CompiledContractItem): number {
  if (left.source_kind !== right.source_kind) return left.source_kind < right.source_kind ? -1 : 1;
  if (left.source_ref !== right.source_ref) return left.source_ref < right.source_ref ? -1 : 1;
  if (left.local_id !== right.local_id) return left.local_id < right.local_id ? -1 : 1;
  return 0;
}

function collect(source: ContractSource): CompiledContractItem[] {
  const document = object(source.document);
  const source_ref = nonEmpty(source.source_ref, "source_ref");
  const source_revision = nonEmpty(source.source_revision, "source_revision");
  const items: CompiledContractItem[] = [];
  const add = (localId: unknown, operation: string, schemaRef: string | null = null) => {
    const id = nonEmpty(localId, "contract-item-id");
    items.push(Object.freeze({
      source_kind: source.kind,
      source_ref,
      source_revision,
      local_id: id,
      operation,
      schema_ref: schemaRef,
      canonical_capability_id: null,
      status: "MAPPING_REQUIRED",
    }));
  };

  if (source.kind === "OPENAPI") {
    if (typeof document.openapi !== "string" || !document.openapi.startsWith("3.")) {
      throw new Error("openapi-3-required");
    }
    const paths = object(document.paths);
    const verbs = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
    for (const path of Object.keys(paths).sort()) {
      const pathItem = object(paths[path]);
      for (const method of Object.keys(pathItem).sort()) {
        if (!verbs.has(method.toLowerCase())) continue;
        const operation = object(pathItem[method]);
        add(operation.operationId, `${method.toUpperCase()} ${path}`);
      }
    }
    const components = document.components === undefined ? {} : object(document.components);
    const schemas = components.schemas === undefined ? {} : object(components.schemas);
    for (const name of Object.keys(schemas).sort()) add(`schema:${name}`, "JSON_SCHEMA");
  } else if (source.kind === "JSON_SCHEMA") {
    const schemas = document.$defs === undefined ? {} : object(document.$defs);
    for (const name of Object.keys(schemas).sort()) add(`schema:${name}`, "JSON_SCHEMA");
    if (items.length === 0 && typeof document.$id === "string") add(document.$id, "JSON_SCHEMA");
  } else if (source.kind === "WEBHOOK") {
    const webhooks = object(document.webhooks ?? document);
    const verbs = new Set(["get", "put", "post", "delete", "patch"]);
    for (const name of Object.keys(webhooks).sort()) {
      const endpoint = object(webhooks[name]);
      for (const method of Object.keys(endpoint).sort()) {
        if (verbs.has(method.toLowerCase())) {
          const operation = object(endpoint[method]);
          add(operation.operationId ?? `webhook:${name}:${method.toLowerCase()}`, `${method.toUpperCase()} ${name}`);
        }
      }
    }
  } else if (source.kind === "MCP") {
    if (!Array.isArray(document.tools)) throw new Error("mcp-tools-array-required");
    const tools = document.tools;
    for (const entry of tools) {
      const tool = object(entry);
      add(tool.name, "MCP_TOOL");
    }
  } else {
    throw new Error("contract-source-kind-invalid");
  }

  const ids = sortedUnique(items.map((item) => item.local_id));
  const order = new Map(ids.map((id, index) => [id, index]));
  return items.sort((left, right) => order.get(left.local_id)! - order.get(right.local_id)!);
}

export async function compileContractInventory(sources: readonly ContractSource[]): Promise<CompiledContractInventory> {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error("contract-source-required");
  const validatedSources = sources.map(validateSource);
  const items = validatedSources.flatMap(collect);
  const keys = items.map(identityKey);
  if (new Set(keys).size !== keys.length) throw new Error("contract-item-duplicate");
  items.sort(compareIdentity);
  const serialized = JSON.stringify(items);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return Object.freeze({
    schema: "titan.distribution-contract-inventory/v1",
    inventory_hash: `sha256:${hash}`,
    items: Object.freeze(items),
  });
}
