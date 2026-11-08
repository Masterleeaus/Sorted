export type SystemScope = "platform" | "server" | "company" | "runtime" | "component" | "provider" | "experimental";
export type SystemComponentState = "healthy" | "degraded" | "incompatible" | "disabled";

export type SystemComponentDescriptor = Readonly<{
  schema: "titan.system.component.v1";
  component_id: string;
  runtime_id: string;
  version: string;
  scope: SystemScope;
  state: SystemComponentState;
  configuration_schema: string;
  dependency_ids: readonly string[];
  capability_ids: readonly string[];
  consumer_ids: readonly string[];
  provenance: string;
}>;

export type SystemGraph = Readonly<{
  schema: "titan.system.graph.v1";
  company_id: string;
  authority: "configuration-and-diagnostics-only";
  components: readonly SystemComponentDescriptor[];
  edges: readonly Readonly<{ from: string; to: string; kind: "dependency" | "consumer" }>[];
}>;

export type SystemConfiguration = Readonly<{
  schema: "titan.system.configuration.v1";
  company_id: string;
  revision: number;
  component_id: string;
  values: Readonly<Record<string, unknown>>;
  previous_revision: number | null;
  authority: "configuration-only";
}>;

function required(value: unknown, field: string): string { const result = String(value ?? "").trim(); if (!result) throw new Error(`${field} is required`); return result; }
function company(value: unknown): string { return required(value, "company_id"); }
function clone<T>(value: T): T { return structuredClone(value); }

function sanitizeSecrets(value: unknown, path = "configuration"): unknown {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|token|password|private[_-]?key|client[_-]?secret/i.test(key)) {
      if (!item || typeof item !== "object" || typeof (item as { $ref?: unknown }).$ref !== "string") throw new Error(`raw-secret-rejected:${path}.${key}`);
      output[key] = { $ref: required((item as { $ref: string }).$ref, `${path}.${key}.$ref`) };
    } else output[key] = sanitizeSecrets(item, `${path}.${key}`);
  }
  return output;
}

export function createSystemComponent(input: Partial<SystemComponentDescriptor> & { component_id: string; runtime_id: string; version: string; scope: SystemScope; configuration_schema: string; provenance: string }): SystemComponentDescriptor {
  return Object.freeze({
    schema: "titan.system.component.v1",
    component_id: required(input.component_id, "component_id"), runtime_id: required(input.runtime_id, "runtime_id"), version: required(input.version, "version"),
    scope: input.scope, state: input.state ?? "healthy", configuration_schema: required(input.configuration_schema, "configuration_schema"),
    dependency_ids: Object.freeze([...(input.dependency_ids ?? [])].map((id) => required(id, "dependency_id"))),
    capability_ids: Object.freeze([...(input.capability_ids ?? [])].map((id) => required(id, "capability_id"))),
    consumer_ids: Object.freeze([...(input.consumer_ids ?? [])].map((id) => required(id, "consumer_id"))),
    provenance: required(input.provenance, "provenance"),
  });
}

export function buildSystemGraph(company_id: string, descriptors: readonly SystemComponentDescriptor[]): SystemGraph {
  const ids = new Set<string>();
  for (const descriptor of descriptors) { if (ids.has(descriptor.component_id)) throw new Error(`duplicate-system-component:${descriptor.component_id}`); ids.add(descriptor.component_id); }
  const edges: { from: string; to: string; kind: "dependency" | "consumer" }[] = [];
  for (const descriptor of descriptors) {
    for (const dependency of descriptor.dependency_ids) { if (!ids.has(dependency)) throw new Error(`unknown-system-dependency:${descriptor.component_id}:${dependency}`); edges.push({ from: descriptor.component_id, to: dependency, kind: "dependency" }); }
    for (const consumer of descriptor.consumer_ids) { if (!ids.has(consumer)) throw new Error(`unknown-system-consumer:${descriptor.component_id}:${consumer}`); edges.push({ from: consumer, to: descriptor.component_id, kind: "consumer" }); }
  }
  return Object.freeze({ schema: "titan.system.graph.v1", company_id: company(company_id), authority: "configuration-and-diagnostics-only", components: Object.freeze([...descriptors]), edges: Object.freeze(edges) });
}

export function exportSystemConfiguration(configuration: SystemConfiguration): SystemConfiguration {
  return Object.freeze({ ...configuration, values: sanitizeSecrets(configuration.values) as Readonly<Record<string, unknown>> });
}

export class SystemConfigurationStore {
  #current: SystemConfiguration;
  #draft: Readonly<Record<string, unknown>> | null = null;
  #history: SystemConfiguration[] = [];
  constructor(company_id: string, component_id: string, values: Record<string, unknown> = {}) {
    this.#current = Object.freeze({ schema: "titan.system.configuration.v1", company_id: company(company_id), revision: 0, component_id: required(component_id, "component_id"), values: Object.freeze(clone(values)), previous_revision: null, authority: "configuration-only" });
  }
  get current(): SystemConfiguration { return this.#current; }
  get historyLength(): number { return this.#history.length; }
  stage(company_id: string, values: Record<string, unknown>): Readonly<Record<string, unknown>> { if (company(company_id) !== this.#current.company_id) throw new Error("system-company-context-mismatch"); this.#draft = Object.freeze(clone(values)); return this.#draft; }
  validate(): true { if (!this.#draft) throw new Error("system-draft-required"); sanitizeSecrets(this.#draft); return true; }
  preview(): SystemConfiguration { this.validate(); return Object.freeze({ ...this.#current, values: this.#draft as Readonly<Record<string, unknown>>, revision: this.#current.revision + 1, previous_revision: this.#current.revision }); }
  apply(): SystemConfiguration { const next = this.preview(); this.#history.push(this.#current); this.#current = next; this.#draft = null; return this.#current; }
  rollback(): SystemConfiguration { const previous = this.#history.pop(); if (!previous) throw new Error("system-no-known-good-configuration"); this.#current = previous; this.#draft = null; return this.#current; }
}

