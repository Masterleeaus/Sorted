export const TITAN_PLATFORM_MIGRATION_VERSION = 2 as const;

export const TITAN_PLATFORM_DESCRIPTOR = Object.freeze({
  id: "titan-platform",
  source: "titan-zero-browser-extension",
  target: "titan-business-ops-standalone",
  migrationVersion: TITAN_PLATFORM_MIGRATION_VERSION,
  standaloneSafe: true,
  browserExtensionRequired: false,
  browserExtensionsOptionalCapabilityLayer: true,
  portedSourceFiles: 559,
  stagedDataAndContractAssets: 663,
  prioritySystems: Object.freeze([
    "runtime",
    "workforce",
    "intelligence",
    "reliability",
    "modules",
    "capabilities",
    "offline",
    "settings",
    "builder",
    "tools",
  ]),
  facades: Object.freeze(["runtime", "workforce", "intelligence", "business-ops"]),
  nativeBusinessOpsCommandGateway: true,
  workforceCommandEndpoint: "/api/v1/titan/workforce/commands",
});

export function getTitanPlatformDescriptor() {
  return TITAN_PLATFORM_DESCRIPTOR;
}
