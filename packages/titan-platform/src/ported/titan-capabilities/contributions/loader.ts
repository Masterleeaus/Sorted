// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-capabilities/contributions/loader.mjs
import { createContributionRegistry } from './registry.js';
import { nativeCapabilityContribution, capabilityRegistryEntryContribution, runtimeContractContribution } from './adapters.js';
export function buildContributionRegistry(context,{native_entries=[],capability_registry=null,runtime_contracts=[],contributions=[]}={}){const registry=createContributionRegistry(context);registry.registerMany(native_entries.map(x=>nativeCapabilityContribution(x,context)));registry.registerMany((capability_registry?.entries||[]).map(x=>capabilityRegistryEntryContribution(x,context)));registry.registerMany(runtime_contracts.map(x=>runtimeContractContribution(x,context)));registry.registerMany(contributions);return registry}
