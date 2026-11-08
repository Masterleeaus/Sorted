export type ContextBudgetPlan = { input_tokens: number; reserved_output_tokens: number; context_window: number; compaction_required: boolean; accepted_input_tokens: number };

/** Provider-neutral context budgeting; routing and privacy policy remain elsewhere. */
export function planContextBudget(input: { prompt: string; context_window: number; reserved_output_tokens: number; max_input_ratio?: number }): ContextBudgetPlan {
  if (!Number.isSafeInteger(input.context_window) || input.context_window <= 0) throw new Error('context_window_invalid');
  if (!Number.isSafeInteger(input.reserved_output_tokens) || input.reserved_output_tokens <= 0 || input.reserved_output_tokens >= input.context_window) throw new Error('reserved_output_invalid');
  const input_tokens = Math.ceil(input.prompt.length / 4);
  const available = input.context_window - input.reserved_output_tokens;
  const accepted_input_tokens = Math.floor(available * Math.min(Math.max(input.max_input_ratio ?? 0.9, 0.1), 1));
  return { input_tokens, reserved_output_tokens: input.reserved_output_tokens, context_window: input.context_window, compaction_required: input_tokens > accepted_input_tokens, accepted_input_tokens };
}

