import type { InteractionTransport } from "./interaction-client";

export function createZeroHttpTransport(endpoint = "/api/v1/zero/interactions"): InteractionTransport {
  return {
    async send(input, options) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        signal: options?.signal,
        body: JSON.stringify(input),
      });

      const payload = await response.json().catch(() => ({})) as {
        accepted?: boolean;
        events?: unknown[];
        continuation_token?: string;
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        const error = new Error(payload.error ?? `Zero interaction failed (${response.status})`) as Error & { code?: string; status?: number };
        error.code = payload.code;
        error.status = response.status;
        throw error;
      }

      return {
        accepted: payload.accepted === true,
        events: Array.isArray(payload.events) ? payload.events as never[] : [],
        continuation_token: payload.continuation_token,
      };
    },
  };
}
