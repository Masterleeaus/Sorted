// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-tools/tool-launcher.mjs
import { resolveTitanToolLaunch } from './tool-launch-model.js';

export async function launchTitanTool(toolId, {map, adapters={}}={}) {
  const route = resolveTitanToolLaunch(toolId, map);
  const adapter = adapters[route.surface];
  if (typeof adapter !== 'function') {
    throw new Error(`Titan launch adapter unavailable for ${route.surface}`);
  }
  const result = await adapter({...route});
  return {
    ok: result?.ok !== false,
    tool_id: route.tool_id,
    surface: route.surface,
    action: route.action,
    capability_id: route.capability_id || null,
    grants_execution_authority: false,
    result: result ?? null,
  };
}
