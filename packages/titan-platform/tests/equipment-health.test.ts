import { describe, expect, it } from "vitest";
import { equipmentHealthSignal, evaluateEquipmentTelemetryHealth } from "../src/ported/titan-inventory/runtime/equipment-health.js";

describe("equipment telemetry health projection", () => {
  it("projects deterministic alerts without creating authority or a parallel workflow", () => {
    const result = evaluateEquipmentTelemetryHealth({
      company_id: "company-1",
      asset_id: "excavator-7",
      recorded_at: "2026-09-22T00:00:00.000Z",
      engine_temperature_c: 112,
      hydraulic_pressure_psi: 1700,
      battery_voltage: 12.4,
      connectivity: "online",
    });

    expect(result.state).toBe("critical");
    expect(result.alerts.map((alert) => alert.rule_id)).toEqual([
      "engine-temperature-high",
      "hydraulic-pressure-low",
    ]);
    expect(result.creates_service_case).toBe(false);
    expect(result.creates_work_order).toBe(false);
    expect(result.mutates_asset).toBe(false);
    expect(result.execution_permitted).toBe(false);
    expect(result.grants_authority).toBe(false);
  });

  it("emits a company-scoped authority-neutral Titan Signal projection", () => {
    const evaluation = evaluateEquipmentTelemetryHealth({
      company_id: "company-2",
      asset_id: "vehicle-2",
      recorded_at: "2026-09-22T01:00:00Z",
      battery_voltage: 11.2,
    });
    const signal = equipmentHealthSignal(evaluation);

    expect(signal.company_id).toBe("company-2");
    expect(signal.kind).toBe("asset.equipment.health");
    expect(signal.priority).toBe(60);
    expect(signal.authority_neutral).toBe(true);
    expect(signal.execution_authority).toBe(false);
  });

  it("rejects legacy tenant boundaries", () => {\n    expect(() => evaluateEquipmentTelemetryHealth({\n      company_id: "company-1",\n      asset_id: "asset-1",\n      recorded_at: "2026-09-22T01:00:00Z",\n      tenant_id: "legacy-tenant",\n    } as never)).toThrow("equipment-health-legacy-boundary-forbidden:tenant_id");\n  });\n\n  it("requires the canonical company_id boundary", () => {
    expect(() => evaluateEquipmentTelemetryHealth({
      company_id: "",
      asset_id: "asset-1",
      recorded_at: "2026-09-22T01:00:00Z",
    })).toThrow("equipment-health-company-id-required");
  });
  it("matches verified FieldFlow threshold and zero-suppression semantics", () => {
    const atThreshold = evaluateEquipmentTelemetryHealth({
      company_id: "company-1", asset_id: "asset-1", recorded_at: "2026-09-22T00:00:00Z",
      engine_temperature_c: 105, hydraulic_pressure_psi: 0, battery_voltage: 0, connectivity: "online",
    });
    expect(atThreshold.alerts.map((alert) => alert.rule_id)).toEqual(["engine-temperature-high"]);
  });

});