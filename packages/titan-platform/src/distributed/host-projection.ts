export type ExternalHost = 'chatgpt' | 'claude' | 'gemini' | 'generic-mcp';
export type HostCapability = { capability_id: string; schema_version: string; read_only: boolean; entitled: boolean };
export type HostProjectionContext = { company_id: string; actor_id: string; correlation_id: string; host: ExternalHost };
export type HostToolInvocation = { company_id: string; capability_id: string; correlation_id: string; authority_checked: boolean };

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`host_${name}_required`);
}

export function projectHostCapabilities(context: HostProjectionContext, capabilities: readonly HostCapability[]): readonly HostCapability[] {
  required(context.company_id, 'company_id');
  required(context.actor_id, 'actor_id');
  return capabilities.filter(capability => capability.entitled);
}

export function validateHostInvocation(context: HostProjectionContext, invocation: HostToolInvocation, capabilities: readonly HostCapability[]): void {
  required(context.company_id, 'company_id');
  required(context.correlation_id, 'correlation_id');
  if (invocation.company_id !== context.company_id || invocation.correlation_id !== context.correlation_id) throw new Error('host_context_mismatch');
  if (!invocation.authority_checked) throw new Error('host_authority_check_required');
  if (!capabilities.some(capability => capability.capability_id === invocation.capability_id && capability.entitled)) throw new Error('host_capability_unavailable');
}

