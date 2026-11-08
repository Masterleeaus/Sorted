import type {
  ZeroDispatchEvent,
  ZeroRuntimeDispatcher,
  ZeroRuntimeDispatchInput,
  ZeroRuntimeDispatchResult,
} from "./runtime-dispatch";

export type ZeroWorkState =
  | "CREATED"
  | "READY"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "WAITING"
  | "WAITING_APPROVAL"
  | "WAITING_EXTERNAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ZeroWorkProjection = {
  company_id: string;
  work_id: string;
  state: ZeroWorkState;
  assignee?: string;
};

/** Cross-process production boundary owned by the canonical workforce service. */
export interface ZeroWorkforceDispatchPort {
  create(input: {
    company_id: string;
    work_id: string;
    objective: string;
    description: string;
    creator: string;
    origin: {
      actor_id: string;
      conversation_id: string;
      surface: "zero";
      correlation_id: string;
    };
    assignee: string;
    priority: number;
    dependencies: string[];
    required_capabilities: string[];
  }): Promise<ZeroWorkProjection>;
  resume(company_id: string, work_id: string, actor_id: string): Promise<ZeroWorkProjection>;
}

export type ZeroWorkerSelector = (input: ZeroRuntimeDispatchInput) => Promise<string> | string;

/**
 * Zero only translates authenticated interaction intent into the canonical workforce
 * dispatch contract. The worker/runtime process owns WorkItem persistence, workforce
 * lifecycle and TitanAgentRuntime. No execution authority is created at this boundary.
 */
export class ZeroWorkforceDispatcher implements ZeroRuntimeDispatcher {
  constructor(
    private readonly workforce: ZeroWorkforceDispatchPort,
    private readonly selectWorker: ZeroWorkerSelector,
  ) {}

  async dispatch(input: ZeroRuntimeDispatchInput): Promise<ZeroRuntimeDispatchResult> {
    const worker_id = input.requested_agent_id?.trim() || await this.selectWorker(input);
    if (!worker_id) throw new Error("zero-workforce-worker-required");

    const work_id = input.continuation_token?.trim() || `zero:${input.interaction_id}`;
    const work = input.continuation_token
      ? await this.workforce.resume(input.company_id, work_id, input.actor_id)
      : await this.workforce.create({
          company_id: input.company_id,
          work_id,
          objective: input.text,
          description: input.text,
          creator: input.actor_id,
          origin: {
            actor_id: input.actor_id,
            conversation_id: input.conversation_id,
            surface: "zero",
            correlation_id: input.correlation_id,
          },
          assignee: worker_id,
          priority: 100,
          dependencies: [],
          required_capabilities: [],
        });

    if (work.company_id !== input.company_id || work.work_id !== work_id) {
      throw new Error("zero-workforce-boundary-mismatch");
    }

    const event: ZeroDispatchEvent = {
      id: `${input.interaction_id}:work:${work.work_id}`,
      kind: "work.accepted",
      conversation_id: input.conversation_id,
      company_id: input.company_id,
      surface: "zero",
      work_id: work.work_id,
      worker_id: work.assignee ?? worker_id,
      state: work.state,
      correlation_id: input.correlation_id,
    };

    return { accepted: true, events: [event], continuation_token: work.work_id };
  }
}
