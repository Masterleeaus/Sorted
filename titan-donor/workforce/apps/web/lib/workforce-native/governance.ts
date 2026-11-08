import type {AuthSession} from "@/lib/auth/middleware";
import {buildTitanNativeGovernanceEvidence,type TitanNativeWorkforceAgentKey,type TitanNativeWorkforceOperation} from "@titan-zero/titan-platform/workforce-native";

export function buildNativeGovernance(session:AuthSession,plan:{agentKey:TitanNativeWorkforceAgentKey;action:string;operation:TitanNativeWorkforceOperation|null},request?:Request){const online=request?.headers.get("x-titan-offline")!=="true";return buildTitanNativeGovernanceEvidence({companyId:session.accountId,actorId:session.userId,agentKey:plan.agentKey,action:plan.action,traceId:session.traceId,operation:plan.operation,permissionGranted:session.role==="owner"||session.role==="admin",online});}
export function applyNativeGovernanceHeaders(headers:Headers,evidence:ReturnType<typeof buildNativeGovernance>){headers.set("x-titan-audit-trace-id",evidence.trace_id);headers.set("x-titan-governance-agent",evidence.agent_key);headers.set("x-titan-governance-offline-mode",evidence.offline.mode);headers.set("x-titan-authority-source","native-route");return headers;}

/**
 * Native workforce routes are planning/projection surfaces, not authority issuers.
 * Until the canonical Decision/Risk/Authority execution envelope is supplied by
 * Titan's governed runtime and routed through ExecutionGateway, consequential
 * operations must fail closed rather than treating owner/admin identity as approval.
 */
export function assertNativeExecutionAuthority(plan:{operation:TitanNativeWorkforceOperation|null}):void{
  if(plan.operation!==null && plan.operation.method!=="GET"){
    const error=new Error("CANONICAL_EXECUTION_AUTHORITY_REQUIRED");
    error.name="NativeExecutionAuthorityError";
    throw error;
  }
}
