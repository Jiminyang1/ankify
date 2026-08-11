import { isAiTimeoutError, safeErrorForLog } from "../ai-errors";

export function classifyAgentError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "agent_interrupted", message: "The Study Coach response was interrupted." };
  }
  if (isAiTimeoutError(error)) {
    return { code: "agent_timeout", message: "The Study Coach timed out. Try again." };
  }
  const details = error as Error & { status?: unknown; statusCode?: unknown };
  const status =
    typeof details.status === "number"
      ? details.status
      : typeof details.statusCode === "number"
        ? details.statusCode
        : null;
  if (status === 429) {
    return { code: "provider_rate_limited", message: "The AI provider is rate limited. Try again shortly." };
  }
  if (status !== null && status >= 500) {
    return { code: "provider_unavailable", message: "The AI provider is temporarily unavailable." };
  }
  return { code: "agent_failed", message: "The Study Coach could not finish this response." };
}

export function logAgentError(runId: string, error: unknown) {
  console.error("[agent] run failed", { runId, ...safeErrorForLog(error) });
}
