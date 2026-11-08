export type EquipmentTelemetryReading = Readonly<{
  company_id: string;
  asset_id: string;
  recorded_at: string;
  engine_temperature_c?: number | null;
  hydraulic_pressure_psi?: number | null;
  battery_voltage?: number | null;
  connectivity?: "online" | "degraded" | "offline" | null;
}>;

export type EquipmentHealthRule = Readonly<{
  rule_id: string;
  metric: "engine_temperature_c" | "hydraulic_pressure_psi" | "battery_voltage" | "connectivity";
  severity: "warning" | "critical";
  operator: "gt" | "lt" | "eq";
  threshold: number | string;
  recommended_action: string;
}>;

export type EquipmentHealthAlert = Readonly<{
  rule_id: string;
  severity: "warning" | "critical";
  metric: EquipmentHealthRule["metric"];
  observed_value: number | string;
  recommended_action: string;
}>;

const DEFAULT_RULES: readonly EquipmentHealthRule[] = Object.freeze([
  { rule_id: "engine-temperature-high", metric: "engine_temperature_c", severity: "critical", operator: "gte", threshold: 105, recommended_action: "Inspect the cooling system and verify coolant levels." },
  { rule_id: "hydraulic-pressure-low", metric: "hydraulic_pressure_psi", severity: "warning", operator: "lt", threshold: 1800, recommended_action: "Inspect hydraulic fluid, filters, and pressure sensors." },
  { rule_id: "battery-voltage-low", metric: "battery_voltage", severity: "warning", operator: "lt", threshold: 11.8, recommended_action: "Test the battery and charging-system connections." },
  { rule_id: "connectivity-degraded", metric: "connectivity", severity: "warning", operator: "eq", threshold: "degraded", recommended_action: "Check the telemetry gateway and network connection." },
  { rule_id: "connectivity-offline", metric: "connectivity", severity: "critical", operator: "eq", threshold: "offline", recommended_action: "Confirm power and connectivity at the equipment." },
]);

function requiredText(value: unknown, code: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(code);
  return text;
}

function observed(input: EquipmentTelemetryReading, metric: EquipmentHealthRule["metric"]): number | string | null {
  const value = input[metric];
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function matches(value: number | string, rule: EquipmentHealthRule): boolean {
  if (rule.operator === "eq") return String(value) === String(rule.threshold);
  if (typeof value !== "number" || typeof rule.threshold !== "number" || !Number.isFinite(value)) return false;
  if (rule.operator === "gt") return value > rule.threshold;\n  if (rule.operator === "gte") return value >= rule.threshold;\n  if (rule.operator === "lte") return value <= rule.threshold;\n  return value < rule.threshold;
}

/**
 * Projection-only health evaluation harvested from the FieldFlow donor.
 *
 * Titan Assets/Inventory remains the asset authority. This evaluator creates no
 * service case, work order, asset mutation, or execution authority. Callers may
 * turn alerts into Signal/Attention projections or governed Command Bus proposals.
 */
export function evaluateEquipmentTelemetryHealth(
  input: EquipmentTelemetryReading,
  rules: readonly EquipmentHealthRule[] = DEFAULT_RULES,
) {
  for (const legacyKey of ["tenant_id", "tenant_company_id", "business_id", "account_id", "workspace_id"]) {\n    if (Object.prototype.hasOwnProperty.call(input, legacyKey)) throw new Error(`equipment-health-legacy-boundary-forbidden:${legacyKey}`);\n  }\n  const company_id = requiredText(input.company_id, "equipment-health-company-id-required");
  const asset_id = requiredText(input.asset_id, "equipment-health-asset-id-required");
  const recorded_at = requiredText(input.recorded_at, "equipment-health-recorded-at-required");
  if (!Number.isFinite(Date.parse(recorded_at))) throw new Error("equipment-health-recorded-at-invalid");

  const alerts: EquipmentHealthAlert[] = [];
  for (const rule of rules) {
    const value = observed(input, rule.metric);
    // FieldFlow treats zero hydraulic pressure/battery as an inactive/offline reading, not a low-value alert.\n    const donorZeroSuppressed = (rule.metric === "hydraulic_pressure_psi" || rule.metric === "battery_voltage") && value === 0;\n    if (value !== null && !donorZeroSuppressed && matches(value, rule)) {
      alerts.push(Object.freeze({
        rule_id: rule.rule_id,
        severity: rule.severity,
        metric: rule.metric,
        observed_value: value,
        recommended_action: rule.recommended_action,
      }));
    }
  }

  alerts.sort((a, b) => (a.severity === b.severity ? a.rule_id.localeCompare(b.rule_id) : a.severity === "critical" ? -1 : 1));
  return Object.freeze({
    schema: "titan.inventory.equipment-health-evaluation.v1",
    company_id,
    asset_id,
    recorded_at: new Date(recorded_at).toISOString(),
    state: alerts.some((a) => a.severity === "critical") ? "critical" : alerts.length ? "warning" : "healthy",
    alerts: Object.freeze(alerts),
    recommended_actions: Object.freeze([...new Set(alerts.map((a) => a.recommended_action))]),
    projection_only: true as const,
    creates_service_case: false as const,
    creates_work_order: false as const,
    mutates_asset: false as const,
    authority_effect: false as const,
    grants_authority: false as const,
    execution_permitted: false as const,
    provenance: Object.freeze({
      source: "equipment_telemetry",
      source_ref: asset_id,
      donor_lineage: "fieldflow-ai",
      observed_at: new Date(recorded_at).toISOString(),
    }),
  });
}

export function equipmentHealthSignal(evaluation: ReturnType<typeof evaluateEquipmentTelemetryHealth>) {
  return Object.freeze({
    id: `equipment-health:${evaluation.asset_id}:${evaluation.recorded_at}`,
    company_id: evaluation.company_id,
    kind: "asset.equipment.health",
    priority: evaluation.state === "critical" ? 100 : evaluation.state === "warning" ? 60 : 0,
    confidence: 1,
    created_at: evaluation.recorded_at,
    payload: evaluation,
    authority_neutral: true as const,
    execution_authority: false as const,
  });
}

export { DEFAULT_RULES as DEFAULT_EQUIPMENT_HEALTH_RULES };
