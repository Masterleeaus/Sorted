export interface WorkforceManagerAgent { company_id: string; agent_id: string; display_name: string; capabilities: readonly string[]; evidence_refs: readonly string[]; eligible_for_authority_evaluation: boolean; authority_granted: false; }
export interface WorkforceManagerTeam { company_id: string; team_id: string; member_agent_ids: readonly string[]; capability_ids: readonly string[]; }
export function validateWorkforceManagerAgent(agent: WorkforceManagerAgent): void {
  if (!agent.company_id || !agent.agent_id || !agent.display_name) throw new Error("agent identity is required");
  if (agent.capabilities.length === 0 || agent.evidence_refs.length === 0) throw new Error("capabilities and evidence are required");
  if (agent.authority_granted !== false) throw new Error("Workforce Manager cannot grant authority");
}
export function validateWorkforceManagerTeam(team: WorkforceManagerTeam): void {
  if (!team.company_id || !team.team_id || team.member_agent_ids.length === 0) throw new Error("company-scoped team membership is required");
  if (team.capability_ids.length === 0) throw new Error("team capabilities are required");
}

